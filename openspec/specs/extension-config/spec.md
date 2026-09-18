# extension-config Specification

## Purpose

Provide the configuration and status surfaces of the extension: Raindrop credentials, root collection naming, sync mode (one-way or bidirectional), global and per-folder policy settings, pruning, the backfill and reconcile triggers, and a sync status/log display.

## Requirements

### Requirement: Raindrop test-token configuration
The extension SHALL provide a configuration field to enter and store a Raindrop personal test token in `chrome.storage`, and SHALL use it as the bearer credential for Raindrop API requests. The token SHALL NOT be displayed in plain text once saved beyond what is needed to confirm it is set.

#### Scenario: User saves a token
- **WHEN** the user enters a Raindrop test token and saves
- **THEN** the token is persisted in extension storage
- **AND** subsequent Raindrop requests authenticate with it

#### Scenario: No token configured
- **WHEN** no token is configured and a sync is attempted
- **THEN** the sync does not proceed
- **AND** the status view indicates that a token is required

### Requirement: Root collection name configuration
The extension SHALL let the user set the name of the root Raindrop collection under which the Edge tree is mirrored, defaulting to `Edge`.

#### Scenario: Default root name
- **WHEN** the user has not changed the root collection name
- **THEN** mirrored collections are created under a root named `Edge`

#### Scenario: Custom root name
- **WHEN** the user sets the root collection name to a custom value
- **THEN** the Edge tree is mirrored under a collection of that name

### Requirement: Global default policy configuration
The extension SHALL let the user choose the global default policy from `sync-and-delete`, `sync-and-keep`, and `exclude` when sync mode is `one-way`, defaulting to `sync-and-delete`. When sync mode is `bidirectional`, the options UI SHALL NOT present a global delete-vs-keep choice; saving bidirectional mode SHALL persist the global default as `sync-and-keep` (keep both sides). Per-folder overrides of `sync-and-delete` (offload) and `exclude` SHALL remain available in both modes.

#### Scenario: Change global default in one-way
- **WHEN** sync mode is `one-way` and the user sets the global default policy to `sync-and-keep`
- **THEN** bookmarks with no ancestor override resolve to `sync-and-keep`

#### Scenario: Bidirectional implies keep-both globally
- **WHEN** the user selects Bidirectional Sync and saves
- **THEN** the global default policy is persisted as `sync-and-keep`
- **AND** the options UI explains that folder policies can still offload or exclude subtrees

#### Scenario: One-way after-upload control hidden in bidirectional
- **WHEN** sync mode is `bidirectional`
- **THEN** the options UI does not offer a global “delete from Edge after upload” control

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

### Requirement: Empty-folder prune toggle
The extension SHALL expose a toggle controlling whether empty Edge folders are pruned after deletion, defaulting to off (leave folders).

#### Scenario: Toggle pruning
- **WHEN** the user enables the empty-folder prune toggle
- **THEN** subsequent deletions that empty a folder cause that folder to be removed

### Requirement: Backfill trigger
The extension SHALL provide a "Run backfill now" control that starts the one-shot backfill sweep of existing bookmarks.

#### Scenario: User triggers backfill
- **WHEN** the user clicks "Run backfill now"
- **THEN** the backfill sweep begins enqueuing existing bookmarks per their resolved policies

### Requirement: Sync status and log display
The extension SHALL display sync status, including pending queue size, dead-lettered job count (with Retry / Clear when non-empty), approximate `chrome.storage.local` usage, recent sync activity (up to 500 entries retained in local storage), and any errors such as authentication failures, storage write failures, or rate-limit backoff. The status view SHALL offer controls for an opt-in long-term activity archive (enable with settings, export, clear) as specified by the activity-log-archive capability.

#### Scenario: Pending work shown
- **WHEN** jobs are queued and being processed
- **THEN** the status view reflects the pending count and recent activity

#### Scenario: Error surfaced
- **WHEN** a Raindrop authentication error occurs
- **THEN** the error is shown in the status view
- **AND** the view indicates that deletions are halted until it is resolved

#### Scenario: Recent activity retention
- **WHEN** more than 500 activity lines have been recorded
- **THEN** the recent activity list retained for the status view keeps the newest 500 entries

#### Scenario: Storage usage and dead-letter controls
- **WHEN** Status refreshes
- **THEN** used bytes and quota are shown
- **AND** if dead-lettered jobs exist, Retry and Clear actions are offered

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
When bidirectional mode is selected, the options UI SHALL present a short warning that user deletes propagate both ways, note that the global default is keep-both, and point to folder Offload/Exclude for exceptions. The status view SHALL surface reconcile activity (pulls, remote deletes) and related errors.

#### Scenario: Warning shown
- **WHEN** the user views sync mode settings and bidirectional is selected or focused
- **THEN** a warning explains that deleting a bookmark in Edge or Raindrop deletes the paired item in the other system
- **AND** the UI indicates offload is a per-folder exception, not the global bidirectional default

#### Scenario: Reconcile activity in status
- **WHEN** bidirectional reconcile pulls or deletes items
- **THEN** the status or log view reflects that activity

### Requirement: Manual reconcile control
The extension SHALL provide a control to trigger an immediate Raindrop reconcile when bidirectional mode is enabled.

#### Scenario: User runs reconcile
- **WHEN** sync mode is `bidirectional` and the user triggers reconcile
- **THEN** a reconcile pass is scheduled/started for the configured root tree

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

### Requirement: Folder policies host Raindrop-only picker
The extension SHALL place the Raindrop-only collections chooser as an expandable section at the bottom of Folder policies when bidirectional mode is on, and SHALL persist allowlist drafts via the folder-policies save/discard flow. Help text SHALL clarify that the Edge tree above is Edge-only and the expandable is for Raindrop-only opt-in.

#### Scenario: Save allowlist with folder policies
- **WHEN** the user changes Raindrop-only checkboxes and saves folder policies
- **THEN** the allowlist is persisted with overrides

#### Scenario: Discard reverts allowlist draft
- **WHEN** the user discards folder-policy changes
- **THEN** Raindrop-only checkbox draft reverts to the last saved allowlist
