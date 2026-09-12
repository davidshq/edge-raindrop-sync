## ADDED Requirements

### Requirement: Bidirectional mode and sync-and-delete coexistence
The per-folder policies `sync-and-delete`, `sync-and-keep`, and `exclude` SHALL remain available when sync mode is `bidirectional`. `sync-and-delete` SHALL continue to mean “after confirmed Edge→Raindrop create, remove the Edge bookmark,” and that removal SHALL NOT be treated as a user delete for Raindrop propagation.

#### Scenario: Sync-and-delete still removes Edge only
- **WHEN** bidirectional mode is on and a bookmark's effective policy is `sync-and-delete`
- **AND** its Raindrop create is confirmed
- **THEN** the Edge bookmark is removed
- **AND** the Raindrop bookmark remains

#### Scenario: Sync-and-keep retains both sides
- **WHEN** bidirectional mode is on and a bookmark's effective policy is `sync-and-keep`
- **AND** its Raindrop create is confirmed
- **THEN** the Edge bookmark remains
- **AND** the pair mapping is retained for later delete propagation

### Requirement: Exclude blocks bidirectional effects
An effective `exclude` policy SHALL prevent upload, Raindrop→Edge ingest into that path, and delete propagation for bookmarks under that folder, in both one-way and bidirectional modes.

#### Scenario: Excluded bookmark not delete-propagated
- **WHEN** a bookmark under an `exclude` folder is deleted in Edge
- **THEN** no Raindrop delete is attempted for it even if bidirectional mode is on
