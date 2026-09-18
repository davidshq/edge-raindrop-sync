## MODIFIED Requirements

### Requirement: Live capture of newly created bookmarks
The extension SHALL register a `chrome.bookmarks.onCreated` listener that, for each newly created bookmark with a URL, appends a sync job to a durable queue in `chrome.storage.local`. The listener SHALL NOT perform network or deletion work directly. Jobs SHALL reference the bookmark's Chromium node `id` (the extensions API does not expose the on-disk GUID).

#### Scenario: User creates a bookmark
- **WHEN** the user adds a new bookmark in Edge
- **THEN** a sync job referencing that bookmark's node id is appended to the durable queue
- **AND** the drain process is signaled to run

#### Scenario: A folder is created
- **WHEN** the `onCreated` event fires for a node with no URL (a folder)
- **THEN** no sync job is enqueued for the folder itself
- **AND** the folder's collection is created lazily when a bookmark inside it is later synced

### Requirement: Confirm-before-act ordering
The engine SHALL create the Raindrop bookmark and persist the `bookmarkId → raindropId` mapping BEFORE performing any policy-driven local action. No local deletion SHALL occur unless the corresponding Raindrop write has been confirmed.

#### Scenario: Raindrop create succeeds
- **WHEN** a job is drained and the Raindrop API confirms the bookmark was created
- **THEN** the `bookmarkId → raindropId` mapping is persisted
- **AND** only then is the resolved policy's local action applied

#### Scenario: Raindrop create fails
- **WHEN** the Raindrop API returns an error for a job
- **THEN** the bookmark is not removed from Edge
- **AND** the job remains queued for retry (or is dead-lettered after the maximum attempt count)

### Requirement: Deduplication of already-synced bookmarks
The engine SHALL maintain a persisted `bookmarkId → raindropId` map and SHALL skip creating a Raindrop bookmark for any bookmark id already present in the map.

#### Scenario: Same bookmark drained twice
- **WHEN** a job for a bookmark id already present in the pair map is drained
- **THEN** no new Raindrop bookmark is created
- **AND** the job is treated as already satisfied

#### Scenario: Sync-and-keep bookmark on repeated heartbeat
- **WHEN** a bookmark in a `sync-and-keep` folder remains in Edge and the heartbeat re-encounters it
- **THEN** it is not re-uploaded because its bookmark id is already in the pair map

### Requirement: Live capture of Edge bookmark moves
The extension SHALL register a `chrome.bookmarks.onMoved` listener. When a URL bookmark's parent folder changes, the engine SHALL enqueue a durable upload job for that bookmark's id and signal drain. When a folder is moved, the engine SHALL walk the folder's live descendant tree, enqueue an upload job for each URL bookmark, and signal drain once. Same-parent moves (index-only reorders) SHALL NOT enqueue work. Folder nodes themselves SHALL NOT enqueue a job for the folder id.

#### Scenario: User moves a bookmark to another folder
- **WHEN** the user drags a URL bookmark from one Edge folder to another
- **THEN** an upload job for that bookmark's node id is appended to the durable queue
- **AND** the drain process is signaled to run

#### Scenario: User reorders within the same folder
- **WHEN** `onMoved` fires with the same `parentId` as `oldParentId`
- **THEN** no sync job is enqueued

#### Scenario: User moves a folder of bookmarks
- **WHEN** the user moves an Edge folder that contains URL bookmarks (including nested)
- **THEN** each descendant URL bookmark is enqueued for sync
- **AND** no job is enqueued solely for the folder node

#### Scenario: Move listener does not perform network work inline
- **WHEN** `onMoved` fires
- **THEN** the listener only enqueues durable jobs and signals drain
- **AND** it does not call the Raindrop API directly
