## Context

`appendLog` always unshifts a new `{ at, level, message }` row into the recent ring (`LOG_LIMIT` 500) and, when long-term logging is on, `add`s a new IndexedDB row. Idle reconcile lines such as "Allowlist ensured 414 Edge folder path(s)." repeat every completed cycle with nothing else between them. The message itself is fine; the duplicate rows are not.

## Goals / Non-Goals

**Goals:**

- Consecutive identical activity lines occupy one recent-log slot and one archive row
- Keep occurrence times for debug/export (`ats`), capped
- Status shows the latest timestamp and a quiet `×N`
- Existing one-shot rows (no `ats`) keep rendering

**Non-Goals:**

- Suppressing the allowlist-ensure log at the source
- Merging non-adjacent duplicates
- An expand/collapse UI for the timestamp list
- Changing reconcile cadence or what counts as "ensured"

## Decisions

### D1. Coalesce in `appendLog`, consecutive only

**Choice:** If `log[0]` has the same `level` and `message`, rewrite that slot. Otherwise unshift a new row.

**Why:** One write path feeds both the recent ring and the archive. Matching only the newest entry preserves interleaving: `Synced:` between two ensure lines starts a new ensure row.

**Alternative:** Collapse only in the options renderer. Rejected — the 500-slot ring and the archive would still fill with duplicates.

### D2. Optional `ats`, oldest first, cap 100

**Choice:** Entry shape stays `{ at, level, message, ats?: number[] }`. `at` is the latest time (what the UI already renders). `ats` is every kept occurrence, oldest → newest, including the latest. A first occurrence omits `ats`. `LOG_ATS_LIMIT = 100`; drop oldest when over the cap.

**Why:** `×N` is `ats.length`. Export/DevTools can see cadence without a second field. The cap stops a stuck heartbeat error from growing one row without bound.

**Alternative:** `count` + `lastAt` only. Rejected — loses the intermediate times the earlier discussion wanted for debug.

### D3. Archive updates the newest row in place

**Choice:** `appendArchiveEntry` receives the same object `appendLog` just stored. If the highest-id archive row matches `level` + `message`, `put` that id with the new `at` / `ats`. Otherwise `add`. Export includes `ats` when present. No IndexedDB version bump; `ats` is an optional property.

**Why:** A new `add` on every repeat would keep growing the 50 000 cap with the same line. In-place update keeps "one run, one row" in both stores.

### D4. Status shows `×N`, no expander

**Choice:** Options renders `entry.at` as today, and appends `×N` when `ats.length > 1`. No control to list the times. Tooltip can say the line repeated N times.

**Why:** The list stays scannable. Full `ats` remains in `chrome.storage.local` and in archive export.

## Risks / Trade-offs

- **[Cap drops older times]** → 100 is enough to see cadence (allowlist ensure is ~45 minutes apart). Document the cap.
- **[Archive and recent log can diverge if one store failed earlier]** → Each store coalesces against its own newest row. A failed archive write does not block the recent log (existing isolation).
- **[Readers that only expect `at`/`level`/`message`]** → `ats` is additive. Old rows without it still display as a single line.

## Migration Plan

No migration. Rows already stored stay as they are. The next identical line coalesces with the current head if it matches. Rollback is reverting `appendLog`; leftover `ats` fields are ignored by the old renderer.

## Open Questions

None. Cap 100, oldest-first `ats`, archive in-place update, and `×N` were locked before this change.
