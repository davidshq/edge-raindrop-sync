## Why

Today the extension only pushes Edge bookmarks into Raindrop. Users who treat Raindrop as the long-term library (with tags, notes, highlights, covers) still need Edge and Raindrop to stay aligned both ways—including when a bookmark is deleted in either place. Without a bidirectional mode, deletes drift and Raindrop-only bookmarks never appear in Edge.

## What Changes

- Add a **sync mode** setting: keep the existing one-way Edge→Raindrop behavior as the default, and add an opt-in **Bidirectional Sync** mode.
- In bidirectional mode, **pull** Raindrop raindrops (under the configured mirror root) into Edge as bookmarks, creating missing Edge folders as needed.
- In bidirectional mode, **propagate deletes both ways**: a user delete in Edge removes the paired raindrop; a raindrop removed in Raindrop removes the paired Edge bookmark.
- **Preserve Raindrop-rich metadata**: Edge→Raindrop writes MUST NOT overwrite or clear tags, notes, highlights, covers, excerpts, or other Raindrop-only fields. Edge only owns URL, title, and folder/collection placement for mirrored items.
- Distinguish **policy-driven local cleanup** (`sync-and-delete` after a confirmed upload) from **user-initiated deletes**, so automatic post-upload Edge removal does not cascade into deleting the Raindrop copy.
- Extend the Raindrop client, durable mapping/tombstone state, event listeners (`onRemoved` and periodic Raindrop reconciliation), options UI, and status/log surfaces to support the new mode.

## Capabilities

### New Capabilities
- `bidirectional-sync`: Opt-in two-way sync under the configured root—Raindrop→Edge ingest, bidirectional delete propagation with tombstones, metadata-safe Edge→Raindrop updates, and reconciliation that avoids clobbering Raindrop-only fields.

### Modified Capabilities
- `bookmark-sync-engine`: Extend the durable pipeline for reverse ingest, delete jobs, reverse mapping cleanup, and mode-aware drain behavior while keeping confirm-before-act safety for destructive steps.
- `extension-config`: Add sync-mode configuration (one-way vs bidirectional) and status/log visibility for pull/delete reconciliation.
- `sync-policies`: Clarify how `sync-and-delete` / `sync-and-keep` / `exclude` interact with bidirectional mode, especially that policy-driven Edge cleanup must not delete the Raindrop pair.

## Impact

- **Code**: `src/lib/sync.js`, `src/lib/raindrop.js`, `src/lib/store.js`, `src/lib/constants.js`, `src/lib/bookmarks.js`, `src/lib/collections.js`, `src/background/service-worker.js`, `src/options/*`, `src/popup/*`, possibly new modules for pull/reconcile and tombstones.
- **Raindrop API**: Need list/get raindrops (paginated), delete raindrop, and field-selective update (or create-only + collection placement) — beyond today's create/collection client surface.
- **Storage**: Expand beyond `bookmarkId → raindropId` to support reverse lookup, tombstones/last-seen cursors, and sync-mode config.
- **Safety**: Destructive ops on both sides; must keep confirm-before-act, auth-halt, and clear UX so users understand bidirectional delete risk.
- **Non-breaking default**: One-way mode remains default; existing users keep current behavior until they opt in.
