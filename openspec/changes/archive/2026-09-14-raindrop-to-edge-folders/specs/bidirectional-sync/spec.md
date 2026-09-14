## ADDED Requirements

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
