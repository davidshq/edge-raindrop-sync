## ADDED Requirements

### Requirement: Mode-aware durable jobs for pull and delete
The sync engine SHALL support durable job kinds for bidirectional work (at minimum: Raindrop→Edge create, Edge→Raindrop user-delete, Raindrop→Edge delete) persisted in `chrome.storage.local`, drained idempotently with the same backoff and auth-halt behavior as upload jobs. These jobs SHALL be no-ops when sync mode is `one-way`.

#### Scenario: Pull job survives worker restart
- **WHEN** a Raindrop→Edge ingest job is queued and the service worker is terminated
- **THEN** the job remains in the durable queue
- **AND** the next drain processes it without duplicating an Edge bookmark for an already-recorded pair

#### Scenario: One-way mode ignores bidirectional jobs
- **WHEN** sync mode is `one-way` and a bidirectional job is encountered
- **THEN** the engine does not perform pull or cross-delete side effects for that job

### Requirement: Bidirectional pair map and tombstones
The engine SHALL persist bidirectional pair mappings (`bookmarkId ↔ raindropId`) and tombstones for confirmed user deletes so reconcile does not resurrect deleted items. Extension-authored creates and policy-driven removes SHALL be suppressible so they do not enqueue opposing sync jobs.

#### Scenario: Tombstone blocks recreate
- **WHEN** a user delete has been confirmed and a tombstone exists for that pair
- **AND** reconcile lists the library
- **THEN** the deleted item is not recreated on the other side from stale presence

#### Scenario: Extension-authored Edge create is suppressed
- **WHEN** reconcile creates an Edge bookmark from a raindrop
- **THEN** the resulting `onCreated` event does not enqueue a new Raindrop upload for that bookmark

### Requirement: Periodic reconcile trigger
When sync mode is `bidirectional`, the engine SHALL run Raindrop reconciliation on the alarm heartbeat (and when explicitly requested) to discover new raindrops and remotely deleted raindrops under the configured root.

#### Scenario: Heartbeat reconcile
- **WHEN** bidirectional mode is on and the alarm heartbeat fires
- **THEN** reconcile runs for the configured root tree subject to rate-limit backoff
