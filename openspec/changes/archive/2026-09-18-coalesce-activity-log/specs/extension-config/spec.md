## MODIFIED Requirements

### Requirement: Sync status and log display
The extension SHALL display sync status, including pending queue size, dead-lettered job count (with Retry / Clear when non-empty), approximate `chrome.storage.local` usage, recent sync activity (up to 500 entries retained in local storage), and any errors such as authentication failures, storage write failures, or rate-limit backoff. The status view SHALL offer controls for an opt-in long-term activity archive (enable with settings, export, clear) as specified by the activity-log-archive capability.

When a new activity line has the same level and message as the newest recent-log entry, the extension SHALL update that entry instead of inserting another. The updated entry SHALL set `at` to the latest occurrence and SHALL record kept occurrence times in `ats` (oldest first, including the latest), capped so older times beyond the cap are dropped. A first occurrence SHALL omit `ats`. A line that does not match the newest entry SHALL be inserted as a new row. The status view SHALL show the latest time and, when `ats` has more than one time, a repeat count. It SHALL NOT require a control to expand the time list. Entries recorded before coalescing (no `ats`) SHALL still render as a single line.

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

#### Scenario: Consecutive identical lines coalesce
- **WHEN** the same level and message are logged again and that pair is already the newest recent-log entry
- **THEN** the recent log still has one entry for that run
- **AND** `at` is the latest time
- **AND** `ats` lists the kept occurrence times oldest first

#### Scenario: Different message starts a new row
- **WHEN** a different message is logged between two identical lines
- **THEN** the later identical line is a separate recent-log entry

#### Scenario: Status shows repeat count
- **WHEN** the status view renders an entry whose `ats` length is greater than 1
- **THEN** the row shows the latest time, the message, and a repeat count equal to `ats.length`
