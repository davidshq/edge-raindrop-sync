## Context

Live sync today reacts only to `chrome.bookmarks.onCreated` and `onRemoved`. Upload drain creates a raindrop when unpaired, then optionally offloads Edge under `sync-and-delete`. Once paired, a later drain of the same bookmark id is a no-op for Raindrop (dedup / `hasSynced` skip). Dragging a bookmark or folder to another parent fires `onMoved` with the same node id — so nothing is enqueued, Raindrop stays in the old collection, and Recent activity is empty.

`RaindropClient.updateRaindrop` already accepts `collectionId` without touching tags/notes/highlights. Folder path → collection ensure (`ensureCollectionPath` / `raindropUploadSegments`) already exists for creates.

## Goals / Non-Goals

**Goals:**

- Detect Edge parent-folder moves and sync Raindrop **collection placement** for affected URL bookmarks.
- Fan out folder moves to all descendant URL nodes.
- Apply destination-folder policy (exclude / keep / offload) the same way as create drains.
- Emit an activity log line when placement is updated (and keep existing Synced / offload behavior).
- Work in both one-way and bidirectional modes without treating moves as deletes.

**Non-Goals:**

- `onChanged` title/URL re-sync (still deferred).
- Raindrop→Edge placement when the user moves an item inside Raindrop UI (reconcile still create/delete oriented).
- Reordering within the same parent (index-only moves).
- Propagating Edge folder renames as Raindrop collection renames.
- New job kinds or storage schema (reuse upload jobs + pair map).

## Decisions

### D1. Reuse `upload` jobs instead of a new `move` kind

**Choice:** `handleBookmarkMoved` enqueues the same durable `upload` job (bookmark id as job id) used by create/backfill. Drain extends `processUpload`: if unpaired → create; if paired → ensure destination collection path and `updateRaindrop({ collectionId })`.

**Why:** Job id already dedupes rapid moves; heartbeat/drain/backoff/auth-halt paths stay one pipeline. A separate kind would duplicate policy/offload logic.

**Alternatives:** New `move-update` kind — clearer logs, more switch branches and one-way/bidi filtering. Rejected for v1.

### D2. Same-parent moves are no-ops

**Choice:** If `moveInfo.oldParentId === moveInfo.parentId`, return without enqueue (pure reorder).

**Why:** Raindrop has no Edge-style sibling order we own; avoids useless API traffic.

### D3. Folder moves walk the live tree

**Choice:** When the moved node has no URL, recursively collect URL descendants via `getChildren` / tree walk, enqueue each id, then `drain()` once.

**Why:** Chromium fires one `onMoved` for the folder, not per bookmark — same class of gap as folder `onRemoved` without `removeInfo.node` (here the tree still exists, so we read it live).

**Alternatives:** Ignore folder moves and wait for users to move bookmarks one-by-one — poor UX.

### D4. Destination policy gates the write; source policy is irrelevant for placement

**Choice:** Resolve policy from the bookmark’s **new** ancestors after the move. `exclude` → drop job, no Raindrop call. `sync-and-keep` → create or update collection. `sync-and-delete` → create or update, then suppress+remove Edge + `edge-offload` tombstone as today.

**Why:** Effective policy is always “where it lives now.” Moving into Exclude means hands-off; moving into Offload means offload after confirmed write.

**Note:** Moving a paired bookmark **into** Exclude leaves the Raindrop copy where it was (no delete) — consistent with “exclude neither uploads nor delete-propagates.”

### D5. Always PUT collection when paired (idempotent)

**Choice:** Do not GET the raindrop to compare collections first; ensure path and `updateRaindrop` with the resolved `collectionId`. If Raindrop 404s, clear pair and fall through to create (or drop if exclude) — same resilience spirit as delete paths.

**Why:** Avoids an extra GET per move; PUT is Edge-owned fields only. Rate-limit pause still applies via existing client gates.

### D6. Activity wording

**Choice:**

- First-time create: keep `Synced: …`
- Placement update for existing pair: `Moved: <title or url> → <collection path label>`
- Offload still has no separate “removed from Edge” line (suppression); optional follow-up, not required here.

**Why:** Matches the user’s mental model of a move without inventing delete/create noise.

### D7. No extension-authored move suppression

**Choice:** We do not call `bookmarks.move` ourselves today; no suppress-move bucket. If future pull logic relocates Edge bookmarks, add suppression then.

## Risks / Trade-offs

- **[Large folder move]** → Many upload jobs + collection ensures; mitigated by existing per-tick job caps, rate-limit pause, and durable queue.
- **[Stale pair / 404]** → Mitigate by recreating when unpaired after 404, or logging and dropping if recreate inappropriate.
- **[Move into Exclude after keep]** → Raindrop copy orphaned in old collection by design; document in README.
- **[Raindrop-side moves still drift]** → Document as non-goal; reconcile does not relocate Edge bookmarks yet.
- **[Concurrent create+move]** → Same job id coalesces; drain reads live parent at process time (correct final placement).

## Migration Plan

- No storage migration. Sideload update picks up `onMoved` on next SW start.
- Rollback: remove listener + revert `processUpload` update branch; leftover queued upload jobs still drain safely (create-or-no-op-before-change; after partial deploy, update path is harmless).

## Open Questions

- None blocking. Optional later: richer offload activity (“Offloaded after sync/move”) and Raindrop→Edge placement reconcile.
