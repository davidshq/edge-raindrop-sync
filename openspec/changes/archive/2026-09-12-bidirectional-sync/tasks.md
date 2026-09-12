## 1. API spike and metadata safety

- [x] 1.1 Extend `scripts/spike-raindrop.mjs` to list raindrops by collection (including nested), observe pagination, and confirm delete semantics (trash vs permanent).
- [x] 1.2 Spike partial update of a raindrop (title/link/collection only) and verify tags/notes/highlights/cover are not cleared.
- [x] 1.3 Document spike findings in the change design open questions (resolve update-in-v1 vs create+delete+pull-only).

## 2. Config, storage, and pair model

- [x] 2.1 Add `syncMode` (`one-way` | `bidirectional`, default `one-way`) to config constants, store defaults, and options load/save.
- [x] 2.2 Extend durable storage for bidirectional pairs (`bookmarkId ↔ raindropId`), tombstones, extension-authored suppressions, and reconcile cursor/progress.
- [x] 2.3 Migrate existing dedup map into the pair model without rewriting raindrops.

## 3. Raindrop client

- [x] 3.1 Add list/get raindrops under a collection (paginated) to `RaindropClient`.
- [x] 3.2 Add delete raindrop API method.
- [x] 3.3 Add field-selective update for Edge-owned fields only (`link`, `title`, `collection`) — or explicitly omit updates if spike says unsafe, keeping create-only writes.

## 4. Bidirectional engine

- [x] 4.1 Add durable job kinds for pull-create, user-delete→Raindrop, and remote-delete→Edge; no-op them when mode is `one-way`.
- [x] 4.2 Implement `onRemoved` handling with suppression so policy-driven `sync-and-delete` local removes do not enqueue Raindrop deletes.
- [x] 4.3 Implement reconcile: list root tree raindrops, create missing Edge bookmarks + pairs, delete Edge bookmarks for missing raindrops, honor tombstones and `exclude`.
- [x] 4.4 Suppress `onCreated` for extension-authored Edge bookmarks created by pull to prevent upload loops.
- [x] 4.5 Wire reconcile into alarm heartbeat and ensure auth-halt / rate-limit backoff apply.

## 5. Options and status UI

- [x] 5.1 Add Bidirectional Sync mode control with delete-propagation warning.
- [x] 5.2 Add “Reconcile now” control (enabled when bidirectional).
- [x] 5.3 Surface pull/delete/reconcile activity and errors in status/log (popup and/or options).

## 6. Docs and verification

- [x] 6.1 Update README to describe sync modes, metadata ownership, and `sync-and-delete` coexistence with bidirectional.
- [x] 6.2 Verify one-way mode is unchanged (create, backfill, policies, no pull/delete propagation).
- [x] 6.3 Verify bidirectional: Raindrop→Edge ingest, Edge user delete→Raindrop delete, Raindrop delete→Edge delete, no recreate via tombstone.
- [x] 6.4 Verify policy `sync-and-delete` in bidirectional mode removes Edge only and leaves Raindrop intact with tags/notes preserved.
- [x] 6.5 Verify `exclude` blocks upload, ingest, and delete propagation.
