## Context

Folder policies already holds overrides and the Raindrop-only allowlist in an in-memory draft until the user clicks Save folder policies / Discard (`draftOverrides` / `draftAllowlist` in `options.js`). Tabs separated that row from Settings Save, but the controls still scroll away under a deep tree. UX reference: `mockups/options-revamp/twin-rails.html` draft bar (sticky, Apply naming).

## Goals / Non-Goals

**Goals:**

- Keep Apply / Discard visible while scrolling the Folder policies panel
- Rename the primary action to **Apply folder policies** so it does not read as Settings Save
- Preserve existing dirty detection, persist, discard, and flash status behavior

**Non-Goals:**

- Changing when drafts persist or what they write to storage
- Sticky bar on other tabs
- Tree + inspector layout (selects remain on rows)
- Dark-theme whole Options page (Night Switchboard)

## Decisions

1. **Sticky within the Folders panel, always present**  
   `position: sticky; bottom: 0` on a `.draft-bar` at the end of `#panel-folders`. Buttons stay disabled when clean (same as today). Always visible so Apply is discoverable without a dirty edit first.  
   *Alternative considered:* hide bar when clean (twin-rails) — nicer chrome, worse discoverability after Apply.

2. **Apply naming, keep stable element ids where cheap**  
   Visible label and status copy say Apply / Applied; keep `id="savePolicies"` (and `savePolicies()` handler) to avoid a wide rename, or rename both to `applyPolicies` if the touch set stays small. Prefer renaming ids to match Apply for clarity.

3. **Visual distinction without full dark Options**  
   Elevated bar (darker ink background or strong border + shadow) using options tokens so it reads as a draft workspace, not another `.row` next to Settings. Borrow twin-rails contrast, not a new design system.

4. **Padding**  
   Ensure panel/main bottom padding so the last Raindrop-only rows are not trapped under the sticky bar.

## Risks / Trade-offs

- **[Risk]** Sticky bar covers the last list rows  
  → **Mitigation:** Extra bottom padding on `#panel-folders` / main; bar height stays compact.

- **[Risk]** “Apply” vs “Save” wording drift in README / Raindrop-only help  
  → **Mitigation:** Grep and update user-facing “Save folder policies” strings in the same change.

## Migration Plan

- Pure UI/copy; no storage migration.
- Rollback: revert options HTML/CSS/JS + README/spec deltas.

## Open Questions

- None blocking.
