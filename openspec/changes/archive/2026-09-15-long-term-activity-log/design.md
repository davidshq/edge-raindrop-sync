## Context

Activity lines today go only through `appendLog` → `chrome.storage.local` key `log`, truncated to `LOG_LIMIT` (200). The options page renders that array verbatim. MV3 keeps no in-memory history across worker restarts. Sync state (queue, pairs, tombstones) already competes for the ~10 MB `storage.local` quota; a large forever-log there would be the wrong default.

## Goals / Non-Goals

**Goals:**
- Keep a larger **recent** window (500) in `storage.local` for the existing Status UI.
- Offer an **opt-in** long-term archive in IndexedDB that receives every new log line while enabled.
- Let the user **export** (JSON file download) and **clear** the archive from Options.
- Fail soft: IndexedDB errors must not break sync; recent `storage.local` logging continues.

**Non-Goals:**
- Searching/filtering the archive in the UI, paging through older lines in the Status list, or streaming to a remote logger.
- `unlimitedStorage` permission.
- Migrating already-evicted historical lines (impossible — they were discarded).
- Changing log message content or levels.

## Decisions

### D1. Dual-write from `appendLog`
**Choice:** Keep one write path. `appendLog` always updates the recent ring buffer; when `config.keepLongTermLog === true`, also append the same `{ at, level, message }` record to IndexedDB (fire-and-await, catch/log-to-console on failure).

**Why:** Call sites stay unchanged; no risk of recent and archive diverging for new events.

**Alternatives considered:** Separate “archive only” API — more call-site churn. Batch flushes — more complexity for little gain at current volume.

### D2. Opt-in config flag (default off)
**Choice:** `keepLongTermLog: false` on `DEFAULT_CONFIG`, toggled in Settings and saved with other settings.

**Why:** Archive may contain bookmark titles/URLs; opt-in respects privacy and disk use.

### D3. IndexedDB schema
**Choice:** Database `ers-activity-log`, store `entries`, keyPath auto-increment `id`, index on `at`. Records: `{ id?, at, level, message }`.

**Why:** Auto-increment supports ordered export/clear; `at` index allows future age pruning without a full scan.

### D4. Soft cap on archive size
**Choice:** After each append (or periodically), if count exceeds `LOG_ARCHIVE_LIMIT` (e.g. **50_000**), delete oldest by `id`/`at` down to the limit (or delete a batch of oldest).

**Why:** Unbounded IDB growth is a support hazard; 50k short lines is plenty for months of heartbeat noise while staying modest on disk.

### D5. Export / clear via options page + SW messages
**Choice:** Options page owns the download UX (Blob + `<a download>`). Service worker exposes `GET_LOG_ARCHIVE` / `CLEAR_LOG_ARCHIVE` (and include archive count on `GET_STATUS` when enabled). Clear requires an in-page confirm.

**Why:** Options is an extension page with full DOM; SW should not invent downloads. Messages keep IDB access in one module used by SW (same origin as extension).

**Note:** IndexedDB is per-origin; both SW and options page can open the same DB. Prefer **all IDB I/O in the shared lib**, callable from SW message handlers so the options page does not need duplicate open logic for clear/export consistency — options may also call the lib directly since it shares the extension origin. Prefer **direct lib use from options** for export/clear/count to avoid shipping huge JSON through `runtime.sendMessage`. Recent log still comes from SW `GET_STATUS`.

### D6. Raise `LOG_LIMIT` to 500
**Choice:** Constant change only; UI still lists all recent entries.

## Risks / Trade-offs

- **[Risk]** IDB write latency on hot drain path → **Mitigation:** await but keep entries small; do not retry-loop; on failure skip archive for that line.
- **[Risk]** Export of 50k lines can be large / freeze UI briefly → **Mitigation:** build JSON in one pass; disable button while exporting; document soft cap.
- **[Risk]** User disables long-term but expects data wiped → **Mitigation:** turning off stops new writes; clear is explicit so accidental data loss does not happen on uncheck.
- **[Trade-off]** Status list still only shows recent 500, not the full archive — export is the long-history surface.

## Migration Plan

1. Ship with `keepLongTermLog: false` and `LOG_LIMIT = 500`.
2. No data migration; existing `log` array simply grows up to 500.
3. Rollback: remove IDB module and flag; leftover IDB database is harmless orphan data.

## Open Questions

None — soft cap 50k and default-off are fixed for this change.
