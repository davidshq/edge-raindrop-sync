# bookmark-sync-engine Specification

## Purpose

Capture newly created and existing Edge bookmarks and reliably mirror them into Raindrop through a durable, idempotent enqueue-then-drain pipeline that confirms each Raindrop write before applying any policy-driven local action.

## Requirements

### Requirement: Live capture of newly created bookmarks
The extension SHALL register a `chrome.bookmarks.onCreated` listener that, for each newly created bookmark with a URL, appends a sync job to a durable queue in `chrome.storage.local`. The listener SHALL NOT perform network or deletion work directly.

#### Scenario: User creates a bookmark
- **WHEN** the user adds a new bookmark in Edge
- **THEN** a sync job referencing that bookmark's GUID is appended to the durable queue
- **AND** the drain process is signaled to run

#### Scenario: A folder is created
- **WHEN** the `onCreated` event fires for a node with no URL (a folder)
- **THEN** no sync job is enqueued for the folder itself
- **AND** the folder's collection is created lazily when a bookmark inside it is later synced

### Requirement: Durable enqueue-then-drain pipeline
The extension SHALL persist the sync queue, retry metadata, and in-flight progress in `chrome.storage.local` so that no state is held in service-worker memory across events. A drain step SHALL process queued jobs idempotently and SHALL be triggered both by capture events and by a `chrome.alarms` heartbeat.

#### Scenario: Service worker is terminated mid-drain
- **WHEN** the MV3 service worker is terminated while a job is being processed
- **THEN** the job remains in the durable queue
- **AND** the next drain reprocesses it without duplicating an already-confirmed Raindrop write

#### Scenario: Heartbeat drains with no new activity
- **WHEN** the `chrome.alarms` heartbeat fires and the queue is non-empty
- **THEN** the drain step runs and processes pending jobs even though no new bookmark was created

#### Scenario: Queue is empty
- **WHEN** the drain runs and the queue is empty
- **THEN** it completes without making any Raindrop requests

### Requirement: Confirm-before-act ordering
The engine SHALL create the Raindrop bookmark and persist the `guid → raindropId` mapping BEFORE performing any policy-driven local action. No local deletion SHALL occur unless the corresponding Raindrop write has been confirmed.

#### Scenario: Raindrop create succeeds
- **WHEN** a job is drained and the Raindrop API confirms the bookmark was created
- **THEN** the `guid → raindropId` mapping is persisted
- **AND** only then is the resolved policy's local action applied

#### Scenario: Raindrop create fails
- **WHEN** the Raindrop API returns an error for a job
- **THEN** the bookmark is not removed from Edge
- **AND** the job remains queued for retry

### Requirement: Folder mirroring into nested Raindrop collections
The engine SHALL recreate the Edge folder path of each synced bookmark as nested Raindrop collections under a user-chosen root collection, creating any missing collection (ensure-if-missing) and caching `path → collectionId` in storage. Both Edge roots SHALL be preserved under the chosen root.

#### Scenario: Bookmark in a nested folder
- **WHEN** a bookmark located at `Favorites bar/Work/ProjectA` is synced with root collection `Edge`
- **THEN** the collections `Edge`, `Edge/Favorites bar`, `Edge/Favorites bar/Work`, and `Edge/Favorites bar/Work/ProjectA` exist (created if missing)
- **AND** the raindrop is placed in the `Edge/Favorites bar/Work/ProjectA` collection

#### Scenario: Collection already exists
- **WHEN** a path's collection has already been resolved and cached
- **THEN** the cached `collectionId` is reused without an additional create or lookup request

#### Scenario: Both Edge roots preserved
- **WHEN** bookmarks exist under both the Favorites bar and Other favorites roots
- **THEN** they map to `Edge/Favorites bar/…` and `Edge/Other favorites/…` respectively

### Requirement: Deduplication of already-synced bookmarks
The engine SHALL maintain a persisted `guid → raindropId` map and SHALL skip creating a Raindrop bookmark for any GUID already present in the map.

#### Scenario: Same bookmark drained twice
- **WHEN** a job for a GUID already present in the dedup map is drained
- **THEN** no new Raindrop bookmark is created
- **AND** the job is treated as already satisfied

#### Scenario: Sync-and-keep bookmark on repeated heartbeat
- **WHEN** a bookmark in a `sync-and-keep` folder remains in Edge and the heartbeat re-encounters it
- **THEN** it is not re-uploaded because its GUID is already in the dedup map

### Requirement: One-shot backfill of existing bookmarks
The extension SHALL provide a user-triggered backfill that walks the existing bookmark tree, enqueues each URL node per its resolved policy, and drains with rate-limit backoff. Backfill progress SHALL be persisted so the sweep resumes after a worker restart rather than restarting.

#### Scenario: User runs backfill
- **WHEN** the user triggers "Run backfill now"
- **THEN** every existing bookmark whose resolved policy is not `exclude` is enqueued for syncing

#### Scenario: Rate limit encountered during backfill
- **WHEN** the Raindrop API returns HTTP 429 during backfill
- **THEN** the engine backs off and retries with exponential delay
- **AND** does not drop the affected jobs

#### Scenario: Worker restarts during backfill
- **WHEN** the service worker restarts partway through a backfill
- **THEN** the sweep resumes from the persisted cursor rather than re-enqueuing already-processed bookmarks

### Requirement: Resilience to transient failures
The engine SHALL retry failed jobs with backoff and SHALL halt local deletions (while keeping jobs queued) when Raindrop authentication fails, surfacing the error to the status view.

#### Scenario: Offline period
- **WHEN** the network is unavailable during a drain
- **THEN** jobs remain queued and are retried on a later heartbeat once connectivity returns

#### Scenario: Invalid or expired token
- **WHEN** the Raindrop API rejects the request due to an invalid or expired token
- **THEN** no bookmarks are deleted from Edge
- **AND** the jobs remain queued
- **AND** the authentication error is shown in the status view
