// The sync engine: drains the durable queue, one bookmark at a time.
//
// Invariant (confirm-before-act): a bookmark is created in Raindrop and its
// dedup mapping persisted BEFORE any local deletion. Any failure leaves the
// bookmark in Edge and the job in the queue.

import { POLICY } from "./constants.js";
import {
  getConfig,
  getOverrides,
  getCollectionCache,
  cacheCollection,
  hasSynced,
  recordSynced,
  setStatus,
  appendLog,
} from "./store.js";
import * as queue from "./queue.js";
import { getNode, getChildren, removeNode, removeFolder, resolveLocation } from "./bookmarks.js";
import { resolvePolicy } from "./policy.js";
import { RaindropClient, AuthError, RateLimitError } from "./raindrop.js";
import { buildCollectionIndex, ensureCollectionPath } from "./collections.js";

let draining = false; // best-effort in-memory reentrancy guard (idempotent anyway)

export async function drain() {
  if (draining) return;
  draining = true;
  try {
    await drainLoop();
  } catch (err) {
    await appendLog("error", `Drain crashed: ${err.message}`);
  } finally {
    draining = false;
  }
}

async function drainLoop() {
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

  for (const job of dueJobs) {
    try {
      await processJob(job, { client, config, overrides, cache, getIndex });
    } catch (err) {
      if (err instanceof AuthError) {
        await setStatus({ deletionsHalted: true, lastError: err.message });
        await appendLog("error", `${err.message} — deletions halted, jobs kept.`);
        await setStatus({ pending: await queue.size() });
        return; // stop the whole pass; nothing deleted
      }
      if (err instanceof RateLimitError) {
        await queue.deferUntil(job.id, err.retryAt);
        await appendLog("warn", "Rate limited by Raindrop; backing off.");
        await setStatus({ pending: await queue.size() });
        return; // heartbeat resumes after the backoff window
      }
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
  const { client, config, overrides, cache, getIndex } = ctx;

  let node;
  try {
    node = await getNode(job.id);
  } catch {
    // Bookmark no longer exists (already synced+deleted, or removed by hand).
    await queue.remove(job.id);
    return;
  }
  if (!node.url) {
    await queue.remove(job.id); // a folder slipped in; nothing to sync
    return;
  }

  const { segments, ancestorIds } = await resolveLocation(node);
  const effective = resolvePolicy(ancestorIds, overrides, config.defaultPolicy);

  if (effective === POLICY.EXCLUDE) {
    await queue.remove(job.id);
    return;
  }

  // Sync to Raindrop unless we already have (idempotent across retries/restarts).
  if (!(await hasSynced(job.id))) {
    const index = await getIndex();
    const fullSegments = [config.rootName, ...segments];
    const collectionId = await ensureCollectionPath(
      client,
      index,
      fullSegments,
      cache,
      cacheCollection,
    );
    const item = await client.createRaindrop({
      link: node.url,
      title: node.title,
      collectionId,
    });
    await recordSynced(job.id, item._id); // persist BEFORE any deletion
    await appendLog("info", `Synced: ${node.title || node.url}`);
  }

  // Apply the local action. This also recovers the crash case where a previous
  // pass synced but died before deleting.
  if (effective === POLICY.SYNC_DELETE) {
    const parentId = node.parentId;
    await removeNode(job.id);
    if (config.pruneEmpty) await pruneIfEmpty(parentId, config, overrides);
  }

  await queue.remove(job.id);
}

// Remove a folder if it is now empty, walking upward — but never the top roots
// (parentId "0") and never folders the user marked `exclude`.
async function pruneIfEmpty(folderId, config, overrides) {
  let id = folderId;
  while (id) {
    let folder;
    try {
      folder = await getNode(id);
    } catch {
      return;
    }
    if (!folder || folder.parentId === "0") return; // top root or gone
    if (overrides[id]?.policy === POLICY.EXCLUDE) return;
    const children = await getChildren(id);
    if (children.length > 0) return;
    const parentId = folder.parentId;
    await removeFolder(id);
    await appendLog("info", `Pruned empty folder: ${folder.title}`);
    id = parentId; // the parent may now be empty too
  }
}
