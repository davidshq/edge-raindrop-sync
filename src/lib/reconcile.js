// Raindrop ↔ Edge reconciliation for bidirectional mode.
//
// Lists raindrops under the configured root (nested), enqueues pull-creates for
// unmapped items, and enqueues Edge deletes when a mapped raindrop disappears.
// Skips Raindrop file/document uploads. Honors tombstones, exclude, folder mode,
// and raindropFolderAllowlist (non-empty ⇒ selective Raindrop-only sync).
// Root-nested and outside-root allowlist listing share maybeEnqueuePullCreate so
// pull filters cannot drift between the two paths.
//
// Rate-limit posture: shared page budget for root + outside-root listing; capped
// GET /raindrop confirms during delete detection; stop early when the client
// reports low X-RateLimit-Remaining (throws RateLimitError for sync to gate).

import { JOB, SYNC_MODE, RAINDROP_FOLDER_MODE, MAX_RECONCILE_PAGES_PER_TICK, MAX_ALIVE_CHECKS_PER_TICK, MIN_RECONCILE_INTERVAL_MS } from "./constants.js";
import {
  getConfig,
  getOverrides,
  getPairs,
  hasTombstone,
  getReconcileState,
  setReconcileState,
  setRaindropFolderAllowlist,
  appendLog,
  ensurePairsMigrated,
  isRateLimited,
} from "./store.js";
import * as queue from "./queue.js";
import { isExcluded } from "./policy.js";
import {
  getTopRoots,
  ancestorIdsForMirrorPath,
  mirrorPathExists,
  ensureMirrorFolderPath,
} from "./bookmarks.js";
import {
  buildCollectionIndex,
  findRootCollection,
  collectionPathFromRoot,
  collectionsUnderRoot,
  collectionsForAllowlistPicker,
  mirrorRelativeSegments,
  getById,
} from "./collections.js";
import {
  isAllowlistActive,
  isCollectionAllowed,
  canCreateRaindropOnlyPath,
  pruneAllowlist,
} from "./allowlist.js";
import { RaindropClient, AuthError, RateLimitError, RaindropError } from "./raindrop.js";

const PER_PAGE = 50;

/** In-memory reentrancy guard — overlapping heartbeat + manual reconcile must not interleave. */
let reconciling = false;

/**
 * Run one reconcile pass (or continue from cursor). Safe to call from heartbeat.
 * @param {{ force?: boolean }} [opts] `force` (default true) bypasses the idle
 *   cooldown between completed cycles. Heartbeat passes `force: false`.
 * @returns {{
 *   enqueued: number,
 *   pages: number,
 *   done: boolean,
 *   skipped?: boolean,
 *   reason?: "busy"|"rate_limited"|"cooldown",
 * }}
 */
export async function reconcile({ force = true } = {}) {
  if (reconciling) {
    return { enqueued: 0, pages: 0, done: false, skipped: true, reason: "busy" };
  }
  if (await isRateLimited()) {
    return { enqueued: 0, pages: 0, done: false, skipped: true, reason: "rate_limited" };
  }
  reconciling = true;
  try {
    return await reconcileOnce({ force });
  } finally {
    reconciling = false;
  }
}

/** Durable signals that a multi-tick scan is mid-flight. */
function isReconcileInProgress(state) {
  return (
    (state.cursorPage || 0) > 0 ||
    state.outsideCursor != null ||
    (Array.isArray(state.seenAcc) && state.seenAcc.length > 0)
  );
}

