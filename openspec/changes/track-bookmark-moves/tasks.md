## 1. Capture and helpers

- [x] 1.1 Add `handleBookmarkMoved(id, moveInfo)` in `src/lib/sync.js`: no-op when `oldParentId === parentId`; for URL nodes enqueue upload; for folders walk live descendants and enqueue each URL; call `drain()` once if any jobs added
- [x] 1.2 Add a small tree-walk helper (in `bookmarks.js` or sync) to collect URL descendant ids under a folder
- [x] 1.3 Wire `chrome.bookmarks.onMoved` in `service-worker.js` to `handleBookmarkMoved` with the same error-logging pattern as create/remove

## 2. Drain: collection update

- [x] 2.1 Extend `processUpload` so paired bookmarks ensure the destination collection path and call `updateRaindrop({ collectionId })` (Edge-owned fields only); keep create path for unpaired
- [x] 2.2 Apply destination-folder policy: `exclude` drops the job with no Raindrop write; after confirmed create/update, `sync-and-delete` still suppress-removes Edge + `edge-offload` tombstone
- [x] 2.3 On Raindrop update 404, clear the stale pair and fall through to create (when policy allows) or drop the job
- [x] 2.4 Append activity `Moved: <title or url> → <path label>` on successful placement update; keep existing `Synced:` for creates

## 3. Docs and verification

- [x] 3.1 Update README: remove moves from “out of scope”; briefly document Edge→Raindrop move + folder-move fan-out; note exclude orphan and Raindrop-side moves still deferred
- [x] 3.2 Add verify-checklist coverage: single bookmark move updates collection; same-parent reorder no-ops; folder move fans out; move into exclude skips write; move into offload updates then removes Edge without Raindrop delete; bidirectional move does not enqueue delete-raindrop
- [x] 3.3 Run `npm test` and fix regressions
