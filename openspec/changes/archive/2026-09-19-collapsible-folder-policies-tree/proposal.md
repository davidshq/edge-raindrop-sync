## Why

The Folder policies Edge tree paints every folder as a flat indented row. Deep bookmark hierarchies (Favorites bar / Other favorites with many nested folders) become long and hard to scan. Users need nested folders collapsed by default, with expand/collapse, so they can find and override policies without scrolling through every descendant.

## What Changes

- Folder policies Edge tree renders as a collapsible hierarchy instead of a fully expanded flat list
- Top-level Edge roots (Favorites bar, Other favorites) start expanded; folders with children at depth ≥ 1 start collapsed
- Users can expand/collapse individual folders, and expand all / collapse all (collapse restores the default open rule)
- Folders with hidden descendants show a child-count indicator while collapsed
- Optional folder filter expands ancestors of matching rows so filtered hits remain reachable
- Mockup retained under `mockups/options-revamp/folder-tree-collapse.html` as the UX reference (not shipped)

## Capabilities

### New Capabilities

<!-- none — UI behavior extends the existing folder-policy editor -->

### Modified Capabilities

- `extension-config`: Per-folder policy editor SHALL present a collapsible Edge folder tree with the default expansion rules above, expand/collapse controls, and descendant count affordance

## Impact

- `src/options/options.js` — tree paint / row structure (nested expand state instead of flat walk-only)
- `src/options/options.css` — twistie, indent, child-count chip, toolbar
- `src/options/options.html` — Expand all / Collapse all (and optional filter) controls on Folder policies
- `openspec/specs/extension-config/spec.md` — requirement delta for tree presentation
- No sync-engine, storage schema, or Raindrop API changes; policy draft/save/discard behavior unchanged
