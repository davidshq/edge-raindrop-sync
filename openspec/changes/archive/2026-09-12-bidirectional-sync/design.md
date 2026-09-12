## Context

The extension today is strictly Edge→Raindrop: `onCreated` + backfill enqueue jobs; drain creates raindrops with `link`/`title`/`collection`/`pleaseParse`; a `bookmarkId → raindropId` dedup map prevents duplicates; `sync-and-delete` removes the Edge bookmark only after confirm. There is no Raindrop list/delete client, no `onRemoved` handling, and no reverse ingest.

Users want an opt-in **Bidirectional Sync** mode so Edge and Raindrop stay aligned under the configured root—including deletes—without destroying Raindrop-only richness (tags, notes, highlights, covers, excerpts) that Edge cannot represent.

Constraints that still apply: MV3 ephemeral service worker (all state in `chrome.storage.local`), Raindrop rate limits, confirm-before-act for destructive work, personal test-token auth.

## Goals / Non-Goals

**Goals:**
- Opt-in sync mode: `one-way` (default, current behavior) vs `bidirectional`.
- Raindrop→Edge: create Edge bookmarks (and folders) for raindrops under the mirror root that are not yet mapped.
- Bidirectional delete propagation for **user-initiated** deletes on either side.
- Metadata safety: never overwrite or clear Raindrop-only fields on create/update.
- Keep existing per-folder policies meaningful: `exclude` still means do-not-touch; `sync-and-keep` is the natural pair for bidirectional; `sync-and-delete` post-upload Edge cleanup must **not** delete the Raindrop copy.
- Durable, idempotent jobs with auth-halt and backoff, consistent with the existing engine.

**Non-Goals:**
- Syncing Raindrop tags/notes/highlights/covers into Edge (Edge has no equivalent storage).
- Full CRDT / multi-device conflict resolution beyond last-seen mapping + tombstones.
- Syncing raindrops outside the configured root collection tree.
- Propagating Edge folder renames/moves as collection renames in v1 of this change (URL/title/create/delete + initial folder placement only unless cheap to include).
- OAuth, store publication, or non-Edge browsers.
- Real-time Raindrop webhooks (poll/reconcile on alarm + explicit refresh is enough).

## Decisions

### D1. Sync mode is a global config flag, default `one-way`
**Choice:** Store `syncMode: "one-way" | "bidirectional"` in config. One-way preserves today's semantics exactly. Bidirectional enables pull + delete propagation.
**Why:** Opt-in avoids surprising existing users who rely on `sync-and-delete` as a one-way offload.
**Alternatives considered:** Always-on bidirectional — rejected (breaks `sync-and-delete` mental model). Per-folder sync direction — deferred as UI/complexity overkill for v1.

### D2. Scope pull/delete to the configured root collection tree
**Choice:** Raindrop→Edge ingest and Raindrop-delete detection only consider raindrops in the configured root (e.g. `Edge`) and its descendants. Unrelated Raindrop library content is ignored.
**Why:** Matches the existing mirror boundary and avoids importing the entire Raindrop account into Edge.
**Alternatives considered:** Whole-account sync — rejected (too broad, conflicts with exclude policies and user library structure).

### D3. Field ownership — Edge owns URL/title/folder; Raindrop owns everything else
**Choice:**
- **Create Edge→Raindrop:** continue sending only `link`, `title`, `collection`, and `pleaseParse` (server enrichment is fine; we do not later overwrite those enriched fields).
- **Update Edge→Raindrop (if needed):** PATCH/PUT only Edge-owned fields that changed (`link`, `title`, and/or `collection`). Never send empty tags/notes/highlights; never replace the full raindrop document.
- **Create Raindrop→Edge:** create an Edge bookmark with URL + title in the mirrored folder path derived from the collection path under the root. Leave all Raindrop metadata in Raindrop.
- **Title/URL conflicts:** if both sides change the same mapped pair between reconciles, prefer **Raindrop** for title/URL when in bidirectional mode (Raindrop is the richer system of record), and still never touch Raindrop-only fields from Edge.
**Why:** Explicitly satisfies “do not overwrite rich metadata Raindrop may have that Edge doesn't.”
**Alternatives considered:** Full document replace on update — rejected (would wipe tags/notes). Bidirectional merge of title — unnecessary complexity for v1 given Edge’s thin model.

### D4. Policy-driven Edge cleanup must not cascade to Raindrop
**Choice:** Introduce a delete-source distinction on outbound delete jobs: `user` vs `policy`. Only `user` deletes (from `chrome.bookmarks.onRemoved` when the node was mapped and not removed by our own policy action) trigger Raindrop DELETE. After our own `sync-and-delete` local remove, record a short-lived **suppression** (or mark the remove as extension-authored) so `onRemoved` does not enqueue a Raindrop delete.
**Why:** Otherwise enabling bidirectional would make `sync-and-delete` destroy the Raindrop copy immediately after upload—catastrophic.
**Alternatives considered:** Disable `sync-and-delete` when bidirectional is on — simpler but forces a settings migration and removes a useful one-way-offload path for users who still want local cleanup without killing Raindrop. Prefer suppression + source tagging.

