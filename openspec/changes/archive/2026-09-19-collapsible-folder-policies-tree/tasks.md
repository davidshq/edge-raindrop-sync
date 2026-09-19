## 1. Options markup and styles

- [x] 1.1 Add Folder policies tree toolbar controls: filter input, Expand all, Collapse all (and optional visible-count hint)
- [x] 1.2 Add CSS for twistie, nested `.tree-children`, indent, child-count chip, and toolbar layout (align with mockup / existing options tokens)

## 2. Collapsible tree paint

- [x] 2.1 Refactor `paintTree` / `buildRow` to nested nodes with `.tree-children` groups instead of a flat list
- [x] 2.2 Apply default expansion: depth-0 roots expanded; parents at depth ≥ 1 collapsed
- [x] 2.3 Wire per-folder twistie toggle with `aria-expanded` / leaf spacer
- [x] 2.4 Show descendant-count affordance on parents with nested folders
- [x] 2.5 Preserve expansion across policy-select re-paints via an in-memory `expandedIds` (or equivalent) set

## 3. Toolbar actions and filter

- [x] 3.1 Implement Expand all (open every parent)
- [x] 3.2 Implement Collapse all (restore default expansion rule)
- [x] 3.3 Implement title/path filter that shows matches, expands ancestors, and restores defaults on clear

## 4. Docs and verify

- [x] 4.1 Update README Folder policies description for collapse defaults / Expand–Collapse / filter
- [x] 4.2 Manually verify against sample deep tree (Favorites bar + Other favorites → Hello / Goodbye / Disney) and draft save/discard still work
