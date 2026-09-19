## Context

Folder policies already walks the Edge bookmark tree in `paintTree` / `buildRow` and renders every folder as a flat `.tree-row` with `paddingLeft` by depth. Policy draft/save/discard and override storage are unchanged. The UX reference is `mockups/options-revamp/folder-tree-collapse.html`.

## Goals / Non-Goals

**Goals:**

- Collapse nested folders by default so long trees stay scannable
- Keep Favorites bar and Other favorites (depth-0 roots) expanded on first paint
- Expand/collapse per folder; Expand all / Collapse all (collapse restores default open rule)
- Show a descendant-count affordance on collapsed parents
- Preserve draft policy editing, override highlighting, and save/discard

**Non-Goals:**

- Persisting expand/collapse state across Options reloads
- Changing Raindrop-only allowlist list presentation (separate section)
- Virtualizing the tree or rewriting to a third-party tree widget
- Changing sync policy resolution or storage schema

## Decisions

1. **Nested DOM over flat list**  
   Render each folder as a node with an optional `.tree-children` group (hidden when collapsed), matching the mockup. Keeps expand/collapse local to the subtree without recomputing a flat visible slice on every toggle.  
   *Alternative considered:* keep flat rows + `hidden` by ancestor map — simpler paint, worse toggle cost and ARIA grouping.

2. **Default expansion = depth 0 only**  
   Roots start expanded; any parent at depth ≥ 1 starts collapsed. Collapse all resets to this rule (does not collapse roots). Expand all opens every parent.  
   *Alternative considered:* collapse everything including roots — hides the two Edge tops users orient on.

3. **Session-only expand state**  
   Expansion lives in the DOM / in-memory map for the current Options session. Reopening Options restores defaults. Avoids new storage keys and sync with tree mutations.  
   *Alternative considered:* persist expanded ids in `chrome.storage.session` — nice later, not required for v1.

4. **Filter (include in v1 if cheap)**  
   Toolbar search filters by title/path; matching nodes stay visible and ancestors auto-expand. Clearing the filter restores default expansion. Matches mockup; optional to ship in the same change if paint stays small.  
   *Alternative considered:* defer filter to a follow-up — acceptable if Expand all is enough for v1, but mockup already specifies it.

5. **Child-count chip**  
   Show direct child folder count; when nested depth exists, show `direct · nested` (or equivalent) so collapsed parents are not mistaken for leaves.

6. **Accessibility**  
   Twistie buttons use `aria-expanded` / `aria-label`; children use `role="group"`. Leaves omit a usable twistie (spacer only).

## Risks / Trade-offs

- **[Risk]** Re-paint on every policy select currently rebuilds the whole tree → expansion state lost  
  → **Mitigation:** Keep an `expandedIds` Set (or re-apply defaults + preserve known expands) across `paintTree` / draft updates; do not wipe expansion on select change.

- **[Risk]** Very large trees still paint all nodes into the DOM (collapsed children remain mounted)  
  → **Mitigation:** Acceptable for bookmark-scale trees; virtualize only if profiling shows pain.

- **[Risk]** Filter + collapse interaction surprises users  
  → **Mitigation:** Document in hint text; clearing filter restores default open rule (same as Collapse all).

## Migration Plan

- Pure UI change; no storage migration.
- Ship with existing Folder policies tab; no feature flag required.
- Rollback: revert options HTML/JS/CSS; specs archive reversal.

## Open Questions

- None blocking — filter can ship with Expand/Collapse in the same change per mockup.
