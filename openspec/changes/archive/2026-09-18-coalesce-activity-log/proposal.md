## Why

Finished reconcile cycles log the same idle line every time (for example "Allowlist ensured 414 Edge folder path(s)."). Consecutive repeats fill the recent activity list and the opt-in archive, crowding out real sync events, while the timestamps themselves are still useful for debugging.

## What Changes

- When a new activity line matches the newest entry's level and message, update that entry instead of inserting another row
- Keep occurrence times on the entry (`ats`, capped) so debug/export can reconstruct cadence; Status shows the latest time plus a quiet `×N`
- A different message starts a new row (consecutive only)
- The opt-in IndexedDB archive stores the same coalesced entry, including `ats` on export

## Capabilities

### New Capabilities

### Modified Capabilities

- `extension-config`: Recent activity coalesces consecutive identical lines and shows `×N`
- `activity-log-archive`: Archive writes and export use the coalesced entry shape, including `ats`

## Impact

- `src/lib/store.js` (`appendLog`), `src/lib/log-archive.js`, `src/lib/constants.js`
- `src/options/options.js` and `options.css` (Status list)
- `README.md` activity-log note
- `scripts/verify-checklist.mjs` (storage-level coalesce cases; IndexedDB is not available in the Node harness)
