## ADDED Requirements

### Requirement: Edge folder moves and renames do not delete Raindrop
When the user moves a mapped Edge bookmark or folder (parent change only), or renames a mapped Edge folder, or edits a mapped bookmark's title/URL, the system SHALL update the corresponding Edge-owned Raindrop fields or collection title as defined by the bookmark-sync-engine requirements and SHALL NOT treat those actions as a user delete: no Raindrop delete, no delete-propagation tombstone for that action, and no Edge remove unless destination policy is `sync-and-delete` after a confirmed create/update (existing offload path with remove suppression).

#### Scenario: Bidirectional move updates placement only
- **WHEN** sync mode is `bidirectional` and the user moves a paired Edge bookmark to another non-exclude folder
- **THEN** the paired raindrop remains (same raindrop id)
- **AND** its collection placement is updated to the new path
- **AND** no `delete-raindrop` job is enqueued for the move

#### Scenario: Bidirectional folder rename updates collection title only
- **WHEN** sync mode is `bidirectional` and the user renames a mapped Edge folder
- **THEN** the Raindrop collection id remains the same
- **AND** its title is updated
- **AND** no Raindrop deletes are enqueued for bookmarks under that folder solely due to the rename

#### Scenario: Bidirectional title/URL edit updates fields only
- **WHEN** sync mode is `bidirectional` and the user edits a paired bookmark's title or URL
- **THEN** the paired raindrop remains (same raindrop id)
- **AND** only Edge-owned fields are written
- **AND** no `delete-raindrop` job is enqueued for the edit

#### Scenario: Offload after move or update still suppresses delete propagation
- **WHEN** bidirectional mode is on and a moved or updated bookmark's destination effective policy is `sync-and-delete`
- **AND** the Raindrop create or Edge-owned update is confirmed and the extension removes the Edge bookmark
- **THEN** no Raindrop delete is enqueued for that remove
- **AND** an `edge-offload` tombstone is recorded as for create-time offload
