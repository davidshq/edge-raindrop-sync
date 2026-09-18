## ADDED Requirements

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
