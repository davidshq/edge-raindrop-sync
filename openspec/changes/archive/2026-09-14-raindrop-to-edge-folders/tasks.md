## 1. Config constants and storage

- [x] 1.1 Add `RAINDROP_FOLDER_MODE` values (`existing-only`, `create-as-needed`, `mirror-all`) and include `raindropFolderMode: "create-as-needed"` in `DEFAULT_CONFIG` (`constants.js`)
- [x] 1.2 Ensure `getConfig` / `setConfig` merge and persist `raindropFolderMode` with no special migration beyond defaults (`store.js`)

## 2. Folder path helpers

- [x] 2.1 Add a helper that returns whether a mirror placement’s folder path fully exists in Edge (walk titles without creating), reusable by reconcile and pull-create (`bookmarks.js`)
- [x] 2.2 Add or extend a helper to ensure an Edge folder path for a Raindrop-relative collection path without creating a bookmark (for mirror-all empty collections)

## 3. Engine: skip, create, mirror

- [x] 3.1 In pull-create drain: when mode is `existing-only` and the path is incomplete, remove the job without creating folders/bookmarks; log a short skip message (`sync.js`)
- [x] 3.2 Keep `create-as-needed` / `mirror-all` pull-create on `resolveEdgeParentForMirror` (ensure-if-missing)
- [x] 3.3 In reconcile: when `existing-only`, skip enqueueing `PULL_CREATE` for raindrops whose Edge path does not fully exist (still authoritative at drain)
- [x] 3.4 In reconcile (or drain-adjacent pass): when `mirror-all`, walk collections under the root and ensure Edge folders for empty paths, honoring exclude via existing ancestor/policy checks (`reconcile.js` / `collections.js` as needed)

## 4. Options UI

- [x] 4.1 Add **Raindrop → Edge folders** `<select>` under the bidirectional settings block with the three modes and mode-specific help text (`options.html` / `options.css`)
- [x] 4.2 Wire load/save and show/hide with sync mode toggles; persist on Save settings (`options.js`)

## 5. Docs and verification

- [x] 5.1 Document the setting and skip-vs-create-vs-mirror behavior in `README.md`
- [x] 5.2 Extend `scripts/verify-bidirectional-logic.mjs` and/or `verify-checklist.mjs` for existing-only skip (no catch-all), create-as-needed folder create, and mirror-all empty folder ensure
- [x] 5.3 Run `npm test` and fix regressions
