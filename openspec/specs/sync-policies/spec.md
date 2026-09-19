# sync-policies Specification

## Purpose

Define the per-folder sync policies, how a bookmark's effective policy is resolved through the folder tree, how confirmed syncs drive local deletion and optional empty-folder pruning, and how those policies interact with bidirectional sync.

## Requirements

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
Per-folder policy overrides SHALL be stored keyed by the folder's Chromium node `id` so that overrides survive folder renames (the extensions API does not expose the on-disk GUID; historical docs used "GUID" for this identity). The configuration UI SHALL display the human-readable folder path for each override.

#### Scenario: Folder is renamed
- **WHEN** a folder with an explicit override is renamed in Edge
- **THEN** the override still applies because it is keyed by the unchanged node id

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

### Requirement: Bidirectional mode and sync-and-delete coexistence
The per-folder policies `sync-and-delete`, `sync-and-keep`, and `exclude` SHALL remain available when sync mode is `bidirectional`. `sync-and-delete` SHALL continue to mean “after confirmed Edge→Raindrop create, remove the Edge bookmark,” and that removal SHALL NOT be treated as a user delete for Raindrop propagation. The `edge-offload` tombstone SHALL be recorded before the Edge removal, with the raindrop id stashed on the job first, and the pair SHALL be cleared after the removal so bidirectional pull cannot undo the offload. A drain that finds the bookmark already gone SHALL finish that tombstone when the job carries the raindrop id.

#### Scenario: Sync-and-delete still removes Edge only
- **WHEN** bidirectional mode is on and a bookmark's effective policy is `sync-and-delete`
- **AND** its Raindrop create is confirmed
- **THEN** the Edge bookmark is removed
- **AND** the Raindrop bookmark remains
- **AND** the pair mapping is cleared
- **AND** an `edge-offload` tombstone is recorded

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

#### Scenario: Excluded bookmark kept when Raindrop copy disappears
- **WHEN** a previously paired bookmark now sits under an effective `exclude` policy
- **AND** its paired raindrop is absent during reconcile
- **THEN** the Edge bookmark is left in place
- **AND** the pair mapping is cleared (and a tombstone recorded) so delete jobs do not retry



### Requirement: Destination policy applies on Edge moves and changes
When an Edge bookmark is moved to a new parent or its title/URL change is drained, the effective policy used for the resulting upload/update drain SHALL be resolved from the bookmark's **current** ancestor folders (nearest override, else global default), not from a prior parent. `exclude` SHALL skip Raindrop create and Edge-owned field updates. `sync-and-keep` SHALL create or update and leave the Edge bookmark. `sync-and-delete` SHALL create or update and, after confirmation, remove the Edge bookmark per existing offload rules. Folder renames under an effective `exclude` policy SHALL NOT update Raindrop collection titles.

#### Scenario: Move into exclude skips Raindrop write
- **WHEN** a bookmark (paired or unpaired) is moved under an effective `exclude` folder
- **AND** its upload job is drained
- **THEN** no Raindrop create or Edge-owned update is performed
- **AND** the Edge bookmark remains in the exclude folder

#### Scenario: Move into sync-and-keep updates or creates
- **WHEN** a bookmark is moved under an effective `sync-and-keep` folder
- **AND** its upload job is drained
- **THEN** Raindrop reflects the new path (create if unpaired, collection update if paired)
- **AND** the Edge bookmark remains

#### Scenario: Move into sync-and-delete offloads after confirm
- **WHEN** a bookmark is moved under an effective `sync-and-delete` folder
- **AND** its Raindrop create or Edge-owned update is confirmed
- **THEN** the Edge bookmark is removed
- **AND** the Raindrop copy remains at the destination collection path

#### Scenario: Title edit under exclude skips Raindrop write
- **WHEN** a bookmark under an effective `exclude` folder has its title changed
- **AND** an upload job for it is drained
- **THEN** no Raindrop update is performed

#### Scenario: Folder rename under exclude skips Raindrop rename
- **WHEN** an Edge folder with effective policy `exclude` is renamed
- **THEN** no Raindrop collection title update is performed for that rename
