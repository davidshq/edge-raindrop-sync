## ADDED Requirements

### Requirement: Three per-folder sync policies
The system SHALL support exactly three policies for a folder: `sync-and-delete`, `sync-and-keep`, and `exclude`. `sync-and-delete` copies the bookmark to Raindrop and then removes it from Edge. `sync-and-keep` copies the bookmark to Raindrop and leaves it in Edge. `exclude` neither copies nor removes the bookmark.

#### Scenario: Sync-and-delete policy
- **WHEN** a bookmark's effective policy is `sync-and-delete` and its Raindrop write is confirmed
- **THEN** the bookmark is removed from Edge

#### Scenario: Sync-and-keep policy
- **WHEN** a bookmark's effective policy is `sync-and-keep` and its Raindrop write is confirmed
- **THEN** the bookmark remains in Edge
- **AND** it is recorded in the dedup map so it is not re-uploaded

#### Scenario: Exclude policy
- **WHEN** a bookmark's effective policy is `exclude`
- **THEN** it is not sent to Raindrop
- **AND** it is not removed from Edge

### Requirement: Nearest-ancestor policy resolution
The effective policy for a bookmark SHALL be the policy of the nearest ancestor folder that has an explicit override; if no ancestor has an override, the global default policy SHALL apply. The global default SHALL be `sync-and-delete` unless changed in configuration.

#### Scenario: Inherited from nearest ancestor
- **WHEN** folder `Work` has an explicit `sync-and-keep` override and its subfolder `Work/Archive` has no override
- **THEN** a bookmark in `Work/Archive` resolves to `sync-and-keep`

#### Scenario: Closer override wins
- **WHEN** `Work` is `sync-and-keep` and `Work/Secrets` is `exclude`
- **THEN** a bookmark in `Work/Secrets` resolves to `exclude`

#### Scenario: Falls back to global default
- **WHEN** no ancestor of a bookmark's folder has an explicit override
- **THEN** the bookmark resolves to the global default policy

### Requirement: GUID-keyed policy overrides
Per-folder policy overrides SHALL be stored keyed by the folder's GUID so that overrides survive folder renames. The configuration UI SHALL display the human-readable folder path for each override.

#### Scenario: Folder is renamed
- **WHEN** a folder with an explicit override is renamed in Edge
- **THEN** the override still applies because it is keyed by the unchanged GUID

### Requirement: Instant local deletion on confirmed sync
When the effective policy is `sync-and-delete`, the bookmark SHALL be removed from Edge immediately after — and only after — the Raindrop write is confirmed.

#### Scenario: Deletion timing
- **WHEN** a `sync-and-delete` bookmark's Raindrop create is confirmed
- **THEN** `chrome.bookmarks.remove` is called for that bookmark without additional delay

#### Scenario: No deletion before confirmation
- **WHEN** a `sync-and-delete` bookmark's Raindrop write has not yet been confirmed
- **THEN** the bookmark is not removed from Edge

### Requirement: Configurable empty-folder pruning
The system SHALL provide a setting controlling whether Edge folders left empty by deletions are pruned. The default SHALL be to leave empty folders in place.

#### Scenario: Pruning disabled (default)
- **WHEN** the last bookmark in a folder is deleted and pruning is disabled
- **THEN** the now-empty folder remains in Edge

#### Scenario: Pruning enabled
- **WHEN** the last bookmark in a folder is deleted and pruning is enabled
- **THEN** the now-empty folder is removed from Edge

#### Scenario: Excluded folder is never pruned
- **WHEN** pruning is enabled and a folder's policy is `exclude`
- **THEN** that folder is never removed, even if empty
