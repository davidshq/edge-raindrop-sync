## 1. Allowlist storage

- [x] 1.1 Add allowlist config/storage shape `{ [collectionId]: { path } }` default `{}`; draft helpers alongside folder overrides
- [x] 1.2 Persist allowlist on Save folder policies; Discard restores saved allowlist draft

## 2. Membership helpers

- [x] 2.1 `isCollectionAllowed` (id or ancestor under root)
- [x] 2.2 Pull gate: if allowlist non-empty → allowed OR `mirrorPathExists`; if allowlist empty → existing folder-mode behavior

## 3. Engine

- [x] 3.1 Reconcile/drain: skip Raindrop-only missing paths when allowlist active and not allowed
- [x] 3.2 Ensure Edge folders for allowlisted (including empty) collections; honor exclude
- [x] 3.3 Empty allowlist: leave existing-only / create-as-needed / mirror-all unchanged

## 4. Options UI

- [x] 4.1 Add collapsed expandable under Folder policies: “Choose Raindrop-only collections to sync” (bidirectional only)
- [x] 4.2 List Raindrop-only/empty collections with checkboxes, badges, Refresh; wire draft dirty state into Save/Discard
- [x] 4.3 Do not add a Selected mode to the Settings dropdown; help text points Raindrop-only choice to this section

## 5. Docs and verification

- [x] 5.1 Update README for expandable allowlist + empty-allowlist preserves modes
- [x] 5.2 Verify: empty allowlist unchanged; non-empty skips unchecked; allowlisted pull/empty; Edge bypass; draft discard
- [x] 5.3 Run `npm test`
