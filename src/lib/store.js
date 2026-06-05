// Durable state layer over chrome.storage.local.
//
// The MV3 service worker is ephemeral, so every piece of state the engine needs
// to survive a restart lives here: config, per-folder policy overrides, the
// dedup map, the collection-path cache, the job queue, and status/log.

import { KEY, DEFAULT_CONFIG, LOG_LIMIT } from "./constants.js";

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

/* ---- dedup map: bookmark id -> raindrop id ---- */

export async function getDedup() {
  return read(KEY.DEDUP, {});
}

export async function hasSynced(bookmarkId) {
  const dedup = await getDedup();
  return Object.prototype.hasOwnProperty.call(dedup, bookmarkId);
}

export async function recordSynced(bookmarkId, raindropId) {
  const dedup = await getDedup();
  dedup[bookmarkId] = raindropId;
  await write(KEY.DEDUP, dedup);
}

export async function forgetSynced(bookmarkId) {
  const dedup = await getDedup();
  delete dedup[bookmarkId];
  await write(KEY.DEDUP, dedup);
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
