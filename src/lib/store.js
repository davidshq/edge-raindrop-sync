// Durable state layer over chrome.storage.local.
//
// The MV3 service worker is ephemeral, so every piece of state the engine needs
// to survive a restart lives here: config, per-folder policy overrides, the
// bidirectional pair map, tombstones, suppressions, collection-path cache,
// Edge folder→collection map (for in-place folder renames), the job queue,
// and status/log. Opt-in long-term activity history lives in
// IndexedDB via log-archive.js (keepLongTermLog), not chrome.storage.local.
//
// Pair and suppress mutations share withLock with the queue so concurrent
// drain / live-capture / reconcile cannot clobber each other's RMW updates.
// Legacy DEDUP is migrated into PAIRS on first load; pair mutations write PAIRS only.
// Confirmed deletes/offloads use clearPairWithTombstone (tombstone + forget pair).

import { KEY, DEFAULT_CONFIG, LOG_LIMIT, SUPPRESS_MS, POLICY, SYNC_MODE } from "./constants.js";
import { withLock } from "./mutex.js";
import { appendArchiveEntry } from "./log-archive.js";

async function read(key, fallback) {
  const got = await chrome.storage.local.get(key);
  return key in got ? got[key] : fallback;
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/* ---- config ---- */
// getConfig merges DEFAULT_CONFIG so new fields (e.g. raindropFolderMode) appear
// on older installs without a dedicated migration.
// Bidirectional always keeps both sides globally; stale sync-and-delete is
// coerced (and healed in storage) so Options copy and the engine agree.

/** Force keep-both when bidirectional; folder Offload overrides still work. */
export function normalizeConfig(config) {
  const next = { ...config };
  if (next.syncMode === SYNC_MODE.BIDIRECTIONAL && next.defaultPolicy !== POLICY.SYNC_KEEP) {
    next.defaultPolicy = POLICY.SYNC_KEEP;
  }
  if (!next.raindropFolderAllowlist || typeof next.raindropFolderAllowlist !== "object") {
    next.raindropFolderAllowlist = {};
  }
  next.keepLongTermLog = !!next.keepLongTermLog;
  return next;
}

export async function getConfig() {
  const stored = await read(KEY.CONFIG, {});
  const merged = { ...DEFAULT_CONFIG, ...stored };
  const config = normalizeConfig(merged);
  // Heal stale installs that enabled bidirectional before save coerced policy.
  if (
    stored.syncMode === SYNC_MODE.BIDIRECTIONAL &&
    stored.defaultPolicy &&
    stored.defaultPolicy !== POLICY.SYNC_KEEP
  ) {
    await write(KEY.CONFIG, config);
  }
  return config;
}

export async function setConfig(patch) {
  const next = normalizeConfig({ ...(await getConfig()), ...patch });
  await write(KEY.CONFIG, next);
  return next;
}

/** Raindrop-only collection allowlist (drafted with folder policies in Options). */
export async function getRaindropFolderAllowlist() {
  const config = await getConfig();
  return { ...(config.raindropFolderAllowlist || {}) };
}

export async function setRaindropFolderAllowlist(allowlist) {
  return setConfig({ raindropFolderAllowlist: allowlist ?? {} });
}

/* ---- per-folder policy overrides (keyed by bookmark folder id) ---- */

export async function getOverrides() {
  return read(KEY.OVERRIDES, {});
}

/** Replace the entire overrides map in one write (options Save). */
export async function setOverrides(overrides) {
  await write(KEY.OVERRIDES, overrides ?? {});
}

export async function setOverride(folderId, policy, path) {
  const overrides = await getOverrides();
  overrides[folderId] = { policy, path };
  await write(KEY.OVERRIDES, overrides);
}

export async function clearOverride(folderId) {
  const overrides = await getOverrides();
  delete overrides[folderId];
  await write(KEY.OVERRIDES, overrides);
}

/* ---- bidirectional pairs (bookmark id ↔ raindrop id) ---- */

function emptyPairs() {
  return { byBookmark: {}, byRaindrop: {} };
}

/** Load PAIRS, migrating from legacy DEDUP if needed. Caller must hold withLock. */
async function loadPairsUnlocked() {
  const existing = await read(KEY.PAIRS, null);
  if (existing && existing.byBookmark && existing.byRaindrop) return existing;

  const legacy = await read(KEY.DEDUP, {});
  const pairs = emptyPairs();
  for (const [bookmarkId, raindropId] of Object.entries(legacy)) {
    if (raindropId == null) continue;
    const rid = String(raindropId);
    pairs.byBookmark[bookmarkId] = rid;
    pairs.byRaindrop[rid] = bookmarkId;
  }
  await write(KEY.PAIRS, pairs);
  return pairs;
}

/** Migrate legacy DEDUP map into PAIRS once, then keep PAIRS authoritative (no dual-write). */
export async function ensurePairsMigrated() {
  return withLock(() => loadPairsUnlocked());
}

export async function getPairs() {
  return ensurePairsMigrated();
}

export async function hasSynced(bookmarkId) {
  const pairs = await getPairs();
  return Object.prototype.hasOwnProperty.call(pairs.byBookmark, bookmarkId);
}

export async function getRaindropId(bookmarkId) {
  const pairs = await getPairs();
  return pairs.byBookmark[bookmarkId] ?? null;
}

export async function getBookmarkIdForRaindrop(raindropId) {
  const pairs = await getPairs();
  return pairs.byRaindrop[String(raindropId)] ?? null;
}

export async function recordSynced(bookmarkId, raindropId) {
  return withLock(async () => {
    const pairs = await loadPairsUnlocked();
    const rid = String(raindropId);
    // Drop any previous reverse link for this raindrop or bookmark.
    const prevRid = pairs.byBookmark[bookmarkId];
    if (prevRid != null) delete pairs.byRaindrop[String(prevRid)];
    const prevBid = pairs.byRaindrop[rid];
    if (prevBid != null) delete pairs.byBookmark[prevBid];
    pairs.byBookmark[bookmarkId] = rid;
    pairs.byRaindrop[rid] = bookmarkId;
    await write(KEY.PAIRS, pairs);
  });
}

export async function forgetSynced(bookmarkId) {
  return withLock(async () => {
    const pairs = await loadPairsUnlocked();
    const rid = pairs.byBookmark[bookmarkId];
    if (rid != null) delete pairs.byRaindrop[String(rid)];
    delete pairs.byBookmark[bookmarkId];
    await write(KEY.PAIRS, pairs);
  });
}

export async function forgetPairByRaindrop(raindropId) {
  return withLock(async () => {
    const pairs = await loadPairsUnlocked();
    const rid = String(raindropId);
    const bookmarkId = pairs.byRaindrop[rid];
    if (bookmarkId != null) delete pairs.byBookmark[bookmarkId];
    delete pairs.byRaindrop[rid];
    await write(KEY.PAIRS, pairs);
    return bookmarkId ?? null;
  });
}

/* ---- tombstones (block recreate after user delete) ---- */

export async function getTombstones() {
  return read(KEY.TOMBSTONES, {});
}

export async function hasTombstone(raindropId) {
  const stones = await getTombstones();
  return Object.prototype.hasOwnProperty.call(stones, String(raindropId));
}

export async function addTombstone(raindropId, reason) {
  const stones = await getTombstones();
  stones[String(raindropId)] = { at: Date.now(), reason: reason || "delete" };
  await write(KEY.TOMBSTONES, stones);
}

/**
 * Confirmed delete / offload: tombstone then drop the pair so pull cannot
 * recreate and the bookmarkId mapping cannot go stale.
 * @returns {Promise<string|null>} prior bookmark id, if any
 */
export async function clearPairWithTombstone(raindropId, reason) {
  await addTombstone(raindropId, reason);
  return forgetPairByRaindrop(raindropId);
}

export async function clearTombstone(raindropId) {
  const stones = await getTombstones();
  delete stones[String(raindropId)];
  await write(KEY.TOMBSTONES, stones);
}

/** Drop tombstones for raindrop ids confirmed absent after a reconcile pass. */
export async function pruneTombstones(absentRaindropIds) {
  const stones = await getTombstones();
  let changed = false;
  for (const id of absentRaindropIds) {
    const key = String(id);
    if (stones[key]) {
      delete stones[key];
      changed = true;
    }
  }
  if (changed) await write(KEY.TOMBSTONES, stones);
}

/* ---- suppressions for extension-authored create/remove ---- */

async function getSuppress() {
  const raw = await read(KEY.SUPPRESS, { removes: {}, creates: {}, changes: {} });
  return {
    removes: raw.removes || {},
    creates: raw.creates || {},
    changes: raw.changes || {},
  };
}

async function writeSuppress(suppress) {
  await write(KEY.SUPPRESS, suppress);
}

function sweepExpired(map, now) {
  for (const [k, expiresAt] of Object.entries(map)) {
    if (expiresAt <= now) delete map[k];
  }
}

/** Record a suppression expiry under `bucket` (`removes` | `creates` | `changes`). */
async function suppressKey(bucket, key) {
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress[bucket], now);
    suppress[bucket][key] = now + SUPPRESS_MS;
    await writeSuppress(suppress);
  });
}

