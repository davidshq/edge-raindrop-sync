## Why

In bidirectional mode, reconcile already creates missing Edge folders when pulling Raindrop bookmarks, but that behavior is implicit and always-on. Users who want Edge to remain the source of folder truth (or who want empty Raindrop collections mirrored too) have no way to choose. We need an explicit Raindrop → Edge folder policy so Raindrop-only collections are intentional, not surprising.

## What Changes

- Add a bidirectional-only setting **Raindrop → Edge folders** with three modes:
  - **Existing Edge folders only** — pull bookmarks only into paths that already exist in Edge; skip unmatched raindrops entirely (no catch-all / `_Unfiled`)
  - **Create folders as needed** (default) — current behavior: create missing Edge folders lazily when pulling bookmarks; empty Raindrop collections stay invisible in Edge
  - **Mirror all collections (incl. empty)** — also create Edge folders for empty Raindrop collections under the configured root
- Persist the setting in extension config; expose it in Options only when sync mode is bidirectional
- Apply the mode during reconcile / pull-create (and any empty-collection mirroring pass for mirror-all)
- Document the setting in README

## Capabilities

### New Capabilities

- `raindrop-to-edge-folders`: Controls whether Raindrop collection paths may create or reshape Edge folders during bidirectional pull, including existing-only skip, lazy create-on-pull, and full empty-collection mirroring

### Modified Capabilities

- `extension-config`: Add Raindrop → Edge folders configuration UI and persistence (bidirectional-only)
- `bidirectional-sync`: Gate Raindrop→Edge ingest folder creation / skip / empty mirroring on the configured folder mode

## Impact

- **Config / storage:** `src/lib/constants.js`, `src/lib/store.js` — new config field + default
- **Engine:** `src/lib/bookmarks.js`, `src/lib/reconcile.js`, `src/lib/sync.js` — skip vs ensure-folder vs empty-collection mirror
- **UI:** `src/options/options.html`, `options.js`, `options.css` — select + help text under bidirectional block
- **Docs / tests:** README; `scripts/verify-bidirectional-logic.mjs` and/or `verify-checklist.mjs` for skip / create / mirror behaviors
- **No Raindrop API contract change** beyond possibly listing collections for empty-folder mirroring under the existing root
