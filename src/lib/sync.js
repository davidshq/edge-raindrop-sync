// The sync engine: drains the durable queue and runs bidirectional reconcile.
//
// Invariant (confirm-before-act): a Raindrop write (create or delete) is
// confirmed and pair/tombstone state persisted BEFORE any matching local
// deletion. Policy-driven Edge cleanup never cascades into a Raindrop delete.
// Effective `exclude` blocks upload, ingest, and delete propagation both ways.

import { POLICY, JOB, SYNC_MODE, RAINDROP_FOLDER_MODE, MAX_JOBS_PER_DRAIN } from "./constants.js";
import {
  getConfig,
  getOverrides,
  getCollectionCache,
  cacheCollection,
  uncacheCollection,
  hasSynced,
  recordSynced,
  getRaindropId,
  getBookmarkIdForRaindrop,
  forgetSynced,
  forgetPairByRaindrop,
  addTombstone,
  hasTombstone,
  suppressRemove,
  suppressCreate,
  consumeRemoveSuppression,
  consumeCreateSuppression,
  setStatus,
  appendLog,
  ensurePairsMigrated,
  isRateLimited,
  noteRateLimitedUntil,
  clearRateLimit,
} from "./store.js";
import * as queue from "./queue.js";
import {
  getNode,
  getChildren,
  removeNode,
  removeFolder,
  resolveLocation,
  createBookmark,
  resolveEdgeParentForMirror,
  mirrorPathExists,
  ancestorIdsFromFolder,
} from "./bookmarks.js";
import { resolvePolicy, isExcluded } from "./policy.js";
import { RaindropClient, AuthError, RateLimitError } from "./raindrop.js";
import {
  buildCollectionIndex,
  ensureCollectionPath,
  findRootCollection,
  collectionIdFromRelative,
  raindropUploadSegments,
} from "./collections.js";
import { canCreateRaindropOnlyPath } from "./allowlist.js";
import { reconcile } from "./reconcile.js";

let draining = false; // best-effort in-memory reentrancy guard (idempotent anyway)

export async function drain() {
  if (draining) return;
  draining = true;
  try {
    await ensurePairsMigrated();
    await drainLoop();
  } catch (err) {
    await appendLog("error", `Drain crashed: ${err.message}`);
  } finally {
    draining = false;
  }
}

/**
 * Shared Auth / rate-limit handling for drain and reconcile.
 * On rate limit: set a global pause, defer all due jobs, abort the current loop.
 * @returns {boolean} true if the caller should abort the current loop
 */
async function handleClientError(err, { job } = {}) {
  if (err instanceof AuthError) {
    await setStatus({ deletionsHalted: true, lastError: err.message });
    await appendLog("error", `${err.message} — deletions halted, jobs kept.`);
    if (job) await setStatus({ pending: await queue.size() });
    return true;
  }
  if (err instanceof RateLimitError) {
    const entered = await noteRateLimitedUntil(err.retryAt);
    if (job) await queue.deferUntil(job.id, err.retryAt);
    await queue.deferAllDueUntil(err.retryAt);
    await setStatus({ pending: await queue.size() });
    if (entered) {
      const kind = err.proactive ? "budget low" : "HTTP 429";
      await appendLog(
        "warn",
        `Raindrop rate limit (${kind}); pausing API calls until ${new Date(err.retryAt).toISOString()}.`
      );
    }
    return true;
  }
  return false;
}

/**
 * Options/popup "Reconcile now": force past idle cooldown, then drain.
 * Rate-limit / auth errors use the same global gate as the heartbeat so a
 * manual 429 cannot leave rateLimitedUntil unset while the alarm keeps firing.
 * @returns {Promise<{
 *   enqueued: number,
 *   pages: number,
 *   done: boolean,
 *   skipped?: boolean,
 *   reason?: "busy"|"rate_limited"|"cooldown",
 * }>}
 */
