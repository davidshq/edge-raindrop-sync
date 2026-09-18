## Context

Live sync historically reacted only to `chrome.bookmarks.onCreated` and `onRemoved`. Upload drain creates a raindrop when unpaired, then optionally offloads Edge under `sync-and-delete`. Once paired, a later drain of the same bookmark id was a no-op for Raindrop (dedup / `hasSynced` skip). Parent moves, title/URL edits, and folder renames therefore left Raindrop stale.

`RaindropClient.updateRaindrop` already accepts `link` / `title` / `collectionId` without touching tags/notes/highlights. Folder path → collection ensure (`ensureCollectionPath` / `raindropUploadSegments`) already exists for creates. Raindrop also supports `PUT /collection/{id}` with `{ title }` for in-place collection rename.

Move capture and paired collection updates are already implemented in this change; this design extends the same live-update story to `onChanged` and folder renames.

## Goals / Non-Goals

**Goals:**

- Detect Edge parent-folder moves and sync Raindrop **collection placement** for affected URL bookmarks.
- Detect Edge bookmark title/URL changes and sync those Edge-owned fields.
- Detect Edge folder title changes and rename the mirrored Raindrop collection **in place** (same collection id).
- Fan out folder moves to all descendant URL nodes.
- Persist `edgeFolderId → raindropCollectionId` so renames work without the old title (which `onChanged` does not supply).
- Apply destination-folder policy (exclude / keep / offload) the same way as create drains.
- Emit clear activity lines for move / update / folder rename (and keep existing Synced / offload behavior).
- Work in both one-way and bidirectional modes without treating moves or renames as deletes.

**Non-Goals:**

- Raindrop→Edge placement when the user moves an item inside Raindrop UI (reconcile still create/delete oriented).
- Raindrop→Edge bookmark title/URL or collection-title propagation.
- Reordering within the same parent (index-only moves).
- Fan-out “recreate path + reassign children” as the folder-rename strategy (rejected; orphans old collections).

## Decisions

### D1. Reuse `upload` jobs for URL bookmark move/change

**Choice:** `handleBookmarkMoved` / URL `handleBookmarkChanged` enqueue the same durable `upload` job (bookmark id as job id) used by create/backfill. Drain extends `processUpload`: if unpaired → create; if paired → ensure destination collection path and `updateRaindrop({ link, title, collectionId })` from the live node.

**Why:** Job id already dedupes rapid move+rename; heartbeat/drain/backoff/auth-halt paths stay one pipeline. Sending all Edge-owned fields on paired drain is idempotent and correct when jobs coalesce.

**Alternatives:** Separate `move` / `update` kinds — clearer logs, more switch branches. Rejected for URL nodes.

### D2. Same-parent moves are no-ops

**Choice:** If `moveInfo.oldParentId === moveInfo.parentId`, return without enqueue (pure reorder).

**Why:** Raindrop has no Edge-style sibling order we own; avoids useless API traffic.

### D3. Folder moves walk the live tree

**Choice:** When the moved node has no URL, recursively collect URL descendants via `getChildren` / tree walk, enqueue each id, then `drain()` once.

**Why:** Chromium fires one `onMoved` for the folder, not per bookmark — same class of gap as folder `onRemoved` without `removeInfo.node` (here the tree still exists, so we read it live).

### D4. Destination policy gates the write; source policy is irrelevant for placement

**Choice:** Resolve policy from the bookmark’s **new** ancestors after the move/change. `exclude` → drop job, no Raindrop call. `sync-and-keep` → create or update. `sync-and-delete` → create or update, then suppress+remove Edge + `edge-offload` tombstone as today.

**Why:** Effective policy is always “where it lives now.”

**Note:** Moving a paired bookmark **into** Exclude leaves the Raindrop copy where it was (no delete) — consistent with “exclude neither uploads nor delete-propagates.”

### D5. Always PUT Edge-owned fields when paired (idempotent)

**Choice:** Do not GET the raindrop to compare first; ensure path and `updateRaindrop` with live `link` / `title` / `collectionId`. If Raindrop 404s, clear pair and fall through to create (or drop if exclude).

**Why:** Avoids an extra GET; coalesced jobs get final state; rate-limit pause still applies.

### D6. Activity wording

**Choice:**

- First-time create: keep `Synced: …`
- Placement-focused paired update after parent change: `Moved: <title or url> → <collection path label>` when the drain was triggered in a move-dominated way is optional; prefer honest labels:
  - If only title/URL changed (same collection): `Updated: <title or url>`
  - If collection placement changed: `Moved: <title or url> → <path label>`
  - Practical v1: when paired update runs, if resolved `collectionId` differs from… (requires GET) **or** simply always send all fields and log `Updated: …` for title/URL-only paths and `Moved: …` when `onMoved` enqueued the job.
