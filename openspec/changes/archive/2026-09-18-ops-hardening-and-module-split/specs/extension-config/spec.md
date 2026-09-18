## MODIFIED Requirements

### Requirement: Per-folder policy editor
The extension SHALL present the Edge folder tree and let the user assign an explicit policy override to any folder. Edits in the editor SHALL be held as a local draft and SHALL NOT be persisted or take effect for sync until the user explicitly saves. Overrides SHALL be stored keyed by folder node id and displayed alongside the folder's path. The editor SHALL allow discarding unsaved draft changes.

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

## ADDED Requirements

### Requirement: Status shows storage usage and dead-letter controls
The Options Status section SHALL display approximate `chrome.storage.local` usage and SHALL expose controls to retry or clear dead-lettered sync jobs when any exist.

#### Scenario: Storage usage on status refresh
- **WHEN** Status refreshes
- **THEN** used bytes and quota are shown to the user

#### Scenario: Dead-letter controls when list non-empty
- **WHEN** one or more jobs are in the dead-letter list
- **THEN** Options shows the count and offers Retry and Clear actions
