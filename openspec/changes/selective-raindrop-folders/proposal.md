## Why

Raindrop→Edge folder modes are all-or-nothing, and Folder policies only list Edge folders—so Raindrop-only collections are invisible until they somehow land in Edge. Users need to see Raindrop-only collections next to folder policy controls and opt in which ones to sync, without a confusing extra Settings mode.

## What Changes

- Under **Folder policies** (bidirectional only), add a collapsed expandable section: **“Choose Raindrop-only collections to sync”**
- When expanded: list Raindrop collections under the root that are not fully present in Edge (and empty ones), with Sync checkboxes; Refresh; badges (Raindrop only / empty)
- Persist an allowlist of Raindrop collection ids (display path for UI); **new** collections default to unchecked (opt-in)
- **Do not** add a fourth Raindrop→Edge folders dropdown mode—the three existing modes stay; the expandable is how you opt in Raindrop-only paths
- Engine: Raindrop-only paths create folders / pull only if allowlisted (or Edge path already exists); allowlisted empties get folder ensure; no catch-all
- When mode is `create-as-needed` or `mirror-all`, keep current “sync all under root” behavior (expandable can still show status / optional future “pin” — v1: expandable allowlist applies as the selective gate when non-empty, OR always for raindrop-only — see design)
- Document in README; extend verify scripts

## Capabilities

### New Capabilities

- `selective-raindrop-folders`: Allowlist of Raindrop-only collections, Folder-policies expandable UI, and rules for which Raindrop-only paths may create Edge folders / receive pulls

### Modified Capabilities

- `extension-config`: Folder policies section gains expandable Raindrop-only picker (bidirectional); persist allowlist
- `raindrop-to-edge-folders`: Raindrop-only creation gated by allowlist when user is selecting (see design); no new dropdown mode
- `bidirectional-sync`: Gate pull / empty ensure for Raindrop-only paths on allowlist (+ Edge-existing bypass)

## Impact

- **Config / storage:** allowlist map keyed by Raindrop collection id
- **Engine:** reconcile / sync allowlist checks
- **UI:** `options.html` / `options.js` / CSS — expandable under Folder policies (not Settings)
- **Docs / tests:** README; verify scripts
- **Raindrop API:** existing collection index only