export async function reconcileNow() {
  try {
    if (await isRateLimited()) {
      return { enqueued: 0, pages: 0, done: false, skipped: true, reason: "rate_limited" };
    }
    const result = await reconcile({ force: true });
    if (await isRateLimited()) return result;
    await drain();
    return result;
  } catch (err) {
    if (await handleClientError(err)) {
      if (err instanceof RateLimitError) {
        return { enqueued: 0, pages: 0, done: false, skipped: true, reason: "rate_limited" };
      }
      throw err;
    }
    await appendLog("error", `Reconcile failed: ${err.message}`);
    throw err;
  }
}

/** Heartbeat entry: drain queue, then reconcile when bidirectional. */
export async function tick() {
  if (await isRateLimited()) {
    // Stay quiet — status.rateLimitedUntil is the signal; avoid log spam each minute.
    return;
  }
  await drain();
  if (await isRateLimited()) return;
  const config = await getConfig();
  if (config.syncMode !== SYNC_MODE.BIDIRECTIONAL) {
    await clearRateLimit();
    return;
  }
  try {
    // Heartbeat uses cooldown; Options/popup use reconcileNow() (force: true).
    await reconcile({ force: false });
    if (await isRateLimited()) return;
    await drain(); // process any jobs reconcile just enqueued
    if (!(await isRateLimited())) await clearRateLimit();
  } catch (err) {
    if (await handleClientError(err)) return;
    await appendLog("error", `Reconcile failed: ${err.message}`);
  }
}

async function drainLoop() {
  if (await isRateLimited()) return;

  const config = await getConfig();
  if (!config.token) {
    await setStatus({ lastError: "No Raindrop token configured", pending: await queue.size() });
    return;
  }

  const dueJobs = await queue.due(Date.now());
  if (dueJobs.length === 0) {
    await setStatus({ pending: await queue.size() });
    return;
  }

  const client = new RaindropClient(config.token);
  const overrides = await getOverrides();
  const cache = await getCollectionCache();
  let index = null;
  const getIndex = async () => (index ??= await buildCollectionIndex(client));

  let processed = 0;
  for (const job of dueJobs) {
    if (processed >= MAX_JOBS_PER_DRAIN) {
      await appendLog(
        "info",
        `Drain paused after ${MAX_JOBS_PER_DRAIN} jobs; ${dueJobs.length - processed} remain for later.`
      );
      break;
    }
    try {
      await processJob(job, { client, config, overrides, cache, getIndex });
      processed++;
      client.throwIfShouldPause();
    } catch (err) {
      if (await handleClientError(err, { job })) return;
      await queue.defer(job.id, Date.now());
      await appendLog("error", `Sync failed (will retry): ${err.message}`);
    }
  }

  await setStatus({
    deletionsHalted: false,
    lastError: null,
    lastActivityAt: Date.now(),
    pending: await queue.size(),
  });
}

async function processJob(job, ctx) {
  const kind = queue.jobKind(job);
  const bidirectional = ctx.config.syncMode === SYNC_MODE.BIDIRECTIONAL;

  // Bidirectional-only jobs are no-ops in one-way mode.
  if (!bidirectional && kind !== JOB.UPLOAD) {
    await queue.remove(job.id);
    return;
  }

  switch (kind) {
    case JOB.PULL_CREATE:
      await processPullCreate(job, ctx);
      break;
    case JOB.DELETE_RAINDROP:
      await processDeleteRaindrop(job, ctx);
      break;
    case JOB.DELETE_EDGE:
      await processDeleteEdge(job, ctx);
      break;
    case JOB.UPLOAD:
    default:
      await processUpload(job, ctx);
      break;
  }
}

