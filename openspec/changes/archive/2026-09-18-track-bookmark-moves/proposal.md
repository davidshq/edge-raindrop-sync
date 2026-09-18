## Why

Dragging an Edge bookmark between folders, editing its title/URL, or renaming a folder are common reorganizations, but the extension only listened to `onCreated` / `onRemoved` (moves are partially in flight). Without live updates, Raindrop placement and Edge-owned fields go stale and Recent activity stays empty. Users reasonably expect these Edge edits to update Raindrop the same way creates and deletes do.

## What Changes

- Register `chrome.bookmarks.onMoved` and enqueue durable work for folder-parent changes (not same-folder reorders).
- Register `chrome.bookmarks.onChanged` for URL bookmarks (title and/or URL) and for folders (title rename).
- For paired URL bookmarks, field-selective update of Edge-owned fields (`link`, `title`, `collection` placement); create if unpaired and policy allows.
- When a **folder** is moved, walk descendant URL bookmarks and enqueue each (Chromium does not fire per-child `onMoved`).
- When a **folder** is renamed, rename the mirrored Raindrop collection in place (`PUT /collection/{id}`) using a persisted `edgeFolderId → raindropCollectionId` map; rewrite path-cache keys for that subtree. Do **not** fan-out recreate paths (avoids orphaning the old-titled collection).
- Honor destination policy on move/change: `exclude` skips Raindrop writes; `sync-and-delete` still offloads Edge after a confirmed create/update as today.
- Activity lines distinguish create vs placement move vs title/URL update vs folder rename.
- Document Edge→Raindrop live updates; Raindrop→Edge placement/title drift remains out of scope.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `bookmark-sync-engine`: Live capture includes parent-folder moves, bookmark title/URL changes, and folder renames; drain updates Edge-owned raindrop fields; folder moves fan out to child URLs; folder renames update the Raindrop collection title; activity reflects each case.
- `bidirectional-sync`: Clarify that Edge moves/renames/title-URL edits update Raindrop without delete/tombstone side effects; policy-driven offload after move/update still uses suppressions as today.
- `sync-policies`: Destination-folder policy applies on move and onChanged drains (exclude skip; sync-and-delete offload after confirmed write). Folder rename under exclude is a no-op for Raindrop.

## Impact

- `src/background/service-worker.js` — `onMoved` + `onChanged` listeners
- `src/lib/sync.js` — `handleBookmarkMoved`; `handleBookmarkChanged`; paired upload updates `link`/`title`/`collectionId`; folder-rename job drain; activity wording
- `src/lib/bookmarks.js` — URL descendant walk (moves); helpers as needed for rename path-cache rewrite
- `src/lib/raindrop.js` — `updateCollection({ title })` (updateRaindrop already supports link/title/collection)
- `src/lib/store.js` (+ constants) — persist `folderId → collectionId`; path-cache rewrite/uncache helpers
- `src/lib/collections.js` — when ensuring a path during upload, record folderId↔collectionId for each Edge ancestor segment
- `scripts/verify-checklist.mjs` (+ mocks) — move / onChanged / folder-rename / exclude / offload cases
- `README.md` — live Edge updates in scope; note remaining Raindrop→Edge gaps