/**
 * Consume a suppression under `bucket`. Returns true if it was still valid.
 * Always persists after sweep so expired entries are cleaned up.
 */
async function consumeKey(bucket, key) {
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress[bucket], now);
    const expiresAt = suppress[bucket][key];
    if (expiresAt == null) {
      await writeSuppress(suppress);
      return false;
    }
    delete suppress[bucket][key];
    await writeSuppress(suppress);
    return expiresAt > now;
  });
}

export async function suppressRemove(bookmarkId) {
  return suppressKey("removes", bookmarkId);
}

export async function consumeRemoveSuppression(bookmarkId) {
  return consumeKey("removes", bookmarkId);
}

export async function suppressCreate(url) {
  if (!url) return;
  return suppressKey("creates", url);
}

export async function consumeCreateSuppression(url) {
  if (!url) return false;
  return consumeKey("creates", url);
}

/** Suppress onMoved/onChanged echo when reconcile applies a Raindrop→Edge update. */
export async function suppressChange(bookmarkId) {
  if (!bookmarkId) return;
  return suppressKey("changes", String(bookmarkId));
}

/**
 * True while a change suppression window is active (does not consume).
 * onChanged and onMoved may both fire for one pull-update; both must stay quiet.
 */
export async function isChangeSuppressed(bookmarkId) {
  if (!bookmarkId) return false;
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress.changes, now);
    const expiresAt = suppress.changes[String(bookmarkId)];
    await writeSuppress(suppress);
    return expiresAt != null && expiresAt > now;
  });
}

