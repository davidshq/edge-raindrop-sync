## 1. Markup and styles

- [x] 1.1 Replace the Folder policies bottom `.row` with a sticky `.draft-bar` (Apply folder policies / Discard / status)
- [x] 1.2 Add CSS for sticky draft bar (elevated contrast, compact height, panel bottom padding so list rows clear the bar)

## 2. Wire Apply naming

- [x] 2.1 Rename control ids/handlers to `applyPolicies` (or equivalent) and update status flash to “Applied.”
- [x] 2.2 Update Folder policies / Raindrop-only help copy from Save → Apply

## 3. Docs and verify

- [x] 3.1 Update README Folder policies Apply wording
- [x] 3.2 Sync main `extension-config` spec wording with the delta (apply + sticky bar)
- [x] 3.3 Manually verify: dirty enables bar actions; scroll keeps bar visible; Discard/Apply still persist correctly
