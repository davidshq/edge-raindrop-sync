## 1. Capture and helpers (moves) — done

- [x] 1.1 Add `handleBookmarkMoved(id, moveInfo)` in `src/lib/sync.js`: no-op when `oldParentId === parentId`; for URL nodes enqueue upload; for folders walk live descendants and enqueue each URL; call `drain()` once if any jobs added
- [x] 1.2 Add a small tree-walk helper (in `bookmarks.js` or sync) to collect URL descendant ids under a folder
- [x] 1.3 Wire `chrome.bookmarks.onMoved` in `service-worker.js` to `handleBookmarkMoved` with the same error-logging pattern as create/remove

## 2. Drain: paired Edge-owned update (moves base) — done; extend below

- [x] 2.1 Extend `processUpload` so paired bookmarks ensure the destination collection path and call `updateRaindrop` (Edge-owned fields only); keep create path for unpaired
- [x] 2.2 Apply destination-folder policy: `exclude` drops the job with no Raindrop write; after confirmed create/update, `sync-and-delete` still suppress-removes Edge + `edge-offload` tombstone
- [x] 2.3 On Raindrop update 404, clear the stale pair and fall through to create (when policy allows) or drop the job
- [x] 2.4 Append activity `Moved: …` on placement-focused paired update; keep existing `Synced:` for creates

## 3. Docs and verification (moves base) — done; extend below

- [x] 3.1 Update README for Edge→Raindrop moves; note remaining gaps
- [x] 3.2 Add verify-checklist coverage for move cases
- [x] 3.3 Run `npm test` and fix regressions

## 4. Bookmark onChanged (title / URL)

- [x] 4.1 Add `handleBookmarkChanged(id, changeInfo)` for URL nodes: enqueue upload + `drain()`; ignore no-op empty changeInfo if needed
- [x] 4.2 Wire `chrome.bookmarks.onChanged` in `service-worker.js`
- [x] 4.3 Extend paired `processUpload` to `updateRaindrop({ link, title, collectionId })` from the live node (not collection-only)
- [x] 4.4 Activity: `Updated: …` for onChanged-driven paired drains; keep `Moved: … → path` for move-driven drains (job hint or equivalent)
- [x] 4.5 Verify-checklist: title change updates raindrop title; URL change updates link; exclude skips; tags/notes preserved

## 5. Folder rename (Approach A — in-place collection rename)

- [x] 5.1 Add storage map `folderId → collectionId` (+ get/set/clear helpers) and persist mappings when upload ensure walks Edge ancestor folders ↔ collection segments
- [x] 5.2 Add `RaindropClient.updateCollection(id, { title })`
- [x] 5.3 Add durable `rename-collection` job kind; enqueue from folder `onChanged` when mapped and not exclude; drain renames collection title, fixes/drops path-cache prefix, handles 404 by clearing map
- [x] 5.4 Activity: `Renamed folder: …` on success
- [x] 5.5 Verify-checklist: mapped folder rename updates collection title and keeps collection id; unmapped rename no-ops; exclude rename skips; path cache does not keep serving the old title path
- [x] 5.6 Update README: title/URL + folder rename in scope; Raindrop→Edge still deferred
- [x] 5.7 Run `npm test` and fix regressions