/* ---- reconcile progress ---- */

export async function getReconcileState() {
  return read(KEY.RECONCILE, {
    cursorPage: 0,
    running: false,
    lastRunAt: null,
    lastError: null,
    /** Rotating index into delete-confirm candidates (survives completed cycles). */
    aliveConfirmOffset: 0,
    /** Rotating index into tombstone-prune candidates (survives completed cycles). */
    tombstonePruneOffset: 0,
  });
}

export async function setReconcileState(patch) {
  const next = { ...(await getReconcileState()), ...patch };
  await write(KEY.RECONCILE, next);
  return next;
}

/* ---- collection-path cache: "Edge/Work/ProjectA" -> collectionId ---- */

export async function getCollectionCache() {
  return read(KEY.COLLECTION_CACHE, {});
}

export async function cacheCollection(path, collectionId) {
  const cache = await getCollectionCache();
  cache[path] = collectionId;
  await write(KEY.COLLECTION_CACHE, cache);
}

/** Drop one path→id entry after the live Raindrop index no longer has that id. */
export async function uncacheCollection(path) {
  const cache = await getCollectionCache();
  if (!(path in cache)) return;
  delete cache[path];
  await write(KEY.COLLECTION_CACHE, cache);
}

export async function clearCollectionCache() {
  await write(KEY.COLLECTION_CACHE, {});
}