async function reconcileOnce({ force }) {
  await ensurePairsMigrated();
  const config = await getConfig();
  if (config.syncMode !== SYNC_MODE.BIDIRECTIONAL) {
    return { enqueued: 0, pages: 0, done: true };
  }
  if (!config.token) {
    await setReconcileState({ lastError: "No Raindrop token configured", running: false });
    return { enqueued: 0, pages: 0, done: true };
  }

  const state = await getReconcileState();
  // Idle cooldown: after a completed cycle, heartbeat waits before listing again.
  // In-progress cursors always continue; manual reconcile uses force (default).
  if (
    !force &&
    !isReconcileInProgress(state) &&
    state.lastRunAt &&
    Date.now() - state.lastRunAt < MIN_RECONCILE_INTERVAL_MS
  ) {
    return { enqueued: 0, pages: 0, done: true, skipped: true, reason: "cooldown" };
  }

  const client = new RaindropClient(config.token);
  const index = await buildCollectionIndex(client);
  client.throwIfShouldPause();
  const root = findRootCollection(index, config.rootName);
  if (!root) {
    await appendLog("info", `Reconcile: root collection "${config.rootName}" not found yet.`);
    await setReconcileState({
      running: false,
      lastRunAt: Date.now(),
      lastError: null,
      cursorPage: 0,
      outsideCursor: null,
      seenAcc: null,
    });
    return { enqueued: 0, pages: 0, done: true };
  }

  let page = state.cursorPage || 0;
  let outsideCursor = state.outsideCursor || null;
  await setReconcileState({ running: true, lastError: null });

  let enqueued = 0;
  let pages = 0;
  const seenIds = new Set();
  const pairs = await getPairs();
  const overrides = await getOverrides();
  const topRoots = await getTopRoots();
  const folderMode = config.raindropFolderMode || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED;
  let allowlist = config.raindropFolderAllowlist || {};

  try {
    // Drop allowlist ids deleted from Raindrop. Fully mirrored entries stay so
    // selective mode is not undone before pulls/ensures run.
    const pruned = await pruneAllowlist(allowlist, index, root._id, (relative) =>
      mirrorPathExists(relative, config.rootName, topRoots)
    );
    if (pruned.removed > 0) {
      allowlist = pruned.allowlist;
      await setRaindropFolderAllowlist(allowlist);
      await appendLog(
        "info",
        `Pruned ${pruned.removed} missing Raindrop-only allowlist entr${pruned.removed === 1 ? "y" : "ies"}.`
      );
    }

    const pullCtx = {
      index,
      rootId: root._id,
      config,
      overrides,
      topRoots,
      allowlist,
      folderMode,
      pairs,
      seenIds,
    };

    // Resume outside-root phase if a prior tick finished the root listing.
    if (outsideCursor) {
      const outside = await continueOutsideRoot(
        client,
        outsideCursor,
        pullCtx,
        MAX_RECONCILE_PAGES_PER_TICK
      );
      enqueued += outside.enqueued;
      pages += outside.pages;
      if (!outside.done) {
        await mergeSeenAcc(seenIds);
        await setReconcileState({
          running: false,
          cursorPage: 0,
          outsideCursor: outside.cursor,
          lastRunAt: Date.now(),
        });
        // Quiet when idle progress — heartbeat used to spam this every minute.
        if (enqueued > 0) {
          await appendLog("info", `Reconcile queued ${enqueued} pull(s); outside-root pages pending.`);
        }
        return { enqueued, pages, done: false };
      }
      outsideCursor = null;
      await setReconcileState({ outsideCursor: null });
    } else {
      while (pages < MAX_RECONCILE_PAGES_PER_TICK) {
        const { items, count } = await client.listRaindrops(root._id, {
          page,
          perPage: PER_PAGE,
          nested: true,
        });
        pages++;
        client.throwIfShouldPause();

        for (const item of items) {
          enqueued += await maybeEnqueuePullCreate(item, pullCtx, (colId) => {
            const fullPath = collectionPathFromRoot(index, colId, root._id);
            if (!fullPath.length) return null;
            return fullPath.slice(1);
          });
        }

        const fetched = (page + 1) * PER_PAGE;
        const finished = items.length < PER_PAGE || fetched >= count;
        if (finished) {
          // Root listing done — start outside-root with remaining page budget.
          if (isAllowlistActive(allowlist)) {
            const started = startOutsideCursor(allowlist, index, root._id);
            if (started) {
              const remaining = MAX_RECONCILE_PAGES_PER_TICK - pages;
              const outside = await continueOutsideRoot(client, started, pullCtx, remaining);
              enqueued += outside.enqueued;
              pages += outside.pages;
              if (!outside.done) {
                await mergeSeenAcc(seenIds);
                await setReconcileState({
                  running: false,
                  cursorPage: 0,
                  outsideCursor: outside.cursor,
                  lastRunAt: Date.now(),
                });
                if (enqueued > 0) {
                  await appendLog(
                    "info",
                    `Reconcile queued ${enqueued} pull(s); outside-root pages pending.`
                  );
                }
                return { enqueued, pages, done: false };
              }
            }
          }

          await finishDeleteDetection(client, seenIds, pairs);
          await ensureAllowlistedOrMirrorAll(
            index,
            root._id,
            config,
            overrides,
            topRoots,
            folderMode,
            allowlist
          );
          await setReconcileState({
            running: false,
            cursorPage: 0,
            outsideCursor: null,
            lastRunAt: Date.now(),
            lastError: null,
            seenAcc: null,
          });
          if (enqueued > 0) {
            await appendLog("info", `Reconcile queued ${enqueued} pull(s).`);
          }
          return { enqueued, pages, done: true };
        }

        page++;
        await mergeSeenAcc(seenIds);
        await setReconcileState({ cursorPage: page, outsideCursor: null, running: true });
      }

      await mergeSeenAcc(seenIds);
      await setReconcileState({ running: false, cursorPage: page, lastRunAt: Date.now() });
      if (enqueued > 0) {
        await appendLog("info", `Reconcile queued ${enqueued} pull(s); more pages pending.`);
      }
      return { enqueued, pages, done: false };
    }

    // outsideCursor path finished above → delete detection + ensure.
    await finishDeleteDetection(client, seenIds, pairs);
    await ensureAllowlistedOrMirrorAll(
      index,
      root._id,
      config,
      overrides,
      topRoots,
      folderMode,
      allowlist
    );
    await setReconcileState({
      running: false,
      cursorPage: 0,
      outsideCursor: null,
      lastRunAt: Date.now(),
      lastError: null,
      seenAcc: null,
    });
    if (enqueued > 0) {
      await appendLog("info", `Reconcile queued ${enqueued} pull(s).`);
    }
    return { enqueued, pages, done: true };
  } catch (err) {
    await setReconcileState({ running: false, lastError: err.message });
    throw err;
  }
}

