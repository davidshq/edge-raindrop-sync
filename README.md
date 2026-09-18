# Edge ↔ Raindrop Sync

A Manifest V3 Microsoft Edge extension that syncs Edge bookmarks with
[Raindrop.io](https://raindrop.io) — so favorites made on a Linux machine (where
Edge no longer syncs bookmarks) are reachable everywhere.

**Sync modes** (Options → Sync mode):

| Mode | Behavior |
| --- | --- |
| **One-way** (default) | Edge → Raindrop only. Choose whether to **delete from Edge** after upload (offload) or **keep** a local copy. |
| **Bidirectional** | Keeps bookmarks in **both** places: also pulls Raindrop → Edge under your root, and propagates **user** deletes both ways. Global default is keep-both; use folder policies for Exclude or Offload exceptions. |

## What it does

- **Live capture** — a new bookmark is queued the moment you create it.
  Dragging a bookmark (or folder) to another Edge parent re-queues it so Raindrop
  **collection placement** matches the new path; same-folder reorders are ignored.
  Folder moves fan out to every URL bookmark under that tree. Editing a bookmark
  **title or URL** updates those Edge-owned fields on the paired raindrop.
  Renaming an Edge folder renames the mirrored Raindrop collection **in place**
  (same collection id) once that folder has been synced. In bidirectional mode,
  reconcile also applies the reverse for **bookmarks and folders**: Raindrop
  title/URL/collection changes update Edge bookmarks, and renaming a collection
  in Raindrop renames the mapped Edge folder (Edge top roots like Favorites bar
  are never renamed). Recent activity logs
  `Moved: … → …`, `Updated: …`, `Pulled update: …`, `Pulled move: …`,
  `Pulled folder rename: …`, or `Renamed folder: …` as appropriate (creates
  still log `Synced: …` / `Pulled: …`). Moving into an **Exclude** folder skips
  the Raindrop write (any existing Raindrop copy is left where it was).
- **Folder mirroring** — your Edge folder tree is recreated as nested Raindrop
  collections under a root collection you name (default `Edge`), preserving both
  Edge roots (`Favorites bar`, `Other favorites`). Path→id cache hits are checked
  against the live Raindrop collection list each drain.
- **Per-folder policy** — override keep / offload (`sync-and-delete`) / `exclude`
  on any folder. Nearest ancestor wins; otherwise the global default applies
  (one-way: your “After upload” choice; bidirectional: keep-both).
- **Instant local delete** — under offload / `sync-and-delete`, the bookmark is
  removed from Edge the instant Raindrop confirms the copy (never before). That
  cleanup **does not** delete the Raindrop copy, including in bidirectional mode.
  The pair is cleared and an `edge-offload` tombstone is recorded so reconcile
  cannot pull the item back into Edge.
- **Bidirectional pull** — when enabled, raindrops under the root appear as Edge
  bookmarks (link/article style items only — uploaded files/documents are skipped);
  deleting on either side removes the pair (with tombstones so items don't
  resurrect). **Folder deletes** walk Chromium's single `onRemoved` payload
  (`removeInfo.node`) so every paired child still propagates to Raindrop.
  Stale `pull-create` jobs also bail if a tombstone exists or a
  delete for that raindrop is already queued. **Raindrop → Edge folders**
  (Options, bidirectional only) chooses whether missing Edge folders are created
  on pull (`create-as-needed`, default), skipped entirely (`existing-only`, no
  catch-all), or empty Raindrop collections are mirrored too (`mirror-all`).
  Under **Folder policies**, expand **Choose Raindrop-only collections to sync**
  to opt in Raindrop folders that are not fully in Edge (entire Raindrop account,
  not only under the sync root). An empty allowlist leaves the three folder modes
  unchanged under the sync root; a non-empty allowlist limits Raindrop-only
  creates to checked collections (Edge-existing paths still sync). Outside-root
  picks land under Other favorites / Raindrop. Drops back into those Edge folders
  upload into the matching account-level Raindrop collection (not under the sync
  root). Use **Select all** to opt in every listed collection, or **Clear
  selection** then **Save folder policies** to leave selective mode. Allowlist
  entries are dropped only when the Raindrop collection is gone — not when
  folders finish mirroring.
- **Metadata ownership** — Edge only writes URL, title, and collection placement.
  Raindrop tags, notes, highlights, covers, and excerpts are never overwritten
  from Edge.
- **Backfill** — a one-shot sweep imports your existing Edge bookmarks.
- **Crash-safe** — a durable queue plus a bidirectional pair map mean offline
  periods, rate limits, and the ephemeral service worker can never lose a
  bookmark or double-upload one. Queue/pair/suppress writes are serialized in
  the worker; drain/reconcile are awaited so the SW is not killed mid-write.
  Raindrop work pauses globally on HTTP 429 *or* when `X-RateLimit-Remaining`
  runs low, with per-tick caps on list pages, queue jobs, and delete-confirm
  GETs so a large library cannot stampede the API. The 1-minute heartbeat still
  drains the queue; full bidirectional reconcile cools down for 15 minutes after
  a completed cycle (manual **Reconcile now** always runs).
- **Activity log** — Options → Status shows the newest **500** lines from
  `chrome.storage.local`. Enable **Keep long-term activity log** (Save settings)
  to also append into an IndexedDB archive (soft-capped at 50 000). Export or
  clear the archive from Status; turning the setting off stops new writes but
  does not wipe existing archive data.

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
   In bidirectional mode, set **Raindrop → Edge folders** if you want Edge to
   stay folder-source-of-truth (`existing-only`) or to mirror empty Raindrop
   collections (`mirror-all`). Folder policy overrides and the Raindrop-only
   allowlist are edited as a draft — use **Save folder policies** when you want
   them to take effect (including child folders via inheritance).
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

## Lint & format

ESLint (flat config) + Prettier. Extension code uses `chrome` / WebExtension
globals; `scripts/` is Node (verify scripts assign `globalThis.chrome` for mocks).

```bash
npm run lint          # ESLint
npm run format        # Prettier write
npm run format:check  # Prettier check (CI-friendly)
```

Config: `eslint.config.js`, `.prettierrc.json`, `.editorconfig`.

## Layout

```
src/
  manifest.json            MV3 manifest (bookmarks, storage, alarms + Raindrop host)
  background/
    service-worker.js      events + heartbeat + message API (holds no state)
  lib/
    constants.js           policies, sync modes, MSG, storage keys, defaults
    store.js               chrome.storage.local (config, pairs, tombstones, status)
    log-archive.js         opt-in IndexedDB long-term activity log
    queue.js               durable typed job queue with backoff
    mutex.js               in-process lock for storage RMW (queue/pairs/suppress)
    raindrop.js            Raindrop client (create/list/update/delete)
    collections.js         collection index helpers + nested path mirroring
    bookmarks.js           chrome.bookmarks wrappers + shared mirror path placement
    policy.js              nearest-ancestor policy resolution
    allowlist.js           Raindrop-only collection allowlist gate
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
- **Deletes in bidirectional mode:** only **user** deletes propagate (including
  every paired bookmark under a deleted folder via `removeInfo.node`). Folder
  **Offload** (`sync-and-delete`) still means “remove from Edge after upload”
  and leaves Raindrop intact (with all rich metadata), clearing the pair and
  writing an `edge-offload` tombstone so pull cannot undo it. The options UI
  does not offer offload as the bidirectional *global* default — that mode
  keeps both sides by default. Stale stored `sync-and-delete` under
  bidirectional is coerced to keep-both on read/save so the engine matches the UI.
- **Out of scope for now:** OAuth, and publishing to the Edge Add-ons store.