/**
 * After an in-place Raindrop collection rename, rewrite path→id cache keys
 * whose leaf (or ancestor prefix) used the old title for this collection id.
 * @param {string|number} collectionId
 * @param {string} newTitle
 */
export async function rewriteCollectionCacheForRename(collectionId, newTitle) {
  const cache = await getCollectionCache();
  const target = String(collectionId);
  const oldPaths = Object.entries(cache)
    .filter(([, id]) => String(id) === target)
    .map(([path]) => path);
  if (!oldPaths.length) return;

  const next = { ...cache };
  for (const oldPath of oldPaths) {
    const parts = oldPath.split("/");
    parts[parts.length - 1] = newTitle;
    const newPath = parts.join("/");
    if (newPath === oldPath) continue;
    for (const path of Object.keys(next)) {
      if (path === oldPath || path.startsWith(`${oldPath}/`)) {
        const rewritten = newPath + path.slice(oldPath.length);
        next[rewritten] = next[path];
        delete next[path];
      }
    }
  }
  await write(KEY.COLLECTION_CACHE, next);
}

/* ---- Edge folder id → Raindrop collection id (folder renames) ---- */

export async function getFolderCollections() {
  return read(KEY.FOLDER_COLLECTIONS, {});
}

export async function getFolderCollectionId(folderId) {
  if (folderId == null || folderId === "") return null;
  const map = await getFolderCollections();
  const id = map[String(folderId)];
  return id != null ? id : null;
}

export async function recordFolderCollection(folderId, collectionId) {
  if (folderId == null || folderId === "" || collectionId == null) return;
  const map = await getFolderCollections();
  map[String(folderId)] = collectionId;
  await write(KEY.FOLDER_COLLECTIONS, map);
}

export async function clearFolderCollection(folderId) {
  if (folderId == null || folderId === "") return;
  const map = await getFolderCollections();
  const key = String(folderId);
  if (!(key in map)) return;
  delete map[key];
  await write(KEY.FOLDER_COLLECTIONS, map);
}

/* ---- status + log (surfaced in the UI) ---- */

export async function getStatus() {
  return read(KEY.STATUS, {
    pending: 0,
    lastError: null,
    deletionsHalted: false,
    lastActivityAt: null,
    /** @type {number|null} epoch ms — skip Raindrop API work until then */
    rateLimitedUntil: null,
  });
}

export async function setStatus(patch) {
  const next = { ...(await getStatus()), ...patch };
  await write(KEY.STATUS, next);
  return next;
}

/** True while a global Raindrop rate-limit pause is active. */
export async function isRateLimited(now = Date.now()) {
  const { rateLimitedUntil } = await getStatus();
  return rateLimitedUntil != null && rateLimitedUntil > now;
}

/**
 * Enter (or extend) the global Raindrop pause. Idempotent log-wise for callers.
 * @param {number} until epoch ms
 * @returns {Promise<boolean>} true if this call newly entered / extended the window
 */
export async function noteRateLimitedUntil(until) {
  const status = await getStatus();
  const prev = status.rateLimitedUntil ?? 0;
  if (until <= prev) return false;
  await setStatus({ rateLimitedUntil: until });
  return true;
}

/** Clear the global pause after a successful tick past the window. */
export async function clearRateLimit() {
  const status = await getStatus();
  if (status.rateLimitedUntil == null) return;
  await setStatus({ rateLimitedUntil: null });
}

export async function getLog() {
  return read(KEY.LOG, []);
}

export async function appendLog(level, message, at) {
  const entry = { at: at ?? Date.now(), level, message };
  const log = await getLog();
  log.unshift(entry);
  await write(KEY.LOG, log.slice(0, LOG_LIMIT));
  // Opt-in IndexedDB archive; never fail the recent write or sync path.
  try {
    const { keepLongTermLog } = await getConfig();
    if (keepLongTermLog) await appendArchiveEntry(entry);
  } catch (err) {
    console.error("[ers] log archive append failed:", err);
  }
}

export { read as _read, write as _write };
