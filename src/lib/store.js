// Durable state layer over chrome.storage.local.
//
// The MV3 service worker is ephemeral, so every piece of state the engine needs
// to survive a restart lives here: config, per-folder policy overrides, the
// bidirectional pair map, tombstones, suppressions, collection-path cache,
// the job queue, and status/log.
//
// Pair and suppress mutations share withLock with the queue so concurrent
// drain / live-capture / reconcile cannot clobber each other's RMW updates.

import { KEY, DEFAULT_CONFIG, LOG_LIMIT, SUPPRESS_MS } from "./constants.js";
import { withLock } from "./mutex.js";

async function read(key, fallback) {
  const got = await chrome.storage.local.get(key);
  return key in got ? got[key] : fallback;
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

/* ---- config ---- */

export async function getConfig() {
  const stored = await read(KEY.CONFIG, {});
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await write(KEY.CONFIG, next);
  return next;
}

/* ---- per-folder policy overrides (keyed by bookmark folder id) ---- */

export async function getOverrides() {
  return read(KEY.OVERRIDES, {});
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

/** Migrate legacy DEDUP map into PAIRS once, then keep PAIRS authoritative. */
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
    // Keep legacy dedup in sync for any external readers / older status tooling.
    const dedup = await read(KEY.DEDUP, {});
    dedup[bookmarkId] = raindropId;
    await write(KEY.DEDUP, dedup);
  });
}

export async function forgetSynced(bookmarkId) {
  return withLock(async () => {
    const pairs = await loadPairsUnlocked();
    const rid = pairs.byBookmark[bookmarkId];
    if (rid != null) delete pairs.byRaindrop[String(rid)];
    delete pairs.byBookmark[bookmarkId];
    await write(KEY.PAIRS, pairs);
    const dedup = await read(KEY.DEDUP, {});
    delete dedup[bookmarkId];
    await write(KEY.DEDUP, dedup);
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
    if (bookmarkId != null) {
      const dedup = await read(KEY.DEDUP, {});
      delete dedup[bookmarkId];
      await write(KEY.DEDUP, dedup);
    }
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
  return read(KEY.SUPPRESS, { removes: {}, creates: {} });
}

async function writeSuppress(suppress) {
  await write(KEY.SUPPRESS, suppress);
}

function sweepExpired(map, now) {
  for (const [k, expiresAt] of Object.entries(map)) {
    if (expiresAt <= now) delete map[k];
  }
}

export async function suppressRemove(bookmarkId) {
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress.removes, now);
    suppress.removes[bookmarkId] = now + SUPPRESS_MS;
    await writeSuppress(suppress);
  });
}

export async function consumeRemoveSuppression(bookmarkId) {
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress.removes, now);
    const expiresAt = suppress.removes[bookmarkId];
    if (expiresAt == null) {
      await writeSuppress(suppress);
      return false;
    }
    delete suppress.removes[bookmarkId];
    await writeSuppress(suppress);
    return expiresAt > now;
  });
}

export async function suppressCreate(url) {
  if (!url) return;
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress.creates, now);
    suppress.creates[url] = now + SUPPRESS_MS;
    await writeSuppress(suppress);
  });
}

export async function consumeCreateSuppression(url) {
  if (!url) return false;
  return withLock(async () => {
    const suppress = await getSuppress();
    const now = Date.now();
    sweepExpired(suppress.creates, now);
    const expiresAt = suppress.creates[url];
    if (expiresAt == null) {
      await writeSuppress(suppress);
      return false;
    }
    delete suppress.creates[url];
    await writeSuppress(suppress);
    return expiresAt > now;
  });
}

/* ---- reconcile progress ---- */

export async function getReconcileState() {
  return read(KEY.RECONCILE, {
    cursorPage: 0,
    running: false,
    lastRunAt: null,
    lastError: null,
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

/* ---- status + log (surfaced in the UI) ---- */

export async function getStatus() {
  return read(KEY.STATUS, {
    pending: 0,
    lastError: null,
    deletionsHalted: false,
    lastActivityAt: null,
  });
}

export async function setStatus(patch) {
  const next = { ...(await getStatus()), ...patch };
  await write(KEY.STATUS, next);
  return next;
}

export async function getLog() {
  return read(KEY.LOG, []);
}

export async function appendLog(level, message, at) {
  const log = await getLog();
  log.unshift({ at: at ?? Date.now(), level, message });
  await write(KEY.LOG, log.slice(0, LOG_LIMIT));
}

export { read as _read, write as _write };
