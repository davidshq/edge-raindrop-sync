// Raindrop ↔ Edge reconciliation for bidirectional mode.
//
// Lists raindrops under the configured root (nested), enqueues pull-creates for
// unmapped items, and enqueues Edge deletes when a mapped raindrop disappears.
// Skips Raindrop file/document uploads. Honors tombstones, exclude, folder mode,
// and raindropFolderAllowlist (non-empty ⇒ selective Raindrop-only sync).

import { JOB, SYNC_MODE, RAINDROP_FOLDER_MODE } from "./constants.js";
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
} from "./collections.js";
import {
  isAllowlistActive,
  isCollectionAllowed,
  canCreateRaindropOnlyPath,
  pruneAllowlist,
} from "./allowlist.js";
import { RaindropClient } from "./raindrop.js";

const PER_PAGE = 50;
/** Cap pages per reconcile tick to stay within rate limits / worker lifetime. */
const MAX_PAGES_PER_TICK = 5;

/** In-memory reentrancy guard — overlapping heartbeat + manual reconcile must not interleave. */
let reconciling = false;

/**
 * Run one reconcile pass (or continue from cursor). Safe to call from heartbeat.
 * @returns {{ enqueued: number, pages: number, done: boolean, skipped?: boolean }}
 */
export async function reconcile() {
  if (reconciling) {
    return { enqueued: 0, pages: 0, done: false, skipped: true };
  }
  reconciling = true;
  try {
    return await reconcileOnce();
  } finally {
    reconciling = false;
  }
}

async function reconcileOnce() {
  await ensurePairsMigrated();
  const config = await getConfig();
  if (config.syncMode !== SYNC_MODE.BIDIRECTIONAL) {
    return { enqueued: 0, pages: 0, done: true };
  }
  if (!config.token) {
    await setReconcileState({ lastError: "No Raindrop token configured", running: false });
    return { enqueued: 0, pages: 0, done: true };
  }

  const client = new RaindropClient(config.token);
  const index = await buildCollectionIndex(client);
  const root = findRootCollection(index, config.rootName);
  if (!root) {
    await appendLog("info", `Reconcile: root collection "${config.rootName}" not found yet.`);
    await setReconcileState({
      running: false,
      lastRunAt: Date.now(),
      lastError: null,
      cursorPage: 0,
      seenAcc: null,
    });
    return { enqueued: 0, pages: 0, done: true };
  }

  const state = await getReconcileState();
  let page = state.cursorPage || 0;
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
    // Drop allowlist ids that no longer cover any Raindrop-only path so
    // selective mode cannot stick after collections mirror or disappear.
    const pruned = await pruneAllowlist(allowlist, index, root._id, (relative) =>
      mirrorPathExists(relative, config.rootName, topRoots)
    );
    if (pruned.removed > 0) {
      allowlist = pruned.allowlist;
      await setRaindropFolderAllowlist(allowlist);
      await appendLog(
        "info",
        `Pruned ${pruned.removed} stale Raindrop-only allowlist entr${pruned.removed === 1 ? "y" : "ies"}.`
      );
    }

    while (pages < MAX_PAGES_PER_TICK) {
      const { items, count } = await client.listRaindrops(root._id, {
        page,
        perPage: PER_PAGE,
        nested: true,
      });
      pages++;

      for (const item of items) {
        const rid = String(item._id);
        seenIds.add(rid);

        if (await hasTombstone(rid)) continue;
        if (pairs.byRaindrop[rid]) continue;

        if (!item.link) continue;
        if (item.type === "file" || item.type === "document") continue;

        const colId = item.collection?.$id ?? item.collection?.id;
        const fullPath = collectionPathFromRoot(index, colId, root._id);
        if (!fullPath.length) continue;

        const relative = fullPath.slice(1);
        if (
          await pathIsExcluded(relative, topRoots, overrides, config.defaultPolicy, config.rootName)
        ) {
          continue;
        }

        const edgeExists = await mirrorPathExists(relative, config.rootName, topRoots);
        if (
          !canCreateRaindropOnlyPath({
            allowlist,
            collectionId: colId,
            index,
            rootId: root._id,
            edgePathExists: edgeExists,
            folderMode,
          })
        ) {
          continue;
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
        if (added) enqueued++;
      }

      const fetched = (page + 1) * PER_PAGE;
      const finished = items.length < PER_PAGE || fetched >= count;
      if (finished) {
        await finishDeleteDetection(seenIds, pairs);
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
      await setReconcileState({ cursorPage: page, running: true });
    }

    await mergeSeenAcc(seenIds);
    await setReconcileState({ running: false, cursorPage: page, lastRunAt: Date.now() });
    if (enqueued > 0) {
      await appendLog("info", `Reconcile queued ${enqueued} pull(s); more pages pending.`);
    }
    return { enqueued, pages, done: false };
  } catch (err) {
    await setReconcileState({ running: false, lastError: err.message });
    throw err;
  }
}

async function mergeSeenAcc(seenIds) {
  const state = await getReconcileState();
  const acc = new Set(state.seenAcc || []);
  for (const id of seenIds) acc.add(id);
  await setReconcileState({ seenAcc: [...acc] });
}

async function finishDeleteDetection(seenIds, pairs) {
  const state = await getReconcileState();
  const acc = new Set(state.seenAcc || []);
  for (const id of seenIds) acc.add(id);

  let deleteJobs = 0;
  for (const [rid, bookmarkId] of Object.entries(pairs.byRaindrop)) {
    if (acc.has(rid)) continue;
    if (await hasTombstone(rid)) continue;
    const added = await queue.enqueueJob({
      id: `de-${rid}`,
      kind: JOB.DELETE_EDGE,
      raindropId: rid,
      bookmarkId,
    });
    if (added) deleteJobs++;
  }
  if (deleteJobs > 0) {
    await appendLog("info", `Reconcile queued ${deleteJobs} Edge delete(s) for missing raindrops.`);
  }
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
  const under = collectionsUnderRoot(index, rootId);
  let targets;
  if (isAllowlistActive(allowlist)) {
    targets = under.filter(({ collectionId }) =>
      isCollectionAllowed(collectionId, index, rootId, allowlist)
    );
  } else if (folderMode === RAINDROP_FOLDER_MODE.MIRROR_ALL) {
    targets = under;
  } else {
    return;
  }

  let ensured = 0;
  for (const { relativeSegments } of targets) {
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
