// Shared constants and defaults for the Edge → Raindrop sync extension.

export const RAINDROP_API = "https://api.raindrop.io/rest/v1";

// The three sync policies. `sync-and-delete` is the global default.
export const POLICY = {
  SYNC_DELETE: "sync-and-delete",
  SYNC_KEEP: "sync-and-keep",
  EXCLUDE: "exclude",
};

export const ALL_POLICIES = [POLICY.SYNC_DELETE, POLICY.SYNC_KEEP, POLICY.EXCLUDE];

// chrome.storage.local keys. Everything durable lives under these — the MV3
// service worker holds no state across events.
export const KEY = {
  CONFIG: "config", // { token, rootName, defaultPolicy, pruneEmpty }
  OVERRIDES: "overrides", // { [bookmarkFolderId]: { policy, path } }
  QUEUE: "queue", // [ { id, attempts, nextAttemptAt } ]
  DEDUP: "dedup", // { [bookmarkId]: raindropId }
  COLLECTION_CACHE: "collectionCache", // { [collectionPath]: collectionId }
  STATUS: "status", // { pending, lastError, deletionsHalted, lastActivityAt }
  LOG: "log", // [ { at, level, message } ] (capped)
};

export const DEFAULT_CONFIG = {
  token: "",
  rootName: "Edge",
  defaultPolicy: POLICY.SYNC_DELETE,
  pruneEmpty: false,
};

// The alarm that drives the drain heartbeat even with no bookmark activity.
export const ALARM_NAME = "ers-heartbeat";
export const HEARTBEAT_MINUTES = 1;

// Retry/backoff tuning. Backoff is capped so a stuck job keeps being retried.
export const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
export const BASE_BACKOFF_MS = 2000; // 2s, doubled per attempt
export const RATE_LIMIT_FALLBACK_MS = 60 * 1000; // if no Retry-After header

// Keep the in-page log bounded.
export const LOG_LIMIT = 200;