/**
 * Outside-root collection ids to list, as forest roots only.
 * If both a parent and child are allowlisted, nested listing of the parent
 * already covers the child — skip the child to avoid duplicate API pages.
 * @param {Record<string, unknown>} allowlist
 * @param {object} index
 * @param {number|string} rootId sync-root collection id
 * @returns {string[]}
 */
export function outsideRootListIds(allowlist, index, rootId) {
  const candidates = [];
  for (const id of Object.keys(allowlist)) {
    if (!getById(index, id)) continue;
    if (collectionPathFromRoot(index, id, rootId).length) continue;
    candidates.push(String(id));
  }
  const idSet = new Set(candidates);
  return candidates.filter((id) => {
    let current = getById(index, id);
    for (;;) {
      const parentId = current?.parent?.$id;
      if (parentId == null) return true;
      if (idSet.has(String(parentId))) return false;
      current = getById(index, parentId);
      if (!current) return true;
    }
  });
}

/**
 * Build a resumable cursor over allowlisted collections outside the sync root.
 * @returns {{ ids: string[], i: number, page: number }|null}
 */
function startOutsideCursor(allowlist, index, rootId) {
  const ids = outsideRootListIds(allowlist, index, rootId);
  if (!ids.length) return null;
  return { ids, i: 0, page: 0 };
}

/**
 * List outside-root allowlisted collections with a shared page budget.
 * @returns {{ enqueued: number, pages: number, done: boolean, cursor: object|null }}
 */
