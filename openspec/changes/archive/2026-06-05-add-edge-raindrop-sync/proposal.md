## Why

Microsoft Edge on Linux no longer syncs bookmarks across devices, so favorites created on the Linux machine become stranded locally and are unavailable on other computers. Manually re-adding each bookmark to Raindrop.io (the user's cross-device bookmark store) is easy to forget, so bookmarks pile up only in Edge. This change captures Edge bookmarks into Raindrop automatically, as they are created, so they are always reachable elsewhere — and optionally clears them from Edge to keep it tidy.

## What Changes

- **New Manifest V3 Edge extension** that performs a **one-way** sync of Edge bookmarks → Raindrop.io. There is no reverse sync.
- **Live capture**: a `chrome.bookmarks.onCreated` listener enqueues each newly created bookmark for syncing; a `chrome.alarms` heartbeat drains the queue and retries failures.
- **One-shot backfill**: a user-triggered sweep imports existing bookmarks (rate-limited with backoff).
- **Folder mirroring**: the Edge folder tree is recreated as nested Raindrop collections under a user-chosen root collection (default `Edge`), preserving both Edge roots (`Favorites bar`, `Other favorites`). Collections are created if missing.
- **Per-folder policy model** with three policies — `sync-and-delete` (default), `sync-and-keep`, `exclude` — resolved by nearest ancestor folder, falling back to a global default.
- **Instant local deletion**: when policy is `sync-and-delete`, the bookmark is removed from Edge the moment Raindrop confirms the create succeeded — never before.
- **Configurable empty-folder pruning**: after a folder's bookmarks are deleted, empty Edge folders are left in place (default) or pruned, per a setting.
- **Durable, ephemeral-safe engine**: because the MV3 service worker holds no state, a queue, a `guid → raindropId` dedup map, and a `path → collectionId` cache all live in `chrome.storage.local`. This makes capture resilient to offline periods, Raindrop rate limits (HTTP 429), and worker shutdown mid-flight.
- **Options/popup UI** to set the Raindrop test token, root collection name, global default policy, per-folder overrides, the empty-folder prune toggle, and to run the backfill and view sync status.

## Capabilities

### New Capabilities
- `bookmark-sync-engine`: The core sync pipeline — live `onCreated` capture, the user-triggered backfill sweep, the durable `chrome.storage` queue with alarm-driven drain and backoff retries, Raindrop collection mirroring (ensure-if-missing), raindrop creation, and the `guid → raindropId` dedup map. Confirms each Raindrop write before any local action.
- `sync-policies`: The per-folder policy model (`sync-and-delete`, `sync-and-keep`, `exclude`), GUID-keyed override storage, nearest-ancestor resolution with global default, instant local deletion on confirmed sync, and the configurable empty-folder pruning behavior.
- `extension-config`: Configuration and operator surface — Raindrop test-token storage, root collection name, global default policy, the per-folder policy editor (browse the Edge tree and tag folders), the empty-folder prune toggle, the "Run backfill now" action, and sync status/log display.

### Modified Capabilities
<!-- None — this is a greenfield project with no existing specs. -->

## Impact

- **New codebase**: a Manifest V3 extension (manifest, service worker, options/popup UI, a Raindrop API client, and a storage/queue module). No existing code to modify.
- **Permissions**: `bookmarks`, `storage`, `alarms`, and host permission for `https://api.raindrop.io/*`.
- **External dependency**: Raindrop.io REST API. Requires a personal Raindrop "test token" (no full OAuth in v1). A pre-build spike must verify Raindrop's nested-collection create/lookup semantics.
- **Data safety**: the extension deletes Edge bookmarks in `sync-and-delete` mode. Deletion is gated on a confirmed Raindrop write, so a sync failure can never lose a bookmark.
- **Distribution**: sideloaded / loaded unpacked in Edge developer mode for personal use; not published to the Edge Add-ons store in v1.
- **Target environment**: Microsoft Edge on Linux (Chromium). The extension uses the `chrome.bookmarks` API, not the on-disk `Bookmarks` file.
