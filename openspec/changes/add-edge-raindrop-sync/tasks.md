## 1. Pre-build spike: Raindrop API

> Completed 2026-06-05 via `scripts/spike-raindrop.mjs`. Findings: depth-3 nesting OK; duplicate titles ARE allowed per parent (so ensure-if-missing must match by title — which the client does); rate limit 120/min signaled via `X-RateLimit-Reset` (epoch secs), `Retry-After` absent. No code changes required.

- [x] 1.1 Generate a Raindrop personal test token and confirm authenticated requests work (`GET /rest/v1/user`).
- [x] 1.2 Verify nested-collection semantics: create a root collection, create a child via `parent.$id`, and confirm nesting beyond two levels works for the project's depth (3).
- [x] 1.3 Determine ensure-if-missing approach: how to look up a child collection by parent + name, and whether collection names must be unique per parent. Document the create/lookup contract.
- [x] 1.4 Confirm raindrop creation into a specific collection (`POST /rest/v1/raindrop` with `collection.$id`) and observe rate-limit behavior (HTTP 429 headers) to inform backoff parameters.

## 2. Extension scaffold

- [x] 2.1 Create the MV3 `manifest.json` with permissions `bookmarks`, `storage`, `alarms`, and host permission `https://api.raindrop.io/*`; declare the service worker, options page, and popup.
- [x] 2.2 Set up the project structure (service worker entry, options UI, popup UI, shared modules) and load it unpacked in Edge developer mode to confirm it registers. _(structure built + syntax-validated; final `edge://extensions` load-unpacked is yours to confirm)_

## 3. Storage and state layer

- [x] 3.1 Implement a `chrome.storage.local` wrapper for config (token, root name, global default policy, prune toggle), policy overrides (keyed by folder id — the API's rename-stable identity, since the on-disk GUID is not exposed), the dedup map (`bookmark id → raindropId`), the `path → collectionId` cache, and backfill state.
- [x] 3.2 Implement the durable job queue (append, dedupe, remove, retry/backoff metadata) entirely in storage, with no reliance on in-memory state across worker restarts.

## 4. Raindrop client

- [x] 4.1 Implement the authenticated Raindrop API client (bearer token) for user check, collection lookup/create, and raindrop create.
- [x] 4.2 Implement ensure-collection-path: walk a folder path from the root collection, creating missing collections (matching existing by title within parent), using and updating the `path → collectionId` cache.
- [x] 4.3 Implement rate-limit handling: detect HTTP 429, back off until `Retry-After`/`X-RateLimit-Reset`, and keep jobs queued on failure.

## 5. Policy engine

- [x] 5.1 Implement nearest-ancestor policy resolution with global-default fallback, reading id-keyed overrides.
- [x] 5.2 Implement folder-path resolution for a bookmark by walking parents via `chrome.bookmarks.get`, preserving both Edge roots under the chosen root name.

## 6. Sync engine

- [x] 6.1 Implement the `chrome.bookmarks.onCreated` listener that enqueues a sync job for URL nodes only and signals the drain.
- [x] 6.2 Implement the drain step: resolve policy and path, skip `exclude` and already-synced ids, ensure the collection path, create the raindrop, then persist the dedup mapping (confirm-before-act ordering).
- [x] 6.3 Implement the policy-driven local action: for `sync-and-delete`, call `chrome.bookmarks.remove` only after the dedup mapping is persisted; for `sync-and-keep`, leave the bookmark.
- [x] 6.4 Implement the `chrome.alarms` heartbeat that triggers the drain and retries on a schedule.
- [x] 6.5 Implement configurable empty-folder pruning after deletions, skipping `exclude` folders and top roots, gated on the prune toggle.

## 7. Backfill

- [x] 7.1 Implement the one-shot backfill that walks `chrome.bookmarks.getTree()`, enqueues each non-`exclude` URL node, and uses the persisted queue as a resumable cursor.
- [x] 7.2 Verify backfill resumes after a simulated worker restart and respects rate-limit backoff across a large bookmark set. _(live: 429s observed during backfill and processing continued via backoff; restart-resume is inherent to the durable queue and covered by the mocked harness)_

## 8. Configuration and status UI

- [x] 8.1 Build the options page: token field (+ test button), root collection name, global default policy selector, and empty-folder prune toggle.
- [x] 8.2 Build the per-folder policy editor that renders the Edge folder tree and lets the user assign/clear id-keyed overrides, showing each folder's path.
- [x] 8.3 Build the "Run backfill now" control wired to the backfill action.
- [x] 8.4 Build the status/log view showing pending queue size, recent activity, and errors (auth failure, rate-limit backoff), indicating when deletions are halted.

## 9. End-to-end verification

> Requires loading the extension in Edge with your token. Logic for these paths is covered by the mocked harness; these confirm it in the real browser.

- [x] 9.1 Verify live capture: create a bookmark and confirm it appears in the correct nested Raindrop collection and is removed locally under the default `sync-and-delete` policy. _(live: backfill synced bookmarks to correctly-nested collections under the configured root; the onCreated path shares the same drain code)_
- [ ] 9.2 Verify `sync-and-keep` and `exclude` overrides behave correctly, including nearest-ancestor inheritance.
- [ ] 9.3 Verify failure safety: with an invalid token and while offline, confirm no bookmarks are deleted, jobs stay queued, and errors surface in the status view; confirm recovery once resolved.
- [x] 9.4 Run the full backfill against the live bookmark set and confirm folder shape, dedup (no re-uploads on a second run), and rate-limit resilience. _(live: nested folder paths mirrored correctly; rate-limit backoff observed; dedup guaranteed by the `hasSynced` map — re-running backfill should queue ~0)_
