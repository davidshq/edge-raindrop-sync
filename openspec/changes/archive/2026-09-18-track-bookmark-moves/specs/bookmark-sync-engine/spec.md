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

### Requirement: Live capture of Edge bookmark title and URL changes
The extension SHALL register a `chrome.bookmarks.onChanged` listener. When a URL bookmark's title and/or URL changes, the engine SHALL enqueue a durable upload job for that bookmark's id and signal drain. The listener SHALL NOT perform Raindrop network work inline.

#### Scenario: User renames a bookmark
- **WHEN** the user changes the title of a URL bookmark in Edge
- **THEN** an upload job for that bookmark id is appended to the durable queue
- **AND** the drain process is signaled to run

#### Scenario: User edits a bookmark URL
- **WHEN** the user changes the URL of a bookmark in Edge
- **THEN** an upload job for that bookmark id is appended to the durable queue

### Requirement: Live capture of Edge folder renames
The extension SHALL handle `chrome.bookmarks.onChanged` for folder nodes (no URL). When a folder has a persisted `edgeFolderId → raindropCollectionId` mapping and its effective policy is not `exclude`, the engine SHALL enqueue a durable `rename-collection` (folder-rename) job for that folder id and signal drain. When no mapping exists, the engine SHALL NOT invent a Raindrop collection solely from the rename. Folder rename SHALL NOT enqueue upload jobs for descendant URL bookmarks solely because the folder title changed.

#### Scenario: User renames a previously synced folder
- **WHEN** the user changes the title of an Edge folder that has a folder→collection mapping
- **AND** the folder's effective policy is not `exclude`
- **THEN** a rename-collection job for that folder id is enqueued
- **AND** drain is signaled

#### Scenario: Rename of never-synced folder is a no-op
- **WHEN** the user renames an Edge folder with no folder→collection mapping
- **THEN** no Raindrop collection create or rename is performed for that event

#### Scenario: Rename under exclude is skipped
- **WHEN** the user renames a folder whose effective policy is `exclude`
- **THEN** no rename-collection job is processed against Raindrop (job not enqueued, or drained as a no-op drop)

### Requirement: Paired bookmark drain updates Edge-owned Raindrop fields
When an upload job is drained for a bookmark that already has a pair mapping, the engine SHALL resolve the bookmark's current Edge folder path to a Raindrop collection (ensure-if-missing under the same rules as create) and update the paired raindrop via a field-selective update of Edge-owned fields (`link`, `title`, and `collection` placement) from the live Edge node. The engine MUST NOT clear or overwrite Raindrop-only fields (tags, notes, highlights, covers, excerpts). When the bookmark is unpaired, create behavior SHALL remain as today. While ensuring the path, the engine SHALL persist `edgeFolderId → raindropCollectionId` for folder segments along the bookmark's ancestor chain so later folder renames can resolve the collection without the old title.

#### Scenario: Paired bookmark moved to a new folder
- **WHEN** a paired Edge bookmark's upload job is drained after a parent-folder change
- **THEN** the paired raindrop's collection is updated to match the new Edge path
- **AND** Raindrop tags, notes, highlights, covers, and excerpts remain intact
- **AND** Recent activity records a move/placement update line

#### Scenario: Paired bookmark title or URL edited
- **WHEN** a paired Edge bookmark's upload job is drained after an `onChanged` title and/or URL edit
- **THEN** the paired raindrop's `title` and/or `link` are updated to match the live Edge node
- **AND** Raindrop-only fields remain intact
- **AND** Recent activity records an update line

#### Scenario: Unpaired bookmark after move or change still creates
- **WHEN** an unpaired URL bookmark under a non-exclude policy is drained (including after a move into a syncable folder)
- **THEN** a Raindrop bookmark is created in the path-matching collection
- **AND** the pair mapping is persisted

#### Scenario: Already-correct fields are idempotent
- **WHEN** a paired bookmark is drained and its Raindrop Edge-owned fields already match the live Edge node
- **THEN** the update is still allowed as an idempotent write
- **AND** the job completes without creating a duplicate raindrop

### Requirement: Folder rename drain renames Raindrop collection in place
When a `rename-collection` job is drained, the engine SHALL load the Edge folder node and the persisted collection id for that folder id, then update the Raindrop collection title to the folder's current title via a field-selective collection update. The engine SHALL refresh path→collection cache entries so the old title path does not keep receiving ensures (rewrite prefix keys or drop the stale prefix and allow later ensure to repopulate). The collection id SHALL remain unchanged so existing raindrops do not need reassignment. On Raindrop 404, the engine SHALL clear the stale folder mapping and drop the job without creating a replacement collection from the rename alone.

#### Scenario: Synced folder renamed in Edge
- **WHEN** a rename-collection job drains for a mapped folder
- **THEN** the Raindrop collection title matches the new Edge folder title
- **AND** the Raindrop collection id is unchanged
- **AND** Recent activity records a folder rename line

#### Scenario: Stale folder mapping on rename
- **WHEN** Raindrop returns not-found for the mapped collection id during rename
- **THEN** the folder→collection mapping is cleared
- **AND** no new collection is created solely for the rename
