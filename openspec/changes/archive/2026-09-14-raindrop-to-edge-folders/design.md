## Context

Bidirectional reconcile already pulls raindrops under the configured root into Edge via `PULL_CREATE` jobs. Placement uses `resolveEdgeParentForMirror` → `ensureFolderPath`, which **creates missing Edge folders** along the path. Empty Raindrop collections never appear because folders are only created as a side effect of pulling a bookmark.

Users want an explicit control for that behavior (Edge-as-folder-truth vs Raindrop-driven folder growth vs full empty-tree mirror). Product decisions already locked:

- Three-mode select labeled **Raindrop → Edge folders**, shown only in bidirectional settings
- Default = create folders as needed (preserve current behavior)
- **Existing only** skips unmatched raindrops — no catch-all / `_Unfiled`

Constraints unchanged: MV3 ephemeral worker, storage-backed config, root-scoped pull, `exclude` still wins, confirm-before-act elsewhere.

## Goals / Non-Goals

**Goals:**
- Persist and expose `raindropFolderMode` (name TBD in constants) with three values
- Apply mode at reconcile enqueue and/or pull-create so existing-only never creates folders and never invents a catch-all parent
- Implement mirror-all by ensuring Edge folders for collections under the root that have no raindrops yet
- Keep one-way mode unaffected (control hidden; field unused)

**Non-Goals:**
- Per-collection import/exclude UI on the Raindrop tree
- Moving already-pulled bookmarks when the mode changes
- Syncing collections outside the configured root
- Catch-all / `_Unfiled` placement for skipped items
- Propagating Raindrop collection renames/deletes as Edge folder renames/prunes beyond what prune-empty already does for bookmark deletions

## Decisions

### D1. Config field `raindropFolderMode` on `config`
**Choice:** Store `raindropFolderMode: "existing-only" | "create-as-needed" | "mirror-all"` alongside `syncMode`. Default `"create-as-needed"`. Ignored when `syncMode !== bidirectional`.
**Why:** Single durable knob; missing key on old installs merges to default via `DEFAULT_CONFIG`.
**Alternatives considered:** Boolean + nested “include empty” checkbox — rejected (UX canvas preferred one select). Separate storage key — unnecessary.

### D2. Apply “existing-only” before creating folders
**Choice:** Before `ensureFolderPath` / `createBookmark` on pull-create, resolve the mirror placement plan and check whether every title segment already exists under the start root. If any segment is missing, **drop the job** (remove from queue) without creating folders or bookmarks. Optionally log at info level that the path was skipped. Reconcile may also skip enqueueing when the path is known-missing to avoid churn — prefer check at both enqueue (best-effort) and drain (authoritative).
**Why:** Skip is the product decision; drain must be authoritative so stale jobs after a folder delete still behave correctly.
**Alternatives considered:** Catch-all `_Unfiled` — rejected by product. Leave job pending forever — rejected (queue noise).

### D3. “Create as needed” = today’s path
**Choice:** Keep calling `resolveEdgeParentForMirror` (ensure-if-missing) for pull-create. No empty-collection pass.
**Why:** Zero behavior change for current bidirectional users.

### D4. “Mirror all” = create-as-needed + empty collection walk
**Choice:** After (or as part of) reconcile when mode is `mirror-all`, walk Raindrop collections under the root (from the existing collection index), map each relative path via `resolveMirrorPlacement`, and `ensureFolderPath` even when no raindrop is present. Still honor `exclude` on existing Edge ancestors the same way pull does (`ancestorIdsForMirrorPath` + `isExcluded`). Do not create bookmarks for empty collections.
**Why:** Collection index is already built during reconcile; avoids inventing a second API. Empty folders are the only gap vs create-as-needed.
**Alternatives considered:** Separate alarm job — deferred; piggyback on reconcile is enough. Mirror collections outside root — out of scope.

### D5. UI placement and copy
**Choice:** Under the bidirectional policy block in Options: select **Raindrop → Edge folders** with the three labels from the UX mockup; short help text that switches with the selection; hidden in one-way. Persist on **Save settings** with the rest of config.
**Why:** Matches Sync mode / After upload patterns; bidirectional-only visibility avoids confusing one-way users.

### D6. Mode changes do not rewrite history
**Choice:** Switching modes only affects future reconcile/pull. Already-created Edge folders/bookmarks remain. Switching to existing-only does not delete Raindrop-origin folders that already exist.
**Why:** Destructive cleanup would surprise users; prune-empty remains the only automatic folder removal path.

## Risks / Trade-offs

- **Silent skip in existing-only** → Users may think sync “missed” items; mitigate with clear help text + occasional log line (`Skipped pull: path not in Edge`).
- **Queue churn if reconcile keeps enqueueing skipped pulls** → Drain removes skipped jobs; optionally skip enqueue when path missing to reduce writes.
- **Mirror-all creates many empty folders on first enable** → Bound work per reconcile tick if needed; log counts; still root-scoped.
- **Exclude interaction** → Existing-only + exclude: if ancestors exist and are excluded, skip (same as today). Mirror-all must not create under an excluded existing ancestor; if the path is wholly new and no exclude ancestor exists yet, creating folders is allowed (overrides are Edge-folder-id keyed — same limitation as today’s pull).
- **Unrecognized first segments** → Still land under `Other favorites/<rootName>/…` when creating; document in help text.

## Migration Plan

1. Add default `raindropFolderMode: "create-as-needed"` — existing bidirectional installs keep current behavior.
2. No storage migration beyond merge-default.
3. Rollback: remove UI + ignore field; or set mode back to `create-as-needed`.

## Open Questions

None blocking. Implement mirror-all in the same change unless collection walk proves expensive in verify scripts — then ship first two modes and leave `mirror-all` in the select as implemented (preferred) rather than “coming soon.”
