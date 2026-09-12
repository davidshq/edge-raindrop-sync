## ADDED Requirements

### Requirement: Sync mode configuration
The extension SHALL let the user choose sync mode from `one-way` and `bidirectional`, defaulting to `one-way`, and SHALL persist the choice in extension storage.

#### Scenario: Save bidirectional mode
- **WHEN** the user selects Bidirectional Sync and saves
- **THEN** the sync mode is persisted as `bidirectional`
- **AND** subsequent engine behavior uses bidirectional rules

#### Scenario: Default one-way
- **WHEN** the user has not set a sync mode
- **THEN** the effective mode is `one-way`

### Requirement: Bidirectional warning and status
When bidirectional mode is selected, the options UI SHALL present a short warning that user deletes propagate both ways, and the status view SHALL surface reconcile activity (pulls, remote deletes) and related errors.

#### Scenario: Warning shown
- **WHEN** the user views sync mode settings and bidirectional is selected or focused
- **THEN** a warning explains that deleting a bookmark in Edge or Raindrop deletes the paired item in the other system

#### Scenario: Reconcile activity in status
- **WHEN** bidirectional reconcile pulls or deletes items
- **THEN** the status or log view reflects that activity

### Requirement: Manual reconcile control
The extension SHALL provide a control to trigger an immediate Raindrop reconcile when bidirectional mode is enabled.

#### Scenario: User runs reconcile
- **WHEN** sync mode is `bidirectional` and the user triggers reconcile
- **THEN** a reconcile pass is scheduled/started for the configured root tree