async function continueOutsideRoot(client, cursor, pullCtx, maxPages) {
  let enqueued = 0;
  let pages = 0;
  const { ids } = cursor;
  let { i, page } = cursor;
  const { index, rootId } = pullCtx;

  while (i < ids.length && pages < maxPages) {
    const id = ids[i];
    if (!getById(index, id)) {
      i++;
      page = 0;
      continue;
    }
    const { items, count } = await client.listRaindrops(id, {
      page,
      perPage: PER_PAGE,
      nested: true,
    });
    pages++;
    client.throwIfShouldPause();

    for (const item of items) {
      enqueued += await maybeEnqueuePullCreate(item, pullCtx, (colId) =>
        mirrorRelativeSegments(index, colId, rootId)
      );
    }

    const fetched = (page + 1) * PER_PAGE;
    if (items.length < PER_PAGE || fetched >= count) {
      i++;
      page = 0;
    } else {
      page++;
    }
  }

  const done = i >= ids.length;
  return {
    enqueued,
    pages,
    done,
    cursor: done ? null : { ids, i, page },
  };
}

async function mergeSeenAcc(seenIds) {
  const state = await getReconcileState();
  const acc = new Set(state.seenAcc || []);
  for (const id of seenIds) acc.add(id);
  await setReconcileState({ seenAcc: [...acc] });
}

async function finishDeleteDetection(client, seenIds, pairs) {
  const state = await getReconcileState();
  const acc = new Set(state.seenAcc || []);
  for (const id of seenIds) acc.add(id);

  // Build the full candidate list first, then walk a rotating window so pairs
  // past MAX_ALIVE_CHECKS_PER_TICK are not starved across cycles.
  const candidates = [];
  for (const [rid, bookmarkId] of Object.entries(pairs.byRaindrop)) {
    if (acc.has(rid)) continue;
    if (await hasTombstone(rid)) continue;
    candidates.push([rid, bookmarkId]);
  }

  if (!candidates.length) {
    if ((state.aliveConfirmOffset || 0) !== 0) {
      await setReconcileState({ aliveConfirmOffset: 0 });
    }
    return;
  }

  const offset = (state.aliveConfirmOffset || 0) % candidates.length;
  const toCheck = Math.min(MAX_ALIVE_CHECKS_PER_TICK, candidates.length);
  let deleteJobs = 0;

  for (let n = 0; n < toCheck; n++) {
    const [rid, bookmarkId] = candidates[(offset + n) % candidates.length];
    // Pairs outside the nested root listing (e.g. cleared outside-root allowlist)
    // never appear in seenIds — confirm with a direct get before deleting Edge.
    if (await raindropStillAlive(client, rid)) {
      client.throwIfShouldPause();
      continue;
    }
    const added = await queue.enqueueJob({
      id: `de-${rid}`,
      kind: JOB.DELETE_EDGE,
      raindropId: rid,
      bookmarkId,
    });
    if (added) deleteJobs++;
    client.throwIfShouldPause();
  }

  const nextOffset = (offset + toCheck) % candidates.length;
  await setReconcileState({ aliveConfirmOffset: nextOffset });

  if (deleteJobs > 0) {
    await appendLog("info", `Reconcile queued ${deleteJobs} Edge delete(s) for missing raindrops.`);
  }
  const deferred = candidates.length - toCheck;
  if (deferred > 0) {
    await appendLog(
      "info",
      `Reconcile deferred ${deferred} delete-confirm GET(s) to stay under rate limits (will rotate next cycle).`
    );
  }
}

/**
 * True when Raindrop still has a non-trashed item for this id.
 * Fail-soft on transient errors (5xx/network): assume alive so we do not
 * false-delete Edge pairs. Only definite absence (null / 404 / trash) ⇒ gone.
 */
async function raindropStillAlive(client, rid) {
  try {
    const item = await client.getRaindrop(rid);
    if (!item) return false;
    const col = item.collection?.$id ?? item.collection?.id;
    if (col === -99 || col === "-99") return false;
    return true;
  } catch (err) {
    if (err instanceof AuthError || err instanceof RateLimitError) throw err;
    if (err instanceof RaindropError && /\bfailed:\s*404\b/.test(err.message)) {
      return false;
    }
    // 5xx / network / unknown — skip delete this tick.
    return true;
  }
}

