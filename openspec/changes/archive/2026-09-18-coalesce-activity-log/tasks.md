## 1. Recent log coalesce

- [x] 1.1 Add `LOG_ATS_LIMIT` (100) and coalesce consecutive identical `level`+`message` rows in `appendLog` (`at` = latest, `ats` oldest-first including latest, omit `ats` on first occurrence, drop oldest past the cap)
- [x] 1.2 Cover coalesce, a different message starting a new row, a different level, and the cap in `scripts/verify-checklist.mjs`

## 2. Archive

- [x] 2.1 Update the newest IndexedDB row in place when it matches; otherwise add. Persist and export `ats` when present

## 3. Status UI and docs

- [x] 3.1 Show latest time plus `×N` when `ats.length > 1`; leave entries without `ats` as a single line
- [x] 3.2 Note consecutive coalescing in the README activity-log bullet
