// Shared constants and defaults for the Edge ↔ Raindrop sync extension.

export const RAINDROP_API = "https://api.raindrop.io/rest/v1";

// The three sync policies. `sync-and-delete` (offload) is the one-way global
// default; bidirectional saves force global `sync-and-keep` and treat offload as
// a per-folder exception only.
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

// Bidirectional only: whether Raindrop collection paths may create Edge folders.
// Ignored when syncMode is one-way. Default create-as-needed matches historical pull.
export const RAINDROP_FOLDER_MODE = {
  EXISTING_ONLY: "existing-only",
  CREATE_AS_NEEDED: "create-as-needed",
  MIRROR_ALL: "mirror-all",
};

export const ALL_RAINDROP_FOLDER_MODES = [
  RAINDROP_FOLDER_MODE.EXISTING_ONLY,
  RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  RAINDROP_FOLDER_MODE.MIRROR_ALL,
];

// Durable queue job kinds. Legacy jobs without `kind` are treated as upload.
export const JOB = {
  UPLOAD: "upload",
  PULL_CREATE: "pull-create",
  DELETE_RAINDROP: "delete-raindrop",
  DELETE_EDGE: "delete-edge",
};

// chrome.runtime message types (popup / options ↔ service worker).
export const MSG = {
  GET_STATUS: "getStatus",
  RUN_BACKFILL: "runBackfill",
  RECONCILE_NOW: "reconcileNow",
  DRAIN_NOW: "drainNow",
};

// chrome.storage.local keys. Everything durable lives under these — the MV3
// service worker holds no state across events.
export const KEY = {
  CONFIG: "config", // { token, rootName, defaultPolicy, pruneEmpty, syncMode, raindropFolderMode, raindropFolderAllowlist }
  OVERRIDES: "overrides", // { [bookmarkFolderId]: { policy, path } }
  QUEUE: "queue", // [ { id, kind, attempts, nextAttemptAt, ... } ]
  DEDUP: "dedup", // legacy { [bookmarkId]: raindropId } — read once into PAIRS, not dual-written
  PAIRS: "pairs", // { byBookmark: { [bookmarkId]: raindropId }, byRaindrop: { [raindropId]: bookmarkId } }
  TOMBSTONES: "tombstones", // { [raindropId]: { at, reason } }
  SUPPRESS: "suppress", // { removes: { [bookmarkId]: expiresAt }, creates: { [url]: expiresAt } }
  RECONCILE: "reconcile", // { cursorPage, outsideCursor, running, lastRunAt, lastError, seenAcc, aliveConfirmOffset }
  COLLECTION_CACHE: "collectionCache", // { [collectionPath]: collectionId }
  STATUS: "status", // { pending, lastError, deletionsHalted, lastActivityAt, rateLimitedUntil }
  LOG: "log", // [ { at, level, message } ] recent ring buffer (LOG_LIMIT)
};

export const DEFAULT_CONFIG = {
  token: "",
  rootName: "Edge",
  defaultPolicy: POLICY.SYNC_DELETE,
  pruneEmpty: false,
  syncMode: SYNC_MODE.ONE_WAY,
  raindropFolderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  /** @type {Record<string, { path: string }>} Raindrop collection ids opted in for Edge sync */
  raindropFolderAllowlist: {},
  /** When true, appendLog also writes to the IndexedDB long-term archive. */
  keepLongTermLog: false,
};

/**
 * Edge folder title that holds allowlisted Raindrop collections outside the
 * sync root. Prefixed onto mirror paths so they land under
 * Other favorites / Raindrop / … instead of colliding with Edge top roots or
 * looking like children of the sync-root mirror folder.
 */
export const OUTSIDE_ROOT_MIRROR_FOLDER = "Raindrop";

// The alarm that drives the drain heartbeat even with no bookmark activity.
export const ALARM_NAME = "ers-heartbeat";
export const HEARTBEAT_MINUTES = 1;
/**
 * Minimum gap between *completed* bidirectional reconcile cycles on the
 * heartbeat. In-progress cursors always continue; manual "Reconcile now"
 * bypasses this. Keeps idle installs from re-listing Raindrop every minute.
 */
export const MIN_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

// Retry/backoff tuning. Backoff is capped so a stuck job keeps being retried.
export const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
export const BASE_BACKOFF_MS = 2000; // 2s, doubled per attempt
export const RATE_LIMIT_FALLBACK_MS = 60 * 1000; // if no Retry-After header
/** Stop Raindrop work early when X-RateLimit-Remaining falls to this. */
export const RATE_LIMIT_RESERVE = 8;
/** Cap queue drains per tick so a large backlog cannot burn the whole minute budget. */
export const MAX_JOBS_PER_DRAIN = 20;
/**
 * Cap GET /raindrop/{id} delete-confirm checks per reconcile finish.
 * Unchecked pairs are left alone until a later tick (fail-soft: no false deletes).
 */
export const MAX_ALIVE_CHECKS_PER_TICK = 8;
/** Cap Raindrop list pages (root + outside-root) per reconcile tick. */
export const MAX_RECONCILE_PAGES_PER_TICK = 5;

// Suppression windows for extension-authored bookmark create/remove events.
export const SUPPRESS_MS = 15_000;

// Recent activity ring buffer in chrome.storage.local (Status UI).
export const LOG_LIMIT = 500;
/** Soft cap for opt-in IndexedDB long-term archive (oldest pruned first). */
export const LOG_ARCHIVE_LIMIT = 50_000;
