// Shared constants and defaults for the Edge ↔ Raindrop sync extension.

export const RAINDROP_API = "https://api.raindrop.io/rest/v1";

// The three sync policies. `sync-and-delete` is the global default.
export const POLICY = {
  SYNC_DELETE: "sync-and-delete",
  SYNC_KEEP: "sync-and-keep",
  EXCLUDE: "exclude",
};

export const ALL_POLICIES = [POLICY.SYNC_DELETE, POLICY.SYNC_KEEP, POLICY.EXCLUDE];

// Global sync direction. One-way is the historical default.
export const SYNC_MODE = {
  ONE_WAY: "one-way",
  BIDIRECTIONAL: "bidirectional",
};

export const ALL_SYNC_MODES = [SYNC_MODE.ONE_WAY, SYNC_MODE.BIDIRECTIONAL];

// Durable queue job kinds. Legacy jobs without `kind` are treated as upload.
export const JOB = {
  UPLOAD: "upload",
  PULL_CREATE: "pull-create",
  DELETE_RAINDROP: "delete-raindrop",
  DELETE_EDGE: "delete-edge",
};

// chrome.storage.local keys. Everything durable lives under these — the MV3
// service worker holds no state across events.
export const KEY = {
  CONFIG: "config", // { token, rootName, defaultPolicy, pruneEmpty, syncMode }
  OVERRIDES: "overrides", // { [bookmarkFolderId]: { policy, path } }
  QUEUE: "queue", // [ { id, kind, attempts, nextAttemptAt, ... } ]
  DEDUP: "dedup", // legacy { [bookmarkId]: raindropId } — migrated into PAIRS
  PAIRS: "pairs", // { byBookmark: { [bookmarkId]: raindropId }, byRaindrop: { [raindropId]: bookmarkId } }
  TOMBSTONES: "tombstones", // { [raindropId]: { at, reason } }
  SUPPRESS: "suppress", // { removes: { [bookmarkId]: expiresAt }, creates: { [url]: expiresAt } }
  RECONCILE: "reconcile", // { cursorPage, running, lastRunAt, lastError }
  COLLECTION_CACHE: "collectionCache", // { [collectionPath]: collectionId }
  STATUS: "status", // { pending, lastError, deletionsHalted, lastActivityAt }
  LOG: "log", // [ { at, level, message } ] (capped)
};

export const DEFAULT_CONFIG = {
  token: "",
  rootName: "Edge",
  defaultPolicy: POLICY.SYNC_DELETE,
  pruneEmpty: false,
  syncMode: SYNC_MODE.ONE_WAY,
};

// The alarm that drives the drain heartbeat even with no bookmark activity.
export const ALARM_NAME = "ers-heartbeat";
export const HEARTBEAT_MINUTES = 1;

// Retry/backoff tuning. Backoff is capped so a stuck job keeps being retried.
export const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
export const BASE_BACKOFF_MS = 2000; // 2s, doubled per attempt
export const RATE_LIMIT_FALLBACK_MS = 60 * 1000; // if no Retry-After header

// Suppression windows for extension-authored bookmark create/remove events.
export const SUPPRESS_MS = 15_000;

// Keep the in-page log bounded.
export const LOG_LIMIT = 200;
