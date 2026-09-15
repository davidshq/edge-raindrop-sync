# bidirectional-sync Specification

## Purpose

Opt-in two-way sync under the configured Raindrop root: Raindrop→Edge ingest, bidirectional user-delete propagation with tombstones, and metadata-safe Edge→Raindrop writes that never clobber Raindrop-only fields.

## Requirements

### Requirement: Opt-in bidirectional sync mode
The system SHALL support a global sync mode of `one-way` or `bidirectional`, defaulting to `one-way`. Bidirectional behavior defined in this capability SHALL apply only when the mode is `bidirectional`.

#### Scenario: Default remains one-way
- **WHEN** the user has never changed sync mode
- **THEN** the extension behaves as one-way Edge→Raindrop sync
- **AND** Raindrop→Edge ingest and bidirectional delete propagation are inactive

#### Scenario: User enables bidirectional
- **WHEN** the user sets sync mode to `bidirectional` and saves
- **THEN** subsequent drains perform Raindrop→Edge ingest and bidirectional delete propagation under the configured root

### Requirement: Raindrop-to-Edge ingest under mirror root
When sync mode is `bidirectional`, the system SHALL periodically reconcile raindrops in the configured root collection and its descendants, creating an Edge bookmark (URL and title) in the mirrored folder path for each raindrop that has no pair mapping and no active tombstone, then persist the pair.

#### Scenario: New raindrop appears in Raindrop
- **WHEN** bidirectional mode is on and a raindrop exists under the root tree with no pair mapping and no tombstone
- **AND** the raindrop is not a Raindrop file or document upload
- **THEN** an Edge bookmark is created with that raindrop's link and title in the corresponding mirrored folder
- **AND** a `bookmarkId ↔ raindropId` pair is persisted
- **AND** the create does not enqueue a duplicate Edge→Raindrop upload

#### Scenario: File uploads are not pulled into Edge
- **WHEN** a raindrop under the root has `type` of `file` or `document`
- **THEN** reconcile does not create an Edge bookmark for it

#### Scenario: Stale pull does not resurrect after delete
- **WHEN** a `pull-create` job is still queued after a tombstone is recorded for that raindrop
- **OR** a delete job for that raindrop is already queued
- **THEN** drain does not create an Edge bookmark for that pull

#### Scenario: Raindrop outside root is ignored
- **WHEN** a raindrop exists outside the configured root collection tree
- **THEN** it is not created in Edge by reconcile

### Requirement: Pull respects Raindrop-to-Edge folder mode
When sync mode is `bidirectional`, Raindrop→Edge ingest SHALL apply the configured Raindrop→Edge folder mode when deciding whether to create Edge folders or skip a raindrop whose mirrored path is incomplete in Edge.

#### Scenario: Existing-only does not enqueue useful work for missing paths
- **WHEN** bidirectional mode is on and folder mode is `existing-only`
- **AND** a raindrop under the root has no pair and no tombstone
- **AND** its mirrored Edge folder path does not fully exist
- **THEN** reconcile/drain does not create an Edge bookmark for it
- **AND** no catch-all Edge folder is used

#### Scenario: Create-as-needed still ensures path on pull
- **WHEN** bidirectional mode is on and folder mode is `create-as-needed`
- **AND** a raindrop is pulled whose Edge path is missing folders
- **THEN** missing folders are created and the bookmark is placed under the mirrored path

#### Scenario: Mirror-all ensures empty collections under root
- **WHEN** bidirectional mode is on and folder mode is `mirror-all`
- **AND** reconcile runs
- **THEN** Edge folders are ensured for Raindrop collections under the root that have no items, subject to exclude rules

### Requirement: User delete propagates Edge to Raindrop
When sync mode is `bidirectional` and the user removes a mapped Edge bookmark, the system SHALL delete the paired raindrop in Raindrop after confirming the mapping, then record a tombstone and clear the pair.