async function processUpload(job, ctx) {
  const { client, config, overrides, cache, getIndex } = ctx;

  let node;
  try {
    node = await getNode(job.id);
  } catch {
    await queue.remove(job.id);
    return;
  }
  if (!node.url) {
    await queue.remove(job.id);
    return;
  }

  const { segments, ancestorIds } = await resolveLocation(node);
  const effective = resolvePolicy(ancestorIds, overrides, config.defaultPolicy);

  if (effective === POLICY.EXCLUDE) {
    await queue.remove(job.id);
    return;
  }

  if (!(await hasSynced(job.id))) {
    const index = await getIndex();
    // Other favorites / Raindrop / … → account-level collection path; else under sync root.
    const fullSegments = raindropUploadSegments(segments, config.rootName);
    const collectionId = await ensureCollectionPath(
      client,
      index,
      fullSegments,
      cache,
      cacheCollection,
      uncacheCollection
    );
    const item = await client.createRaindrop({
      link: node.url,
      title: node.title,
      collectionId,
    });
    await recordSynced(job.id, item._id);
    await appendLog("info", `Synced: ${node.title || node.url}`);
  }

  if (effective === POLICY.SYNC_DELETE) {
    const parentId = node.parentId;
    // Suppress so onRemoved does not enqueue a Raindrop delete in bidirectional mode.
    await suppressRemove(job.id);
    await removeNode(job.id);
    if (config.pruneEmpty) await pruneIfEmpty(parentId, config, overrides);
  }

  await queue.remove(job.id);
}

async function processPullCreate(job, ctx) {
  const { config, getIndex } = ctx;
  const rid = String(job.raindropId);

  // Already paired (e.g. raced with upload).
  if (await getBookmarkIdForRaindrop(rid)) {
    await queue.remove(job.id);
    return;
  }
  // Stale durable jobs must not resurrect after a confirmed or in-flight delete.
  if (await hasTombstone(rid)) {
    await queue.remove(job.id);
    await appendLog("info", `Skipped pull for tombstoned raindrop ${rid}.`);
    return;
  }
  if (await hasPendingDeleteForRaindrop(rid)) {
    await queue.remove(job.id);
    await appendLog("info", `Skipped pull; delete already queued for raindrop ${rid}.`);
    return;
  }
  if (!job.link) {
    await queue.remove(job.id);
    return;
  }

  const relative = job.relativeSegments || [];
  const folderMode = config.raindropFolderMode || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED;
  const allowlist = config.raindropFolderAllowlist || {};
  const edgeExists = await mirrorPathExists(relative, config.rootName);

  let index = null;
  let rootId = null;
  let collectionId = job.collectionId ?? null;
  if (!edgeExists) {
    index = await getIndex();
    const root = findRootCollection(index, config.rootName);
    rootId = root?._id ?? null;
    // Legacy pull jobs (pre-allowlist) omit collectionId — resolve from path.
    if (collectionId == null && rootId != null && relative.length) {
      collectionId = collectionIdFromRelative(index, rootId, relative);
    }
  }

  if (
    !canCreateRaindropOnlyPath({
      allowlist,
      collectionId,
      index,
      rootId,
      edgePathExists: edgeExists,
      folderMode,
    })
  ) {
    await queue.remove(job.id);
    const pathLabel = relative.length ? relative.join("/") : "(root)";
    await appendLog("info", `Skipped pull: path not allowed (${pathLabel}).`);
    return;
  }

  await suppressCreate(job.link);
  const parentId = await resolveEdgeParentForMirror(relative, config.rootName);
  const node = await createBookmark({
    parentId,
    title: job.title || job.link,
    url: job.link,
  });
  await recordSynced(node.id, rid);
  await appendLog("info", `Pulled: ${job.title || job.link}`);
  await queue.remove(job.id);
}

/** True if a delete-raindrop or delete-edge job for this raindrop is still queued. */
async function hasPendingDeleteForRaindrop(rid) {
  const target = String(rid);
  const jobs = await queue.list();
  return jobs.some((j) => {
    const kind = queue.jobKind(j);
    if (kind !== JOB.DELETE_RAINDROP && kind !== JOB.DELETE_EDGE) return false;
    return j.raindropId != null && String(j.raindropId) === target;
  });
}

async function processDeleteRaindrop(job, ctx) {
  const { client } = ctx;
  const rid = job.raindropId != null ? String(job.raindropId) : null;
  if (!rid) {
    await queue.remove(job.id);
    return;
  }

  try {
    await client.deleteRaindrop(rid);
  } catch (err) {
    // Already gone is fine.
    if (!/404/.test(err.message || "")) throw err;
  }
  await addTombstone(rid, "edge-user-delete");
  await forgetPairByRaindrop(rid);
  await appendLog("info", `Deleted raindrop ${rid} (propagated from Edge).`);
  await queue.remove(job.id);
}

