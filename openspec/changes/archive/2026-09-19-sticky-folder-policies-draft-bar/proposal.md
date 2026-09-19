## Why

Folder policies edits are already draft-until-save, but Apply/Discard sit in a normal row at the bottom of a long tree (plus Raindrop-only section). Users can lose the controls while editing, and “Save folder policies” still reads like Settings’ Save. A sticky draft bar with Apply naming keeps the draft workspace obvious and distinct.

## What Changes

- Folder policies gains a sticky bottom draft bar with Apply folder policies / Discard and dirty status
- Primary action renamed from “Save folder policies” to “Apply folder policies” (same persist behavior)
- Help copy and README updated to match Apply naming
- No change to draft storage semantics, override keys, or allowlist persistence

## Capabilities

### New Capabilities

<!-- none — UI presentation of the existing draft workspace -->

### Modified Capabilities

- `extension-config`: Per-folder policy editor SHALL expose draft Apply/Discard on a sticky bar within Folder policies, with Apply naming distinct from Save settings

## Impact

- `src/options/options.html` — draft bar markup on Folder policies
- `src/options/options.css` — sticky draft-bar styles
- `src/options/options.js` — wire Apply label / status copy; show bar dirty state
- `README.md` — Folder policies Apply wording
- `openspec/specs/extension-config/spec.md` — requirement delta
- No sync-engine, storage schema, or Raindrop API changes