### D5. Pairing map becomes bidirectional with tombstones
**Choice:** Extend storage from `bookmarkId → raindropId` to a pair record `{ bookmarkId, raindropId, updatedAt }` with indexes both ways. On confirmed user delete from either side, write a **tombstone** (by raindropId and/or bookmarkId + URL hash) with expiry or permanent until cleared, so reconcile does not immediately re-create the item from the surviving side’s lag.
**Why:** Without tombstones, pull would resurrect deletes; without reverse index, Raindrop→Edge delete is O(n) scan of the map (acceptable at small N, but reverse index is cheap).
**Alternatives considered:** URL-only pairing — fragile (duplicate URLs). Soft-delete flags only in memory — incompatible with MV3.

### D6. Raindrop→Edge via periodic reconcile + optional manual refresh
**Choice:** On alarm heartbeat (and a “Reconcile now” control), list raindrops under the root collection tree (paginated), diff against the pair map:
- Unmapped raindrop → create Edge bookmark + record pair.
- Mapped raindrop missing from Raindrop → delete Edge bookmark (user-equivalent remote delete) + tombstone.
- Mapped Edge bookmark missing (and not policy-suppressed / not tombstoned outbound) → already handled by `onRemoved` enqueue; reconcile is the backstop.
**Why:** Raindrop has no extension-friendly push; polling fits the existing alarm architecture.
**Alternatives considered:** Webhooks — not available to a local extension. Continuous tight polling — wasteful vs alarm cadence.

### D7. Ignore self-authored Edge creates during pull
**Choice:** When drain creates a raindrop from an Edge bookmark, the pair is recorded before any pull can see it. When pull creates an Edge bookmark from a raindrop, mark the create as extension-authored (suppression set) so `onCreated` does not enqueue a duplicate upload.
**Why:** Prevents create loops.
**Alternatives considered:** Disable `onCreated` during reconcile — race-prone with user activity.

### D8. `exclude` still means never touch
**Choice:** In bidirectional mode, raindrops whose mirrored Edge path would fall under an `exclude` folder are not created in Edge; Edge bookmarks under `exclude` are not uploaded; deletes under `exclude` are not propagated.
**Why:** Preserves the existing “hands off” contract.

## Risks / Trade-offs

- **Delete loops / resurrection** → Tombstones + extension-authored suppressions on `onCreated`/`onRemoved`; reconcile must honor tombstones.
- **`sync-and-delete` + bidirectional confusion** → Document clearly in options UI; implement D4 so policy cleanup never deletes Raindrop; consider a warning when enabling bidirectional while default policy is `sync-and-delete`.
- **Raindrop pagination / rate limits during reconcile** → Reuse backoff; persist reconcile cursor; bound work per drain tick.
- **Lost mapping if storage is cleared** → Reconcile may recreate Edge bookmarks from Raindrop (safe) or fail to propagate deletes for unmapped pairs; accept and surface “mapping reset” in status; optional URL+collection heuristic matching is a later enhancement.
- **Title/URL last-write ambiguity** → Prefer Raindrop in bidirectional mode (D3); rare for this personal tool.
- **Large libraries** → First bidirectional enable may enqueue many Edge creates; show progress in status like backfill.
- **API uncertainty for selective update / trash vs hard delete** → Spike list, delete, and update endpoints before implementing update path; if selective update is awkward, v1 may omit Edge→Raindrop field updates entirely (create + delete + pull only) while still meeting metadata safety.

## Migration Plan

1. Ship with `syncMode` defaulting to `one-way`; existing installs unchanged.
2. On first switch to `bidirectional`, run an initial reconcile (pull missing into Edge; build reverse index from existing dedup map).
3. Do not rewrite existing raindrops on migration (no bulk update)—metadata stays intact.
4. Rollback: switching back to `one-way` disables pull and delete propagation immediately; existing pairs and Edge bookmarks remain; queue jobs of type pull/delete-remote are dropped or no-op.

## Open Questions

Resolved by extending `scripts/spike-raindrop.mjs` + Raindrop REST docs (`/v1/raindrops/multiple`, `/v1/raindrops/single`). Live run still needs `RAINDROP_TOKEN` when available; engine decisions below follow the documented contract and the spike’s assertions.

- **List:** `GET /raindrops/{collectionId}?nested=true&page=&perpage=` (max 50/page). Use the configured root collection id with `nested=true` to cover the mirror tree.
- **Delete:** `DELETE /raindrop/{id}` moves to Trash (`-99`); permanent only on a second delete from Trash. Bidirectional sync uses soft-delete (one DELETE) — good enough for “gone from library.”
- **Partial update:** `PUT /raindrop/{id}` with only `title` / `link` / `collection` is intended to leave unspecified fields alone. **Do not** send `tags: []` or empty `note` (those clear). Spike section 2.3 asserts tag/note preservation after a title/link PUT.
- **v1 Edge→Raindrop updates:** Client exposes field-selective `updateRaindrop`; the engine does **not** subscribe to `onChanged`/`onMoved` in this change (create + delete + pull only). Safer metadata posture; title/URL push can land later.
- **Tombstones:** Persist by `raindropId` until one successful reconcile confirms the raindrop is absent and no recreate is needed, then drop.
- **Placement:** If mirrored path under the root starts with an Edge top-root title (`Favorites bar` / `Other favorites`, etc.), place there; otherwise under `Other favorites/<rootName>/…`.