#### Scenario: User deletes mapped bookmark in Edge
- **WHEN** bidirectional mode is on and the user deletes an Edge bookmark that has a pair mapping
- **THEN** the paired raindrop is deleted via the Raindrop API
- **AND** a tombstone is recorded so reconcile does not recreate it
- **AND** the pair mapping is removed

#### Scenario: Unmapped Edge delete
- **WHEN** the user deletes an Edge bookmark with no pair mapping
- **THEN** no Raindrop delete is attempted

### Requirement: User delete propagates Raindrop to Edge
When sync mode is `bidirectional` and reconcile detects that a mapped raindrop no longer exists under the root tree, the system SHALL remove the paired Edge bookmark, record a tombstone, and clear the pair.

#### Scenario: Raindrop deleted remotely
- **WHEN** bidirectional mode is on and a previously mapped raindrop is absent from Raindrop during reconcile
- **THEN** the paired Edge bookmark is removed
- **AND** a tombstone is recorded
- **AND** the pair mapping is removed

### Requirement: Policy-driven local cleanup does not delete Raindrop
When the extension removes an Edge bookmark because of `sync-and-delete` after a confirmed upload, that removal SHALL NOT cause a Raindrop delete, even if sync mode is `bidirectional`.

#### Scenario: Sync-and-delete after upload in bidirectional mode
- **WHEN** bidirectional mode is on and a bookmark's effective policy is `sync-and-delete`
- **AND** its Raindrop create is confirmed and the extension removes the Edge bookmark
- **THEN** the Raindrop copy remains
- **AND** no Raindrop delete job is enqueued for that pair

### Requirement: Raindrop-rich metadata is never overwritten from Edge
Edge→Raindrop writes SHALL only set Edge-owned fields (`link`, `title`, `collection` placement, and optionally `pleaseParse` on create). The system MUST NOT send or clear Raindrop-only fields such as tags, notes, highlights, covers, or excerpts on create or update.

#### Scenario: Create does not supply empty rich fields
- **WHEN** the engine creates a raindrop from an Edge bookmark
- **THEN** the request body includes only Edge-owned fields (and create-time `pleaseParse` if used)
- **AND** it does not set tags, notes, highlights, or cover to empty values

#### Scenario: Update does not clobber rich fields
- **WHEN** the engine updates an existing paired raindrop from Edge changes
- **THEN** only changed Edge-owned fields are written
- **AND** existing Raindrop tags, notes, highlights, covers, and excerpts remain intact

### Requirement: Exclude folders stay untouched in bidirectional mode
Bookmarks and mirrored paths under an effective `exclude` policy SHALL NOT be uploaded, ingested, or delete-propagated while bidirectional mode is on.

#### Scenario: Excluded path skipped on pull
- **WHEN** a raindrop would mirror into an Edge folder whose effective policy is `exclude`
- **THEN** reconcile does not create an Edge bookmark for it

#### Scenario: Excluded path not delete-propagated from Raindrop
- **WHEN** a paired raindrop disappears and the paired Edge bookmark's effective policy is `exclude`
- **THEN** the Edge bookmark is not removed
- **AND** the pair is cleared so reconcile does not keep enqueueing Edge deletes

### Requirement: Allowlist gates Raindrop-only ingest
When the Raindrop collection allowlist is non-empty, Raindrop→Edge ingest for paths that do not already exist in Edge SHALL require allowlist membership (collection or ancestor under root). Allowlisted empty collections SHALL get Edge folders on reconcile subject to exclude. When the allowlist is empty, ingest SHALL follow the configured Raindrop→Edge folder mode only.

#### Scenario: Unallowlisted missing path skipped when allowlist active
- **WHEN** the allowlist is non-empty
- **AND** a raindrop under the root is not allowlisted
- **AND** its Edge path does not fully exist
- **THEN** reconcile/drain does not create an Edge bookmark for it

#### Scenario: Allowlisted empty ensured
- **WHEN** an allowlisted Raindrop collection under the root has no items
- **AND** the path is not excluded
- **THEN** reconcile ensures the corresponding Edge folder path