- **v1 simplification:** Paired upload drain logs `Moved: … → <path>` when the job was last enqueued by a move handler, else `Updated: …` for onChanged-driven drains. Implementation may pass a hint on the job or compare prior collection only if cheap; acceptable fallback is `Updated:` for all non-create paired writes and keep `Moved:` when move handler set `job.reason = "move"` (soft field on the job object, ignored by older drains).
- Folder rename success: `Renamed folder: <oldTitle?> → <newTitle>` — old title may be unknown; then `Renamed folder: <newTitle>` or path label.
- Offload still has no separate “removed from Edge” line (suppression); optional follow-up.

**Why:** Matches mental models without inventing delete/create noise.

### D7. No extension-authored move suppression

**Choice:** We do not call `bookmarks.move` ourselves today; no suppress-move bucket. If future pull logic relocates Edge bookmarks, add suppression then. Folder renames authored by the extension (none today) likewise need suppress-changed later if pull renames folders.

### D8. Folder rename = true Raindrop collection rename (Approach A)

**Choice:** On `onChanged` for a folder (no URL), look up `edgeFolderId → raindropCollectionId`. If missing → no-op (folder never mirrored). If present and folder’s effective policy is not `exclude` → enqueue a durable **`rename-collection`** job (new kind). Drain: `updateCollection(collectionId, { title: node.title })`, then rewrite path-cache keys for that collection’s path prefix (old path segment → new title) and refresh the folder map entry. Do **not** enqueue descendant URL uploads solely for a rename.

**Why:** Collection id stays stable; raindrops keep placement; no orphaned old-titled collection. `onChanged` does not include the old title, so path-string lookup alone cannot find the collection — the folder id map is required.

**Alternatives:** Fan-out ensure-new-path + update each child’s `collectionId` — reuses upload jobs but orphans the old collection. Rejected.

### D9. Maintain `folderId → collectionId` when ensuring upload paths

**Choice:** During `processUpload` / `ensureCollectionPath` (or immediately after), zip Edge `ancestorIds` (parent chain of the bookmark) with the collection ids resolved for each path segment and persist `recordFolderCollection(folderId, collectionId)`. Overwrite on each successful ensure so moves keep the map fresh.

**Why:** Rename lookup is O(1); survives title changes; same id stability story as bookmark pairs.

**Note:** Path cache (`path → collectionId`) remains for ensure performance; rename must also rewrite or drop stale path keys under the old prefix so the next ensure does not resurrect the old title via a stale warm cache.

### D10. New job kind only for folder rename

**Choice:** Add `rename-collection` (or `folder-rename`) job keyed by Edge folder id. URL edits stay on `upload`. One-way and bidirectional both process this kind (it is Edge→Raindrop metadata, not a bidi-only pull/delete).

**Why:** `processUpload` intentionally ignores non-URL nodes; overloading upload would require awkward job payloads.

## Risks / Trade-offs

- **[Large folder move]** → Many upload jobs + collection ensures; mitigated by existing per-tick job caps, rate-limit pause, and durable queue.
- **[Stale pair / 404]** → Mitigate by recreating when unpaired after 404, or logging and dropping if recreate inappropriate.
- **[Move into Exclude after keep]** → Raindrop copy orphaned in old collection by design; document in README.
- **[Raindrop-side moves/renames still drift]** → Document as non-goal; reconcile does not relocate or retitle Edge bookmarks/folders yet.
- **[Concurrent create+move+rename]** → Same upload job id coalesces; drain reads live node (correct final Edge-owned fields). Folder `rename-collection` jobs are drained **before** uploads so a pending child upload cannot path-ensure the new title and orphan the mapped collection. If a rename job **defers** (retryable error), the drain pass **stops** and other due jobs are pushed to the same backoff window so a later tick cannot run uploads first.
- **[Folder rename without map entry]** → No Raindrop call; first later bookmark sync creates path under new title (acceptable cold start).
- **[Path-cache rewrite bugs]** → Prefer delete all cache keys with the old path prefix and let ensure repopulate; safer than string-rename if unsure.
- **[Duplicate sibling folder titles]** → Map is by folder id, so duplicates remain distinct; Raindrop title match among siblings stays case-insensitive as today.

## Migration Plan

- Additive storage: new `folderCollectionMap` (or equivalent) key; empty means “not yet learned.”
- Sideload update picks up `onMoved` / `onChanged` on next SW start; map fills on subsequent uploads.
- Rollback: remove listeners + rename job branch; leftover `rename-collection` jobs should no-op or drop if kind unknown after rollback — drain must ignore unknown kinds safely (already drops or no-ops non-bidi kinds in one-way — verify rename kind is handled or dropped cleanly on rollback).

## Open Questions

- None blocking. Optional later: richer offload activity; Raindrop→Edge placement/title reconcile; suppress-changed if pull starts renaming Edge folders.
