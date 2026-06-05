# Edge → Raindrop Sync

A Manifest V3 Microsoft Edge extension that **one-way** syncs Edge bookmarks to
[Raindrop.io](https://raindrop.io) as you create them — so favorites made on a
Linux machine (where Edge no longer syncs bookmarks) are reachable everywhere.

There is no reverse sync. Bookmarks flow Edge → Raindrop only.

## What it does

- **Live capture** — a new bookmark is queued the moment you create it.
- **Folder mirroring** — your Edge folder tree is recreated as nested Raindrop
  collections under a root collection you name (default `Edge`), preserving both
  Edge roots (`Favorites bar`, `Other favorites`).
- **Per-folder policy** — each folder is `sync-and-delete` (default),
  `sync-and-keep`, or `exclude`. A folder inherits the nearest ancestor's policy,
  falling back to your global default.
- **Instant local delete** — under `sync-and-delete`, the bookmark is removed
  from Edge the instant Raindrop confirms the copy (never before).
- **Backfill** — a one-shot sweep imports your existing bookmarks.
- **Crash-safe** — a durable queue plus a `bookmark id → raindrop id` map mean
  offline periods, rate limits, and the ephemeral service worker can never lose a
  bookmark or double-upload one.

## Setup

1. Get a Raindrop **test token**: Raindrop → Settings → Integrations →
   *Create new app* → open it → **Test token**.
2. Run the pre-build API spike (optional but recommended) to confirm the
   collection semantics on your account:
   ```bash
   RAINDROP_TOKEN=xxxxx node scripts/spike-raindrop.mjs --cleanup
   ```
3. Load the extension in Edge:
   - Go to `edge://extensions`
   - Enable **Developer mode**
   - **Load unpacked** → select the `src/` folder
4. Open the extension's **Options**, paste your token, click **Test**, set the
   root collection name / default policy, then **Save settings**.
5. (Optional) Click **Run backfill now** to import existing bookmarks.

## Layout

```
src/
  manifest.json            MV3 manifest (bookmarks, storage, alarms + Raindrop host)
  background/
    service-worker.js      events + heartbeat + message API (holds no state)
  lib/
    constants.js           policies, storage keys, defaults, tuning
    store.js               chrome.storage.local wrapper (config, dedup, cache, status)
    queue.js               durable job queue with backoff
    raindrop.js            authenticated Raindrop client (+ Auth/RateLimit errors)
    collections.js         ensure nested collection path (mirroring)
    bookmarks.js           chrome.bookmarks wrappers + path/ancestor resolution
    policy.js              nearest-ancestor policy resolution
    sync.js                the drain (confirm-before-delete engine)
    backfill.js            one-shot existing-bookmark sweep
  options/                 settings, folder-policy editor, status + log
  popup/                   compact status + quick actions
scripts/
  spike-raindrop.mjs       Raindrop API spike (tasks 1.1–1.4)
```

## Notes

- **Identity:** the `chrome.bookmarks` API does not expose the on-disk Chromium
  GUID, so the extension keys dedup and policy overrides on the bookmark node
  `id`, which is stable across restarts and survives renames/moves — the property
  the design wanted from a GUID.
- **Auth:** v1 uses a personal test token (no OAuth). Single-user, sideloaded.
- **Out of scope (v1):** reverse sync, re-syncing moves/renames, OAuth, and
  publishing to the Edge Add-ons store.
