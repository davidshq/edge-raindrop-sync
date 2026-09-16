## Why

Dragging an Edge bookmark between folders is a common reorganization, but the extension only listens to `onCreated` / `onRemoved`. Moves are silent: Raindrop collection placement stays stale and Recent activity shows nothing. Users reasonably expect folder changes to update Raindrop (and the activity log) the same way creates and deletes do.

## What Changes

- Register `chrome.bookmarks.onMoved` and enqueue durable work for folder-parent changes (not same-folder reorders).
- For paired URL bookmarks, update the Raindrop item’s **collection placement** (Edge-owned field only) to match the new Edge path; create if unpaired and policy allows.
- When a **folder** is moved, walk descendant URL bookmarks and enqueue each (Chromium does not fire per-child `onMoved`).
- Honor destination policy: `exclude` skips Raindrop writes; `sync-and-delete` still offloads Edge after a confirmed create/update as today.
- Log a clear activity line for successful placement updates (and create/offload paths already covered).
- Document that Edge moves are in scope; title/URL `onChanged` and Raindrop→Edge placement drift remain out of scope for this change.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `bookmark-sync-engine`: Live capture includes parent-folder moves; drain updates Raindrop collection for paired bookmarks; folder moves fan out to child URLs; activity reflects moves.
- `bidirectional-sync`: Clarify that Edge folder moves update Raindrop placement without delete/tombstone side effects; policy-driven offload after move still uses suppressions as today.
- `sync-policies`: Destination-folder policy applies on move (exclude skip; sync-and-delete offload after confirmed write).

## Impact

- `src/background/service-worker.js` — add `onMoved` listener
- `src/lib/sync.js` — `handleBookmarkMoved`; extend upload drain to update collection when already paired
- `src/lib/bookmarks.js` — helper to collect URL descendants under a moved folder (if not already present)
- `src/lib/raindrop.js` — already supports `updateRaindrop({ collectionId })`; no API gap expected
- `scripts/verify-checklist.mjs` (+ mocks) — move / folder-move / exclude / offload cases
- `README.md` — remove “moves out of scope”; describe Edge→Raindrop move behavior
