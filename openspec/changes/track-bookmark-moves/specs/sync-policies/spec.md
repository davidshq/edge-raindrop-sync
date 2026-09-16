## ADDED Requirements

### Requirement: Destination policy applies on Edge moves
When an Edge bookmark is moved to a new parent, the effective policy used for the resulting upload/update drain SHALL be resolved from the bookmark's **new** ancestor folders (nearest override, else global default), not from the old parent. `exclude` SHALL skip Raindrop create and collection update. `sync-and-keep` SHALL create or update placement and leave the Edge bookmark. `sync-and-delete` SHALL create or update placement and, after confirmation, remove the Edge bookmark per existing offload rules.

#### Scenario: Move into exclude skips Raindrop write
- **WHEN** a bookmark (paired or unpaired) is moved under an effective `exclude` folder
- **AND** its upload job is drained
- **THEN** no Raindrop create or collection update is performed
- **AND** the Edge bookmark remains in the exclude folder

#### Scenario: Move into sync-and-keep updates or creates
- **WHEN** a bookmark is moved under an effective `sync-and-keep` folder
- **AND** its upload job is drained
- **THEN** Raindrop reflects the new path (create if unpaired, collection update if paired)
- **AND** the Edge bookmark remains

#### Scenario: Move into sync-and-delete offloads after confirm
- **WHEN** a bookmark is moved under an effective `sync-and-delete` folder
- **AND** its Raindrop create or collection update is confirmed
- **THEN** the Edge bookmark is removed
- **AND** the Raindrop copy remains at the destination collection path
