// The sync engine: drains the durable queue and runs bidirectional reconcile.
//
// Invariant (confirm-before-act): a Raindrop write (create or delete) is
// confirmed and pair/tombstone state persisted BEFORE any matching local
// deletion. Policy-driven Edge cleanup never cascades into a Raindrop delete.
// Effective `exclude` blocks upload, ingest, and delete propagation both ways.
//
// Folder deletes: Chromium fires one onRemoved for the folder (none for
// contents). handleBookmarkRemoved walks removeInfo.node so every paired URL
// under the folder still enqueues a Raindrop delete.
//
// Folder / bookmark moves: onMoved enqueues upload jobs (same-parent reorder
// is a no-op). Paired drains update Raindrop collection placement; unpaired
// create. Moves are never treated as user deletes.
//
// Offload (sync-and-delete): after Edge remove, clear the pair and tombstone
// with reason edge-offload so reconcile cannot pull the item back, without
// leaving a zombie bookmarkId in the pair map.

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
  clearPairWithTombstone,
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
  collectUrlDescendantIds,
} from "./bookmarks.js";
import { resolvePolicy, isExcluded } from "./policy.js";
import { RaindropClient, AuthError, RateLimitError, isNotFoundError } from "./raindrop.js";
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

  // Destination-folder policy (current parent after create or move).
  const { segments, ancestorIds } = await resolveLocation(node);
  const effective = resolvePolicy(ancestorIds, overrides, config.defaultPolicy);

  if (effective === POLICY.EXCLUDE) {
    await queue.remove(job.id);
    return;
  }

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
  const pathLabel = fullSegments.join("/");

  let rid = await getRaindropId(job.id);
  if (rid) {
    try {
      await client.updateRaindrop(rid, { collectionId });
      await appendLog("info", `Moved: ${node.title || node.url} → ${pathLabel}`);
    } catch (err) {
      // Stale pair: raindrop gone — clear mapping and fall through to create.
      if (!isNotFoundError(err)) throw err;
      await forgetPairByRaindrop(rid);
      rid = null;
    }
  }

  if (!rid && !(await hasSynced(job.id))) {
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
    const offloadRid = await getRaindropId(job.id);
    // Suppress so onRemoved does not enqueue a Raindrop delete in bidirectional mode.
    await suppressRemove(job.id);
    await removeNode(job.id);
    // Drop the pair (bookmark id is gone) and tombstone so bidirectional pull
    // cannot undo the offload. Raindrop copy is intentionally kept.
    if (offloadRid) {
      await clearPairWithTombstone(offloadRid, "edge-offload");
    } else {
      await forgetSynced(job.id);
    }
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
    if (!isNotFoundError(err)) throw err;
  }
  await clearPairWithTombstone(rid, "edge-user-delete");
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
    await clearPairWithTombstone(rid, "raindrop-remote-delete");
  } else if (bookmarkId) {
    await forgetSynced(bookmarkId);
  }
  await queue.remove(job.id);
}

/**
 * URL nodes removed by an onRemoved event.
 * Chromium notifies once for a folder delete and embeds the tree in
 * `removeInfo.node` — walk it so nested bookmarks are not orphaned in Raindrop.
 *
 * @param {string} removedId
 * @param {{ parentId?: string, node?: object }} [removeInfo]
 * @returns {{ id: string, pathFolderIds: string[], liveParentId: string|null }[]}
 *   `pathFolderIds` is nearest-first folders inside the deleted tree;
 *   `liveParentId` is the still-existing parent of the removed root.
 */
export function collectRemovedUrlNodes(removedId, removeInfo) {
  const tree = removeInfo?.node;
  const liveParentId =
    removeInfo?.parentId != null && removeInfo.parentId !== ""
      ? String(removeInfo.parentId)
      : null;

  if (!tree) {
    return [{ id: String(removedId), pathFolderIds: [], liveParentId }];
  }

  const out = [];
  const walk = (n, folderAncestorsNearestFirst) => {
    if (n.url) {
      out.push({
        id: String(n.id),
        pathFolderIds: folderAncestorsNearestFirst,
        liveParentId,
      });
      return;
    }
    const next = [String(n.id), ...folderAncestorsNearestFirst];
    for (const c of n.children ?? []) walk(c, next);
  };
  walk(tree, []);
  return out;
}

/**
 * Handle a user (or extension) remove of an Edge bookmark or folder.
 * Policy-suppressed removes are ignored; mapped user deletes enqueue Raindrop
 * delete unless the bookmark lived under an effective `exclude` policy.
 * Folder deletes walk `removeInfo.node` (Chromium's recursive payload).
 * @param {string} bookmarkId
 * @param {{ parentId?: string, node?: object }} [removeInfo] from chrome.bookmarks.onRemoved
 */
export async function handleBookmarkRemoved(bookmarkId, removeInfo) {
  if (await consumeRemoveSuppression(bookmarkId)) return;

  const config = await getConfig();
  if (config.syncMode !== SYNC_MODE.BIDIRECTIONAL) return;

  const targets = collectRemovedUrlNodes(bookmarkId, removeInfo);
  if (!targets.length) return;

  const overrides = await getOverrides();
  let queued = 0;

  for (const target of targets) {
    const raindropId = await getRaindropId(target.id);
    if (!raindropId) continue;

    const liveAncestors = target.liveParentId
      ? await ancestorIdsFromFolder(target.liveParentId)
      : [];
    const ancestorIds = [...target.pathFolderIds, ...liveAncestors];
    if (isExcluded(ancestorIds, overrides, config.defaultPolicy)) {
      await appendLog(
        "info",
        `Skipped Raindrop delete for excluded Edge bookmark ${target.id}.`
      );
      continue;
    }

    const added = await queue.enqueueJob({
      id: `dr-${raindropId}`,
      kind: JOB.DELETE_RAINDROP,
      raindropId,
      bookmarkId: target.id,
    });
    if (added) {
      queued++;
      await appendLog(
        "info",
        `Queued Raindrop delete for removed Edge bookmark ${target.id}.`
      );
    }
  }

  if (queued > 0) await drain();
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

/**
 * Handle Edge bookmark or folder move (parent change).
 * Same-parent reorders are ignored. URL nodes enqueue an upload job; folders
 * fan out to live descendant URL bookmarks (Chromium does not fire per child).
 * Drain updates Raindrop collection for pairs or creates when unpaired.
 *
 * @param {string} id
 * @param {{ parentId?: string, oldParentId?: string }} [moveInfo] from chrome.bookmarks.onMoved
 */
export async function handleBookmarkMoved(id, moveInfo) {
  const oldParent =
    moveInfo?.oldParentId != null && moveInfo.oldParentId !== ""
      ? String(moveInfo.oldParentId)
      : null;
  const newParent =
    moveInfo?.parentId != null && moveInfo.parentId !== ""
      ? String(moveInfo.parentId)
      : null;
  if (oldParent != null && newParent != null && oldParent === newParent) return;

  let node;
  try {
    node = await getNode(id);
  } catch {
    return;
  }

  const ids = node.url ? [String(id)] : await collectUrlDescendantIds(id);
  if (!ids.length) return;

  await queue.enqueueMany(ids);
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
