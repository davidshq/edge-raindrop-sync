## MODIFIED Requirements

### Requirement: Per-folder policy editor
The extension SHALL present the Edge folder tree and let the user assign an explicit policy override to any folder. Edits in the editor SHALL be held as a local draft and SHALL NOT be persisted or take effect for sync until the user explicitly applies them. Overrides SHALL be stored keyed by folder node id and displayed alongside the folder's path. The editor SHALL allow discarding unsaved draft changes.

The Folder policies panel SHALL present Apply and Discard on a sticky draft bar that remains visible while the user scrolls the folder tree and Raindrop-only section. The primary action SHALL be labeled **Apply folder policies** (not “Save”) so it is distinct from Settings’ Save settings control. Apply/Discard SHALL stay disabled while the draft matches the last persisted overrides and allowlist.

The Edge tree SHALL render as a collapsible hierarchy. Depth-0 roots (e.g. Favorites bar, Other favorites) SHALL start expanded. Folders with child folders at depth ≥ 1 SHALL start collapsed so their descendants are hidden until expanded. The editor SHALL provide per-folder expand/collapse controls for parents, and Expand all / Collapse all controls. Collapse all SHALL restore the default expansion rule (roots expanded; deeper parents collapsed). Parents with hidden descendants SHALL show a count affordance indicating nested folders. Expansion state NEED NOT persist across Options page reloads. Policy draft/apply/discard behavior SHALL remain unchanged by expand/collapse.

#### Scenario: Assign an override
- **WHEN** the user selects a folder in the editor and assigns it `exclude`, then applies
- **THEN** an override keyed by that folder's node id is persisted
- **AND** the folder's path and chosen policy are shown in the editor

#### Scenario: Draft does not apply until Apply
- **WHEN** the user changes a folder's policy in the editor but has not applied
- **THEN** the persisted overrides are unchanged
- **AND** sync continues to resolve policies from the last applied overrides

#### Scenario: Discard draft
- **WHEN** the user has unsaved folder-policy edits and discards them
- **THEN** the editor reverts to the last applied overrides
- **AND** nothing is written to storage

#### Scenario: Sticky draft bar stays reachable
- **WHEN** the user is on Folder policies and scrolls through a long Edge tree
- **THEN** Apply folder policies and Discard remain visible in the sticky draft bar

#### Scenario: Remove an override
- **WHEN** the user clears a folder's override and applies
- **THEN** that folder reverts to nearest-ancestor / global-default resolution

#### Scenario: Nested folders collapsed by default
- **WHEN** the Folder policies Edge tree loads with nested folders under Other favorites (e.g. Hello, Goodbye, Disney that themselves have children)
- **THEN** Favorites bar and Other favorites are expanded
- **AND** those nested parent folders are collapsed
- **AND** their child folders are not visible until the user expands the parent

#### Scenario: Expand and collapse a folder
- **WHEN** the user expands a collapsed parent folder
- **THEN** its direct child folders become visible
- **WHEN** the user collapses that folder again
- **THEN** its descendants are hidden again

#### Scenario: Expand all and collapse all
- **WHEN** the user chooses Expand all
- **THEN** all parent folders in the Edge tree are expanded
- **WHEN** the user chooses Collapse all
- **THEN** depth-0 roots remain expanded and deeper parents are collapsed

## MODIFIED Requirements

### Requirement: Folder policies host Raindrop-only picker
The extension SHALL place the Raindrop-only collections chooser as an expandable section at the bottom of Folder policies when bidirectional mode is on, and SHALL persist allowlist drafts via the folder-policies apply/discard flow. Help text SHALL clarify that the Edge tree above is Edge-only and the expandable is for Raindrop-only opt-in, and that changes take effect with **Apply folder policies**.

#### Scenario: Apply allowlist with folder policies
- **WHEN** the user changes Raindrop-only checkboxes and applies folder policies
- **THEN** the allowlist is persisted with overrides

#### Scenario: Discard reverts allowlist draft
- **WHEN** the user discards folder-policy changes
- **THEN** Raindrop-only checkbox draft reverts to the last applied allowlist
