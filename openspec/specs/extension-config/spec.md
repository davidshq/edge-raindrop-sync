# extension-config Specification

## Purpose

Provide the configuration and status surfaces of the extension: Raindrop credentials, root collection naming, global and per-folder policy settings, pruning, the backfill trigger, and a sync status/log display.

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
The extension SHALL let the user choose the global default policy from `sync-and-delete`, `sync-and-keep`, and `exclude`, defaulting to `sync-and-delete`.

#### Scenario: Change global default
- **WHEN** the user sets the global default policy to `sync-and-keep`
- **THEN** bookmarks with no ancestor override resolve to `sync-and-keep`

### Requirement: Per-folder policy editor
The extension SHALL present the Edge folder tree and let the user assign an explicit policy override to any folder. Overrides SHALL be stored keyed by folder GUID and displayed alongside the folder's path.

#### Scenario: Assign an override
- **WHEN** the user selects a folder in the editor and assigns it `exclude`
- **THEN** an override keyed by that folder's GUID is persisted
- **AND** the folder's path and chosen policy are shown in the editor

#### Scenario: Remove an override
- **WHEN** the user clears a folder's override
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
The extension SHALL display sync status, including pending queue size, recent sync activity, and any errors such as authentication failures or rate-limit backoff.

#### Scenario: Pending work shown
- **WHEN** jobs are queued and being processed
- **THEN** the status view reflects the pending count and recent activity

#### Scenario: Error surfaced
- **WHEN** a Raindrop authentication error occurs
- **THEN** the error is shown in the status view
- **AND** the view indicates that deletions are halted until it is resolved
