## Context

MV3 Edge↔Raindrop sync already uses a durable queue with exponential backoff. Jobs retry indefinitely; poison payloads can consume the per-drain job budget. Storage usage is unmonitored. Specs say “GUID” but code keys on bookmark node `id`. `sync.js` (~944 lines) and `reconcile.js` (~847) concentrate drain, live handlers, and reconcile finish logic.

## Goals / Non-Goals

**Goals:**
- Cap retries and surface dead-lettered jobs in Options (retry / clear)
- Show local storage byte usage; record write failures in status
- CI runs lint + offline verify scripts on push/PR
- Align specs with node-id identity
- Split sync/reconcile into focused modules behind stable facades

**Non-Goals:**
- SW-only config writes / persisted drain leases (deferred)
- OAuth, store packaging, bundler, Playwright
- Changing backoff timing or rate-limit behavior

## Decisions

### D1. Dead-letter after attempt threshold
**Choice:** `MAX_JOB_ATTEMPTS = 20`. When `queue.defer` would push `attempts` past the cap, remove from queue and append to `KEY.DEAD_LETTER` with `{ ...job, attempts, lastError, deadAt }` in **one** `chrome.storage.local.set` for both keys. Auth halt and rate-limit `deferUntil` do not dead-letter (attempts unchanged on rate-limit path).
**Why:** 20 × capped backoff is enough for transient outages; poison jobs stop starving the drain. A single set avoids losing the job if a second write fails mid-move.

### D2. Dead-letter UX via messages
**Choice:** Extend `GET_STATUS` with `deadLetter` summary; add `MSG.RETRY_DEAD_LETTER` and `MSG.CLEAR_DEAD_LETTER`. Retry re-enqueues with `attempts: 0`.
**Why:** Options already talks to the SW for work; keeps writes in the worker for queue mutations.

### D3. Quota soft-fail
**Choice:** Wrap `chrome.storage.local.set` failures; set `status.lastError` and appendLog. Expose `getStorageUsage()` via `getBytesInUse(null)` and `chrome.storage.local.QUOTA_BYTES` (fallback 10_485_760). Status line shows used / quota.
**Why:** Visibility without requesting `unlimitedStorage` yet.

### D4. Module split boundaries
**Choice:**
- `client-errors.js` — Auth/rate-limit gate shared by drain and reconcile orchestration
- `job-processors.js` — `processJob` + all `process*` handlers
- `drain.js` — `drain` / drain loop
- `live-handlers.js` — bookmark event handlers + `collectRemovedUrlNodes`
- `sync.js` — `tick`, `reconcileNow`, re-exports public API
- `reconcile-enqueue.js` — pull create/update enqueue helpers
- `reconcile-finish.js` — delete-detect, tombstone prune, folder-rename pull, finish cycle
- `reconcile.js` — list/cursor loop; re-exports `reconcile` + `outsideRootListIds`
**Why:** Clear seams without changing behavior; verify scripts keep importing `sync.js` / `reconcile.js`.

### D5. Spec identity wording
**Choice:** Replace GUID with “bookmark node id” / “folder node id” in main specs. Note that Chromium’s on-disk GUID is not exposed by the extensions API.
**Why:** Docs match implementation; README already documents this.

## Risks / Trade-offs

- [Risk] Aggressive dead-letter on flaky networks → Mitigation: Retry button; 20 attempts + 5 min cap is hours of retries before DLQ
- [Risk] Split introduces import cycles → Mitigation: client-errors has no sync import; processors imported by drain only; live-handlers imports drain
- [Risk] Mock missing `getBytesInUse` breaks tests → Mitigation: add to verify-checklist chrome mock

## Migration Plan

No storage migration beyond empty `deadLetter: []` default. Existing queued jobs keep current `attempts` and become eligible for dead-letter on subsequent defers.

## Open Questions

None — thresholds chosen for personal-library pragmatism.
