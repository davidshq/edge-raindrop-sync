# Edge ↔ Raindrop Sync

A Manifest V3 Microsoft Edge extension that syncs Edge bookmarks with
[Raindrop.io](https://raindrop.io) — so favorites made on a Linux machine (where
Edge no longer syncs bookmarks) are reachable everywhere.

**Sync modes** (Options → Sync mode):

| Mode | Behavior |
| --- | --- |
| **One-way** (default) | Edge → Raindrop only — same as the original extension |
| **Bidirectional** | Also pulls Raindrop → Edge under your root collection, and propagates **user** deletes both ways |

## What it does

- **Live capture** — a new bookmark is queued the moment you create it.
- **Folder mirroring** — your Edge folder tree is recreated as nested Raindrop
  collections under a root collection you name (default `Edge`), preserving both
  Edge roots (`Favorites bar`, `Other favorites`). Path→id cache hits are checked
  against the live Raindrop collection list each drain.
- **Per-folder policy** — each folder is `sync-and-delete` (default),
  `sync-and-keep`, or `exclude`. A folder inherits the nearest ancestor's policy,
  falling back to your global default.
- **Instant local delete** — under `sync-and-delete`, the bookmark is removed
  from Edge the instant Raindrop confirms the copy (never before). In
  bidirectional mode this **does not** delete the Raindrop copy.
- **Bidirectional pull** — when enabled, raindrops under the root appear as Edge
  bookmarks (link/article style items only — uploaded files/documents are skipped);
  deleting on either side removes the pair (with tombstones so items don't
  resurrect). Stale `pull-create` jobs also bail if a tombstone exists or a
  delete for that raindrop is already queued.
- **Metadata ownership** — Edge only writes URL, title, and collection placement.
  Raindrop tags, notes, highlights, covers, and excerpts are never overwritten
  from Edge.
- **Backfill** — a one-shot sweep imports your existing Edge bookmarks.
- **Crash-safe** — a durable queue plus a bidirectional pair map mean offline
  periods, rate limits, and the ephemeral service worker can never lose a
  bookmark or double-upload one. Queue/pair/suppress writes are serialized in
  the worker; drain/reconcile are awaited so the SW is not killed mid-write.

## Setup

1. Get a Raindrop **test token**: Raindrop → Settings → Integrations →
   *Create new app* → open it → **Test token**.
2. Run the API spike (optional but recommended):
   ```bash
   RAINDROP_TOKEN=xxxxx node scripts/spike-raindrop.mjs --cleanup
   ```
3. Load the extension in Edge:
   - Go to `edge://extensions`
   - Enable **Developer mode**
   - **Load unpacked** → select the `src/` folder
4. Open the extension's **Options**, paste your token, click **Test**, set the
   root collection name / sync mode / default policy, then **Save settings**.
5. (Optional) Click **Run backfill now** to import existing Edge bookmarks.
6. (Bidirectional) Click **Reconcile now** (or wait for the heartbeat) to pull
   Raindrop items into Edge.

## Tests

No test framework — Node scripts exercise pure helpers and the sync engine
against in-memory `chrome.storage` / `chrome.bookmarks` mocks (never your real
Edge tree). Run before changing sync, store, queue, or reconcile:

```bash
npm test
# same as:
# node scripts/verify-bidirectional-logic.mjs && node scripts/verify-checklist.mjs
```

Optional live Raindrop smoke (disposable `ERS-Verify-*` collections only):

```bash
RAINDROP_TOKEN=xxxxx npm run test:live
```

Grow scenarios in those scripts when a bug surprises you; don’t add Vitest /
Playwright until packaging for the store or multi-dev CI needs them.

## Layout

```
src/
  manifest.json            MV3 manifest (bookmarks, storage, alarms + Raindrop host)
  background/
    service-worker.js      events + heartbeat + message API (holds no state)
  lib/
    constants.js           policies, sync modes, storage keys, defaults
    store.js               chrome.storage.local (config, pairs, tombstones, status)
    queue.js               durable typed job queue with backoff
    mutex.js               in-process lock for storage RMW (queue/pairs/suppress)
    raindrop.js            Raindrop client (create/list/update/delete)
    collections.js         ensure nested collection path (mirroring)
    bookmarks.js           chrome.bookmarks wrappers + shared mirror path placement
    policy.js              nearest-ancestor policy resolution
    sync.js                drain engine (upload / pull / delete jobs)
    reconcile.js           Raindrop→Edge listing + remote-delete detection
    backfill.js            one-shot existing-bookmark sweep
  options/                 settings, sync mode, folder policies, status + log
  popup/                   compact status + quick actions
scripts/
  verify-bidirectional-logic.mjs  pure helper checks (imports src/lib)
  verify-checklist.mjs            mocked Edge + engine scenarios (optional --live)
  spike-raindrop.mjs              Raindrop API spike (mirroring + bidirectional)
```


## Notes

- **Identity:** the `chrome.bookmarks` API does not expose the on-disk Chromium
  GUID, so the extension keys pairs and policy overrides on the bookmark node
  `id`, which is stable across restarts and survives renames/moves.
- **Auth:** uses a personal test token (no OAuth). Single-user, sideloaded.
- **Deletes in bidirectional mode:** only **user** deletes propagate. Policy
  `sync-and-delete` still means “remove from Edge after upload” and leaves
  Raindrop intact (with all rich metadata).
- **Out of scope for now:** re-syncing title/URL/moves via `onChanged`/`onMoved`,
  OAuth, and publishing to the Edge Add-ons store.
