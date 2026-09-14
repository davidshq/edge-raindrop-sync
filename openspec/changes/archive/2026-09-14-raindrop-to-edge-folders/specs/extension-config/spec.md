## ADDED Requirements

### Requirement: Raindrop-to-Edge folders configuration
The extension SHALL let the user choose Raindrop→Edge folder mode from `existing-only`, `create-as-needed`, and `mirror-all` when sync mode is `bidirectional`, defaulting to `create-as-needed`, and SHALL persist the choice in extension storage with the rest of settings. When sync mode is `one-way`, the options UI SHALL NOT present this control.

#### Scenario: Save folder mode with bidirectional
- **WHEN** sync mode is `bidirectional` and the user selects a Raindrop→Edge folders value and saves settings
- **THEN** the folder mode is persisted
- **AND** subsequent bidirectional reconcile/pull uses that mode

#### Scenario: Control hidden in one-way
- **WHEN** sync mode is `one-way`
- **THEN** the options UI does not show the Raindrop→Edge folders control

#### Scenario: Default create-as-needed
- **WHEN** the user has never set Raindrop→Edge folder mode
- **THEN** the effective stored/default mode is `create-as-needed`

#### Scenario: Help text explains skip vs create vs mirror
- **WHEN** bidirectional mode is selected and the user views Raindrop→Edge folders
- **THEN** the UI explains that existing-only skips unmatched raindrops without a catch-all folder
- **AND** explains that create-as-needed creates folders when pulling bookmarks
- **AND** explains that mirror-all also creates folders for empty Raindrop collections under the root
