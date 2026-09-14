## ADDED Requirements

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
