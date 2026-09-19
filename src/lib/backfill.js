// Backfill: enqueue every existing bookmark whose resolved policy is not
// `exclude` and which has not already been synced. Safe to run anytime.
//
// The durable queue IS the resumable cursor: enqueued ids are persisted, so a
// worker restart mid-backfill resumes from whatever is still queued rather than
// re-walking and re-uploading. The pair map (hasSynced) guards against re-uploads too.

import { POLICY } from "./constants.js";
import { getConfig, getOverrides, hasSynced, appendLog, setStatus } from "./store.js";
import { collectAllBookmarks } from "./bookmarks.js";
import { resolvePolicy } from "./policy.js";
import { enqueueMany, size } from "./queue.js";

export async function startBackfill() {
  const config = await getConfig();
  const overrides = await getOverrides();
  const all = await collectAllBookmarks();

  const ids = [];
  for (const { node, ancestorIds } of all) {
    const effective = resolvePolicy(ancestorIds, overrides, config.defaultPolicy);
    if (effective === POLICY.EXCLUDE) continue;
    if (await hasSynced(node.id)) continue;
    ids.push(node.id);
  }

  const added = await enqueueMany(ids);
  await appendLog("info", `Import queued ${added} bookmark(s) (${all.length} scanned).`);
  await setStatus({ pending: await size(), lastPushAt: Date.now() });
  return { scanned: all.length, queued: added };
}
