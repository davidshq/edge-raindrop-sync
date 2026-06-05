## Context

Edge on Linux no longer syncs bookmarks. The user wants new Edge bookmarks pushed to Raindrop.io automatically and, in most cases, removed from Edge afterward. An explore session settled the architecture: a **Manifest V3 Edge extension** using the `chrome.bookmarks` API rather than an external tool editing the on-disk `Bookmarks` file.

That choice is load-bearing. The two hardest requirements — capturing bookmarks *as they are made* and *deleting them locally while Edge is running* — are trivial and safe through the extension API (`onCreated`, `bookmarks.remove`), but fragile through the file (the browser holds the bookmark tree in memory, overwrites external edits on its next flush, and validates a `checksum` field that hand-edits invalidate).

The defining constraint of MV3 is that the **service worker is ephemeral**: Edge terminates it after ~30s idle and restarts it on the next event. It can hold no in-memory state across events. All durability must live in `chrome.storage.local`.

Current state: greenfield. Target is Chromium-based Edge on Linux, with a typical multi-folder bookmark tree (two populated roots, nested folders up to depth 3).

## Goals / Non-Goals

**Goals:**
- One-way, automatic Edge → Raindrop sync of newly created bookmarks, captured live.
- A one-shot backfill of existing bookmarks that respects Raindrop rate limits.
- Faithful folder mirroring into nested Raindrop collections under a user-named root.
- Per-folder policy control (sync-and-delete / sync-and-keep / exclude) with sane inheritance.
- Never lose a bookmark: local deletion is gated on a confirmed Raindrop write.
- Resilience to offline periods, rate limiting, and service-worker shutdown mid-operation.

**Non-Goals:**
- Reverse sync (Raindrop → Edge) — explicitly excluded.
- Re-syncing moves/renames (`onMoved`/`onChanged`) — out of v1.
- Full OAuth — v1 uses a personal Raindrop test token.
- Publishing to the Edge Add-ons store — sideload / load-unpacked for personal use.
- Multi-browser support — Edge only in v1 (though the API is Chromium-generic).

## Decisions

### D1. MV3 extension over external file-based tool
**Choice:** A browser extension using `chrome.bookmarks`.
**Why:** Live capture is one event listener; safe local deletion is one API call that routes through Edge itself (no file race, no checksum recompute). The external-tool path spends most of its complexity budget just safely doing what the extension gets for free.
**Alternatives considered:** External daemon watching the `Bookmarks` JSON — rejected because deleting locally requires Edge to be closed plus recomputing the Chromium MD5 checksum, fighting the browser for the file. Hybrid — rejected as premature; revisit only if other browsers are added.

### D2. Enqueue-then-drain pipeline on `chrome.storage.local`
**Choice:** Event handlers do almost nothing but append a job to a durable queue in storage. A separate drain step processes jobs idempotently. The drain is triggered both by events and by a `chrome.alarms` heartbeat.
**Why:** The ephemeral worker cannot hold a queue, retry counter, or in-flight flag in memory. Persisting to storage makes every step crash-safe: a worker killed mid-flight simply leaves the job queued for the next drain. The alarm heartbeat guarantees forward progress even with no new bookmark activity (retries, backfill continuation).
**Alternatives considered:** Synchronous handling inside `onCreated` — rejected; a network failure or worker shutdown would drop the bookmark or, worse, delete it locally without a confirmed remote copy.

### D3. Confirm-before-delete ordering
**Choice:** For `sync-and-delete`, call `chrome.bookmarks.remove(id)` only after the Raindrop create returns success **and** the `guid → raindropId` mapping is persisted.
**Why:** This is the safety invariant that makes destructive sync acceptable. Any failure mode leaves the bookmark in Edge.

### D4. Folder mirroring via lazy ensure-if-missing
**Choice:** Resolve a bookmark's full folder path, then walk it from the root collection downward, creating each missing collection and caching `path → collectionId` in storage. Collections are created lazily when a bookmark needs them, so folder-creation events need no handling.
**Why:** Avoids ordering problems between folder and bookmark events, and avoids redundant API lookups. Edge's two roots map under the single chosen root (`Edge/Favorites bar/…`, `Edge/Other favorites/…`).
**Open dependency:** Raindrop's nested-collection create/lookup semantics — covered by the pre-build spike (see Risks and tasks).

### D5. Policy model — three policies, nearest-ancestor resolution, GUID-keyed
**Choice:** Policies are `sync-and-delete` (global default), `sync-and-keep`, and `exclude`. A bookmark's effective policy is that of the nearest ancestor folder with an explicit override, else the global default. Overrides are stored keyed by **folder GUID**, with the human-readable path shown in the UI.
**Why:** Nearest-ancestor inheritance matches how users think about folders ("everything under Work stays local"). GUID keys survive folder renames; storing the path would break on rename. `exclude` means *never read, never touch* — neither synced nor deleted.

### D6. Dedup via `guid → raindropId` map
**Choice:** Persist a map from Edge bookmark GUID to the created Raindrop id.
**Why:** Prevents re-uploading on repeated drains/backfills — essential for `sync-and-keep` folders, where the bookmark lingers in Edge and would otherwise be re-sent every heartbeat. (For `sync-and-delete`, the source vanishes, so the map mainly guards against double-send races.)

### D7. Auth via Raindrop test token
**Choice:** Store a personal Raindrop test token in `chrome.storage` and send it as a bearer token.
**Why:** Zero OAuth ceremony for a single-user personal tool. OAuth can come later if distribution is ever needed.

### D8. Backfill as an explicit, rate-limited, resumable sweep
**Choice:** A user-triggered action walks `chrome.bookmarks.getTree()`, enqueues every URL node per its resolved policy, and drains with backoff. Progress lives in storage so a worker restart resumes rather than restarts.
**Why:** A large bookmark set will brush against Raindrop rate limits (HTTP 429); backoff plus a persisted cursor keeps it safe and resumable.

## Risks / Trade-offs

- **Raindrop nested-collection semantics are unverified** → A pre-build spike confirms create-if-missing, child lookup by parent+name, and per-parent name uniqueness before the mirroring core is built. If deep nesting is unsupported, fall back to encoding the path in a flat collection name (depth is only 3, so risk is low).
- **Rate limiting during backfill (HTTP 429)** → Exponential backoff plus a persisted cursor; the alarm heartbeat continues the sweep across worker restarts.
- **Service worker killed mid-operation** → Confirm-before-delete (D3) plus the durable queue (D2) make every partial state recoverable and idempotent via the dedup map (D6).
- **Instant deletion surprises the user** (a starred page vanishes immediately) → This is the chosen behavior; mitigated by per-folder `sync-and-keep`/`exclude` and the safety that nothing is deleted until Raindrop confirms.
- **Duplicate raindrops on re-adding the same URL over time** → Accepted in v1; Raindrop's own duplicate detection covers most cases.
- **Empty folders left in Edge after delete** → Configurable prune toggle (default: leave) addresses tidiness without forcing destructive folder removal.
- **Invalid/expired Raindrop token** → Drain surfaces auth errors to the status view and halts deletion (jobs stay queued) rather than silently dropping bookmarks.

## Open Questions

- Raindrop nested-collection API behavior (resolved by the spike — gates the mirroring implementation).
- Exact backfill batch size / backoff parameters — to be tuned empirically against Raindrop's limits during the spike.
