## ADDED Requirements

### Requirement: Folder policies host Raindrop-only picker
The extension SHALL place the Raindrop-only collections chooser as an expandable section at the bottom of Folder policies when bidirectional mode is on, and SHALL persist allowlist drafts via the folder-policies save/discard flow. Help text SHALL clarify that the Edge tree above is Edge-only and the expandable is for Raindrop-only opt-in.

#### Scenario: Save allowlist with folder policies
- **WHEN** the user changes Raindrop-only checkboxes and saves folder policies
- **THEN** the allowlist is persisted with overrides

#### Scenario: Discard reverts allowlist draft
- **WHEN** the user discards folder-policy changes
- **THEN** Raindrop-only checkbox draft reverts to the last saved allowlist
