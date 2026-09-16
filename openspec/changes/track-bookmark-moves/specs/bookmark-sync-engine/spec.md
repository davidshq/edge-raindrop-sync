## ADDED Requirements

### Requirement: Live capture of Edge bookmark moves
The extension SHALL register a `chrome.bookmarks.onMoved` listener. When a URL bookmark's parent folder changes, the engine SHALL enqueue a durable upload job for that bookmark's id and signal drain. When a folder is moved, the engine SHALL walk the folder's live descendant tree, enqueue an upload job for each URL bookmark, and signal drain once. Same-parent moves (index-only reorders) SHALL NOT enqueue work. Folder nodes themselves SHALL NOT enqueue a job for the folder id.

#### Scenario: User moves a bookmark to another folder
- **WHEN** the user drags a URL bookmark from one Edge folder to another
- **THEN** an upload job for that bookmark GUID is appended to the durable queue
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

### Requirement: Paired bookmark drain updates Raindrop collection
When an upload job is drained for a bookmark that already has a pair mapping, the engine SHALL resolve the bookmark's current Edge folder path to a Raindrop collection (ensure-if-missing under the same rules as create) and update the paired raindrop's collection placement via a field-selective update. The engine MUST NOT clear or overwrite Raindrop-only fields (tags, notes, highlights, covers, excerpts). When the bookmark is unpaired, create behavior SHALL remain as today.

#### Scenario: Paired bookmark moved to a new folder
- **WHEN** a paired Edge bookmark's upload job is drained after a parent-folder change
- **THEN** the paired raindrop's collection is updated to match the new Edge path
- **AND** Raindrop tags, notes, highlights, covers, and excerpts remain intact
- **AND** Recent activity records a move/placement update line

#### Scenario: Unpaired bookmark after move still creates
- **WHEN** an unpaired URL bookmark under a non-exclude policy is drained (including after a move into a syncable folder)
- **THEN** a Raindrop bookmark is created in the path-matching collection
- **AND** the pair mapping is persisted

#### Scenario: Already-correct collection is idempotent
- **WHEN** a paired bookmark is drained and its Raindrop collection already matches the resolved Edge path
- **THEN** the update is still allowed as an idempotent write
- **AND** the job completes without creating a duplicate raindrop
