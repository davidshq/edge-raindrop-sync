## MODIFIED Requirements

### Requirement: Per-folder policy editor
The extension SHALL present the Edge folder tree and let the user assign an explicit policy override to any folder. Edits in the editor SHALL be held as a local draft and SHALL NOT be persisted or take effect for sync until the user explicitly saves. Overrides SHALL be stored keyed by folder node id and displayed alongside the folder's path. The editor SHALL allow discarding unsaved draft changes.

The Edge tree SHALL render as a collapsible hierarchy. Depth-0 roots (e.g. Favorites bar, Other favorites) SHALL start expanded. Folders with child folders at depth ≥ 1 SHALL start collapsed so their descendants are hidden until expanded. The editor SHALL provide per-folder expand/collapse controls for parents, and Expand all / Collapse all controls. Collapse all SHALL restore the default expansion rule (roots expanded; deeper parents collapsed). Parents with hidden descendants SHALL show a count affordance indicating nested folders. Expansion state NEED NOT persist across Options page reloads. Policy draft/save/discard behavior SHALL remain unchanged by expand/collapse.

#### Scenario: Assign an override
- **WHEN** the user selects a folder in the editor and assigns it `exclude`, then saves
- **THEN** an override keyed by that folder's node id is persisted
- **AND** the folder's path and chosen policy are shown in the editor

#### Scenario: Draft does not apply until save
- **WHEN** the user changes a folder's policy in the editor but has not saved
- **THEN** the persisted overrides are unchanged
- **AND** sync continues to resolve policies from the last saved overrides

#### Scenario: Discard draft
- **WHEN** the user has unsaved folder-policy edits and discards them
- **THEN** the editor reverts to the last saved overrides
- **AND** nothing is written to storage

#### Scenario: Remove an override
- **WHEN** the user clears a folder's override and saves
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

## ADDED Requirements

### Requirement: Folder policy tree filter
The Folder policies Edge tree SHALL offer a text filter over folder title and path. While a filter is active, matching folders SHALL remain visible and their ancestor folders SHALL be expanded so matches are reachable. Clearing the filter SHALL restore the default expansion rule.

#### Scenario: Filter reveals nested match
- **WHEN** the user filters for a deeply nested folder name that is under a collapsed parent
- **THEN** the matching folder is shown
- **AND** ancestor folders along its path are expanded

#### Scenario: Clear filter restores defaults
- **WHEN** the user clears the folder filter
- **THEN** the tree returns to roots expanded and deeper parents collapsed
