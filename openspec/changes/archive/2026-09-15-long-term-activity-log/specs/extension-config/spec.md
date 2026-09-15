## MODIFIED Requirements

### Requirement: Sync status and log display
The extension SHALL display sync status, including pending queue size, recent sync activity (up to 500 entries retained in local storage), and any errors such as authentication failures or rate-limit backoff. The status view SHALL offer controls for an opt-in long-term activity archive (enable with settings, export, clear) as specified by the activity-log-archive capability.

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