/**
 * Propagate a missing Raindrop item to Edge. Skips the Edge remove when the
 * paired bookmark sits under an effective `exclude` policy (hands-off subtree),
 * but still clears the pair and tombstones so reconcile does not re-queue.
 */
async function processDeleteEdge(job, ctx) {
  const { config, overrides } = ctx;
  const rid = job.raindropId != null ? String(job.raindropId) : null;
  const bookmarkId = job.bookmarkId;

  if (bookmarkId) {
    try {
      const node = await getNode(bookmarkId);
      const parentId = node.parentId;
      const ancestorIds = await ancestorIdsFromFolder(parentId);
      if (isExcluded(ancestorIds, overrides, config.defaultPolicy)) {
        await appendLog(
          "info",
          `Skipped Edge delete for excluded bookmark ${bookmarkId} (raindrop ${rid} gone).`
        );
      } else {
        await suppressRemove(bookmarkId);
        await removeNode(bookmarkId);
        if (config.pruneEmpty) await pruneIfEmpty(parentId, config, overrides);
        await appendLog("info", `Deleted Edge bookmark ${bookmarkId} (propagated from Raindrop).`);
      }
    } catch {
      // Already gone — still clear mapping.
    }
  }

  if (rid) {
    await addTombstone(rid, "raindrop-remote-delete");
    await forgetPairByRaindrop(rid);
  } else if (bookmarkId) {
    await forgetSynced(bookmarkId);
  }
  await queue.remove(job.id);
}

/**
 * Handle a user (or extension) remove of an Edge bookmark.
 * Policy-suppressed removes are ignored; mapped user deletes enqueue Raindrop delete
 * unless the bookmark lived under an effective `exclude` policy.
 * @param {string} bookmarkId
 * @param {{ parentId?: string }} [removeInfo] from chrome.bookmarks.onRemoved
 */
export async function handleBookmarkRemoved(bookmarkId, removeInfo) {
  if (await consumeRemoveSuppression(bookmarkId)) return;

  const config = await getConfig();
  if (config.syncMode !== SYNC_MODE.BIDIRECTIONAL) return;

  const raindropId = await getRaindropId(bookmarkId);
  if (!raindropId) return;

  // Prefer parent chain from removeInfo — the bookmark node is already gone.
  if (removeInfo?.parentId) {
    const overrides = await getOverrides();
    const ancestorIds = await ancestorIdsFromFolder(removeInfo.parentId);
    if (isExcluded(ancestorIds, overrides, config.defaultPolicy)) {
      await appendLog("info", `Skipped Raindrop delete for excluded Edge bookmark ${bookmarkId}.`);
      return;
    }
  }

  await queue.enqueueJob({
    id: `dr-${raindropId}`,
    kind: JOB.DELETE_RAINDROP,
    raindropId,
    bookmarkId,
  });
  await appendLog("info", `Queued Raindrop delete for removed Edge bookmark ${bookmarkId}.`);
  await drain();
}

/**
 * Handle Edge bookmark create — skip enqueue when pull/extension-authored or already paired.
 */
export async function handleBookmarkCreated(id, node) {
  if (!node?.url) return;
  if (await consumeCreateSuppression(node.url)) return;
  if (await hasSynced(id)) return;
  await queue.enqueue(id);
  await drain();
}

async function pruneIfEmpty(folderId, config, overrides) {
  let id = folderId;
  while (id) {
    let folder;
    try {
      folder = await getNode(id);
    } catch {
      return;
    }
    if (!folder || folder.parentId === "0") return;
    if (overrides[id]?.policy === POLICY.EXCLUDE) return;
    const children = await getChildren(id);
    if (children.length > 0) return;
    const parentId = folder.parentId;
    await removeFolder(id);
    await appendLog("info", `Pruned empty folder: ${folder.title}`);
    id = parentId;
  }
}
