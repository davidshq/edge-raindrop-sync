## ADDED Requirements

### Requirement: Dead-letter after max attempts
The sync engine SHALL move a queued job into a durable dead-letter list when transient retries exceed a configured maximum attempt count. Auth failures that halt deletions and global rate-limit pauses SHALL NOT dead-letter jobs solely for those reasons. Dead-lettered jobs SHALL NOT consume the per-drain job budget until the user retries them.

#### Scenario: Poison job exhausts retries
- **WHEN** a due job fails with a non-auth, non-rate-limit error and its attempt count reaches the maximum
- **THEN** the job is removed from the active queue
- **AND** it is appended to the dead-letter list with the last error and timestamp
- **AND** the activity log records that the job was dead-lettered

#### Scenario: Rate limit does not dead-letter
- **WHEN** a job fails because of a Raindrop rate limit
- **THEN** the job remains in the active queue deferred until the pause ends
- **AND** it is not moved to the dead-letter list

### Requirement: Dead-letter recovery in Options
The Options Status section SHALL show the count of dead-lettered jobs and SHALL provide actions to retry all dead-lettered jobs (re-enqueue with attempts reset) or clear the dead-letter list.

#### Scenario: User retries dead-lettered jobs
- **WHEN** the user chooses Retry dead-lettered jobs and at least one dead-letter entry exists
- **THEN** each entry is re-enqueued on the active queue with attempts reset to zero
- **AND** the dead-letter list is emptied for those retried entries

#### Scenario: User clears dead-letter list
- **WHEN** the user chooses Clear dead-lettered jobs
- **THEN** the dead-letter list is emptied
- **AND** those jobs are not re-enqueued

### Requirement: Storage usage visible and writes soft-fail
The extension SHALL report approximate `chrome.storage.local` byte usage in Options Status. When a durable storage write fails (including quota errors), the engine SHALL record the failure in status `lastError` and the activity log and SHALL NOT crash the service worker.

#### Scenario: Status shows storage usage
- **WHEN** the user opens Options Status (or it refreshes)
- **THEN** used bytes and the local storage quota (or a documented fallback) are displayed

#### Scenario: Storage write fails
- **WHEN** `chrome.storage.local.set` rejects or throws
- **THEN** `lastError` is set to a storage-failure message
- **AND** an error is appended to the activity log
- **AND** the service worker continues running

### Requirement: Continuous integration for lint and offline tests
The repository SHALL run ESLint and the offline verify scripts (`npm test`) on pushes and pull requests via CI so regressions are caught without a live Raindrop token.

#### Scenario: Pull request validation
- **WHEN** a pull request is opened or updated
- **THEN** CI runs lint and `npm test`
- **AND** the check fails if either step fails
