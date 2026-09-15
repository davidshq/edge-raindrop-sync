## 1. Constants and config

- [x] 1.1 Raise `LOG_LIMIT` to 500; add `LOG_ARCHIVE_LIMIT` (50000) and `keepLongTermLog: false` on `DEFAULT_CONFIG`
- [x] 1.2 Ensure `getConfig` / save path preserve and coerce `keepLongTermLog` as boolean

## 2. IndexedDB archive module

- [x] 2.1 Add `src/lib/log-archive.js` with open DB, append, count, exportAll, clear, and prune-to-limit
- [x] 2.2 Wire `appendLog` to dual-write when `keepLongTermLog` is true; catch IDB errors without failing the recent write

## 3. Options UI

- [x] 3.1 Add Settings checkbox for long-term log; load/save with config
- [x] 3.2 Add Status controls: archive entry count, Export, Clear (confirm); implement download + clear via `log-archive.js`
- [x] 3.3 Style the new controls to match existing options patterns

## 4. Docs and verification

- [x] 4.1 Document recent (500) vs opt-in long-term archive / export / clear in README
- [x] 4.2 Update or add verify coverage for `LOG_LIMIT` / `keepLongTermLog` defaults if scripts assert them; run relevant verify scripts
