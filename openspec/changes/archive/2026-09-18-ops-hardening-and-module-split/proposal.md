## Why

Personal sideload installs need better stuck-work observability (poison queue jobs, storage pressure) and a CI gate on the existing verify scripts. Main specs still say “GUID” while the Chromium bookmarks API only exposes node `id`. Large `sync.js` / `reconcile.js` modules raise regression cost for the next sync features.

## What Changes

- Move jobs that exceed a max attempt count into a durable dead-letter list with Options Retry / Clear
- Surface `chrome.storage.local` byte usage in Status; soft-fail storage writes into `lastError` instead of silent failure
- Add GitHub Actions CI for `npm run lint` and `npm test`
- Correct main specs and UI copy: identity is bookmark / folder **node id**, not GUID
- Split `sync.js` and `reconcile.js` into focused modules; keep `sync.js` / `reconcile.js` as public facades for the SW and verify scripts

## Capabilities

### New Capabilities

- `ops-hardening`: Dead-letter queue, storage quota visibility / soft-fail, and CI expectations for the extension’s operational health

### Modified Capabilities

- `bookmark-sync-engine`: Identity wording (GUID → bookmark node id); durable retry becomes capped with dead-letter
- `sync-policies`: Override keys are folder node ids (not GUID)
- `extension-config`: Policy editor keys are folder node ids; Status shows storage usage and dead-letter actions

## Impact

- `src/lib/queue.js`, `store.js`, `constants.js`, `sync.js` (split), `reconcile.js` (split)
- `src/options/*`, `src/background/service-worker.js`, `src/popup/*` if status is shown
- `scripts/verify-*.mjs` (mock `getBytesInUse`, dead-letter cases)
- `.github/workflows/ci.yml`
- Main OpenSpec specs listed above
