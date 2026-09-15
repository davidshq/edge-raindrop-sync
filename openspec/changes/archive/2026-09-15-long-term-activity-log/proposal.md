## Why

The options “Recent activity” list is a capped ring buffer in `chrome.storage.local` (currently 200 entries). Older lines are discarded with no way to recover them, which makes debugging intermittent sync issues and reviewing longer history difficult. Operators want a larger recent window plus an opt-in long-term archive with export and clear.

## What Changes

- Raise the in-storage recent activity cap from 200 to **500** entries (still shown in Settings → Status).
- Add an **opt-in** long-term activity archive backed by **IndexedDB**, written whenever a log line is appended (when enabled).
- Add Settings controls to **enable/disable** long-term retention, **export** the archive (JSON download), and **clear** it (with confirmation).
- Surface approximate archive size/count in the status UI when long-term retention is on.

## Capabilities

### New Capabilities
- `activity-log-archive`: Opt-in IndexedDB long-term activity retention with export and clear from the options UI.

### Modified Capabilities
- `extension-config`: Recent activity display retains more entries (500); status section gains long-term log controls.

## Impact

- `src/lib/constants.js` — `LOG_LIMIT`, optional archive caps/config defaults, new message types
- `src/lib/store.js` — `appendLog` dual-writes when archive enabled; config flag
- New `src/lib/log-archive.js` (or similar) — IndexedDB open/append/export/clear/count
- `src/background/service-worker.js` — message handlers for export/clear/stats
- `src/options/options.{html,js,css}` — toggle, export, clear, count hint
- `README.md` — document recent vs long-term log behavior
- Verify scripts if they assert `LOG_LIMIT` or log shape