/**
 * Shared pull gate for root-nested and outside-root listing paths.
 * Always records `item._id` on `ctx.seenIds` (delete-detection), then applies
 * tombstone / pair / link / type / exclude / allowlist filters before enqueue.
 *
 * @param {object} item Raindrop API raindrop
 * @param {{
 *   index: object,
 *   rootId: number|string,
 *   config: object,
 *   overrides: object,
 *   topRoots: object,
 *   allowlist: object,
 *   folderMode: string,
 *   pairs: { byRaindrop: Record<string, string> },
 *   seenIds: Set<string>,
 * }} ctx
 * @param {(colId: number|string|undefined) => string[]|null|undefined} resolveRelative
 *   Relative Edge mirror segments; `null`/`undefined` skips (unknown / not under root).
 *   An empty array is valid (bookmark living directly under the sync root).
 * @returns {Promise<0|1>} 1 when a new PULL_CREATE job was enqueued
 */
async function maybeEnqueuePullCreate(item, ctx, resolveRelative) {
  const rid = String(item._id);
  ctx.seenIds.add(rid);

  if (await hasTombstone(rid)) return 0;
  if (ctx.pairs.byRaindrop[rid]) return 0;
  if (!item.link) return 0;
  if (item.type === "file" || item.type === "document") return 0;

  const colId = item.collection?.$id ?? item.collection?.id;
  const relative = resolveRelative(colId);
  // null/undefined ⇒ skip; [] is valid (bookmark living directly under sync root).
  if (relative == null) return 0;

  if (
    await pathIsExcluded(
      relative,
      ctx.topRoots,
      ctx.overrides,
      ctx.config.defaultPolicy,
      ctx.config.rootName
    )
  ) {
    return 0;
  }

  const edgeExists = await mirrorPathExists(relative, ctx.config.rootName, ctx.topRoots);
  if (
    !canCreateRaindropOnlyPath({
      allowlist: ctx.allowlist,
      collectionId: colId,
      index: ctx.index,
      rootId: ctx.rootId,
      edgePathExists: edgeExists,
      folderMode: ctx.folderMode,
    })
  ) {
    return 0;
  }

  const added = await queue.enqueueJob({
    id: `pull-${rid}`,
    kind: JOB.PULL_CREATE,
    raindropId: rid,
    link: item.link,
    title: item.title || item.link,
    relativeSegments: relative,
    collectionId: colId != null ? String(colId) : null,
  });
  return added ? 1 : 0;
}

/**
 * Empty-folder ensure: allowlisted collections always (when allowlist active);
 * otherwise full mirror-all under root when mode is mirror-all.
 */
async function ensureAllowlistedOrMirrorAll(
  index,
  rootId,
  config,
  overrides,
  topRoots,
  folderMode,
  allowlist
) {
  let targets;
  if (isAllowlistActive(allowlist)) {
    targets = collectionsForAllowlistPicker(index, rootId).filter(({ collectionId }) =>
      isCollectionAllowed(collectionId, index, rootId, allowlist)
    );
  } else if (folderMode === RAINDROP_FOLDER_MODE.MIRROR_ALL) {
    targets = collectionsUnderRoot(index, rootId);
  } else {
    return;
  }

  let ensured = 0;
  for (const { relativeSegments } of targets) {
    if (!relativeSegments.length) continue;
    if (
      await pathIsExcluded(
        relativeSegments,
        topRoots,
        overrides,
        config.defaultPolicy,
        config.rootName
      )
    ) {
      continue;
    }
    await ensureMirrorFolderPath(relativeSegments, config.rootName, topRoots);
    ensured++;
  }
  if (ensured > 0) {
    const label = isAllowlistActive(allowlist) ? "Allowlist" : "Mirror-all";
    await appendLog("info", `${label} ensured ${ensured} Edge folder path(s).`);
  }
}

async function pathIsExcluded(relativeSegments, topRoots, overrides, defaultPolicy, rootName) {
  const ancestorIds = await ancestorIdsForMirrorPath(relativeSegments, rootName, topRoots);
  return isExcluded(ancestorIds, overrides, defaultPolicy);
}
