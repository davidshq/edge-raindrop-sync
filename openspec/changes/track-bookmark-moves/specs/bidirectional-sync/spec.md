## ADDED Requirements

### Requirement: Edge folder moves do not delete Raindrop
When the user moves a mapped Edge bookmark or folder (parent change only), the system SHALL update Raindrop collection placement as defined by the bookmark-sync-engine move requirements and SHALL NOT treat the move as a user delete: no Raindrop delete, no delete-propagation tombstone for that action, and no Edge remove unless destination policy is `sync-and-delete` after a confirmed create/update (existing offload path with remove suppression).

#### Scenario: Bidirectional move updates placement only
- **WHEN** sync mode is `bidirectional` and the user moves a paired Edge bookmark to another non-exclude folder
- **THEN** the paired raindrop remains (same raindrop id)
- **AND** its collection placement is updated to the new path
- **AND** no `delete-raindrop` job is enqueued for the move

#### Scenario: Offload after move still suppresses delete propagation
- **WHEN** bidirectional mode is on and a moved bookmark's destination effective policy is `sync-and-delete`
- **AND** the Raindrop create or collection update is confirmed and the extension removes the Edge bookmark
- **THEN** no Raindrop delete is enqueued for that remove
- **AND** an `edge-offload` tombstone is recorded as for create-time offload
