## MODIFIED Requirements

### Requirement: GUID-keyed policy overrides
Per-folder policy overrides SHALL be stored keyed by the folder's Chromium node `id` so that overrides survive folder renames (the extensions API does not expose the on-disk GUID; historical docs used “GUID” for this identity). The configuration UI SHALL display the human-readable folder path for each override.

#### Scenario: Folder is renamed
- **WHEN** a folder with an explicit override is renamed in Edge
- **THEN** the override still applies because it is keyed by the unchanged node id
