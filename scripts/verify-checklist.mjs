#!/usr/bin/env node
/**
 * Isolated checklist verification for bidirectional-sync (tasks 6.2–6.5).
 *
 * SAFETY:
 * - Edge bookmarks are 100% in-memory mocks — never touches the real Edge tree.
 * - Raindrop calls (if RAINDROP_TOKEN / .tmp/raindrop_token is set) only create and
 *   delete items under a disposable root collection named ERS-Verify-<timestamp>.
 * - Without a token, Raindrop is also mocked in-memory (still validates engine logic).
 *
 * Usage:
 *   node scripts/verify-checklist.mjs
 *   RAINDROP_TOKEN=… node scripts/verify-checklist.mjs --live
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { RAINDROP_API } from "../src/lib/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LIVE = process.argv.includes("--live");

function loadToken() {
  if (process.env.RAINDROP_TOKEN) return process.env.RAINDROP_TOKEN.trim();
  const p = path.join(ROOT, ".tmp", "raindrop_token");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  return "";
}

const TOKEN = loadToken();
const USE_LIVE = LIVE && !!TOKEN;

/* -------------------------------------------------------------------------- */
/* In-memory chrome.storage + chrome.bookmarks mock (disposable Edge tree)    */
/* -------------------------------------------------------------------------- */

const storage = new Map();
let bmSeq = 100;
const bookmarks = new Map(); // id -> node

function bmNode(partial) {
  const id = String(partial.id ?? ++bmSeq);
  const node = {
    id,
    title: partial.title ?? "",
    url: partial.url,
    parentId: partial.parentId,
    children: partial.children,
  };
  bookmarks.set(id, node);
  return node;
}

// Seed only a disposable Edge profile: Favorites bar + Other favorites, empty.
function seedEdge() {
  bookmarks.clear();
  bmSeq = 100;
  bmNode({ id: "0", title: "", parentId: undefined, children: undefined });
  bmNode({ id: "1", title: "Favorites bar", parentId: "0" });
  bmNode({ id: "2", title: "Other favorites", parentId: "0" });
}

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") {
          if (!storage.has(key)) return {};
          return { [key]: structuredClone(storage.get(key)) };
        }
        const out = {};
        for (const k of Object.keys(key)) {
          if (storage.has(k)) out[k] = structuredClone(storage.get(k));
        }
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) storage.set(k, structuredClone(v));
      },
    },
  },
  bookmarks: {
    async get(id) {
      const n = bookmarks.get(String(id));
      if (!n) throw new Error("Bookmark not found");
      return [{ ...n }];
    },
    async getChildren(id) {
      return [...bookmarks.values()]
        .filter((n) => n.parentId === String(id))
        .map((n) => ({ ...n }));
    },
    async getTree() {
      const root = { ...bookmarks.get("0"), children: [] };
      const attach = (parent) => {
        parent.children = [...bookmarks.values()]
          .filter((n) => n.parentId === parent.id)
          .map((n) => {
            const copy = { ...n };
            if (!copy.url) attach(copy);
            return copy;
          });
      };
      attach(root);
      return [root];
    },
    async create({ parentId, title, url }) {
      return bmNode({ parentId: String(parentId), title, url });
    },
    async remove(id) {
      const n = bookmarks.get(String(id));
      if (!n) throw new Error("Bookmark not found");
      if (!n.url) {
        const kids = [...bookmarks.values()].filter((c) => c.parentId === String(id));
        if (kids.length) throw new Error("Folder not empty");
      }
      bookmarks.delete(String(id));
    },
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
  },
};

/* -------------------------------------------------------------------------- */
/* Optional live Raindrop client scoped to ERS-Verify-* only                  */
/* -------------------------------------------------------------------------- */

const API = RAINDROP_API;
const createdLive = { collections: [], raindrops: [] };
let verifyRootTitle = "";

async function liveCall(method, pathName, body) {
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${pathName} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function liveCleanup() {
  for (const id of [...createdLive.raindrops].reverse()) {
    try {
      await liveCall("DELETE", `/raindrop/${id}`);
      await liveCall("DELETE", `/raindrop/${id}`); // permanent from trash
    } catch {
      /* ignore */
    }
  }
  for (const id of [...createdLive.collections].reverse()) {
    try {
      await liveCall("DELETE", `/collection/${id}`);
    } catch {
      /* ignore */
    }
  }
  createdLive.raindrops = [];
  createdLive.collections = [];
}

/* -------------------------------------------------------------------------- */
/* In-memory Raindrop mock (used when not --live)                             */
/* -------------------------------------------------------------------------- */

function makeMockRaindrop() {
  let seq = 1;
  const collections = new Map(); // id -> { _id, title, parent }
  const raindrops = new Map(); // id -> item
  const trash = new Map();

  return {
    async getUser() {
      return { _id: 1, fullName: "mock" };
    },
    async getRootCollections() {
      return [...collections.values()].filter((c) => !c.parent?.$id);
    },
    async getChildCollections() {
      return [...collections.values()].filter((c) => c.parent?.$id);
    },
    async createCollection(title, parentId) {
      const _id = seq++;
      const item = {
        _id,
        title,
        parent: parentId != null ? { $id: parentId } : null,
      };
      collections.set(_id, item);
      return item;
    },
    async createRaindrop({ link, title, collectionId }) {
      const _id = seq++;
      const item = {
        _id,
        link,
        title: title || link,
        collection: { $id: collectionId },
        tags: [],
        note: "",
      };
      raindrops.set(_id, item);
      return item;
    },
    async listRaindrops(collectionId, { nested = false } = {}) {
      const under = new Set();
      const walk = (id) => {
        under.add(Number(id));
        for (const c of collections.values()) {
          if (c.parent?.$id === Number(id) || String(c.parent?.$id) === String(id)) walk(c._id);
        }
      };
      if (nested) walk(collectionId);
      else under.add(Number(collectionId));
      const items = [...raindrops.values()].filter((r) => under.has(Number(r.collection?.$id)));
      return { items, count: items.length };
    },
    async getRaindrop(id) {
      // Live items only — trashed ids are "gone" for delete-detection confirms.
      return raindrops.get(Number(id)) || null;
    },
    async updateRaindrop(id, patch) {
      const item = raindrops.get(Number(id));
      if (!item) throw new Error("missing");
      if (patch.link != null) item.link = patch.link;
      if (patch.title != null) item.title = patch.title;
      if (patch.collectionId != null) item.collection = { $id: patch.collectionId };
      // intentionally never clear tags/note unless provided — engine won't send them
      return item;
    },
    async deleteRaindrop(id) {
      const item = raindrops.get(Number(id));
      if (item) {
        raindrops.delete(Number(id));
        trash.set(Number(id), item);
      }
    },
    // test helpers
    _collections: collections,
    _raindrops: raindrops,
    _trash: trash,
    _seedRich(collectionId, { link, title, tags, note }) {
      const _id = seq++;
      const item = {
        _id,
        link,
        title,
        collection: { $id: collectionId },
        tags: tags || [],
        note: note || "",
      };
      raindrops.set(_id, item);
      return item;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Wire real modules against mocks                                            */
/* -------------------------------------------------------------------------- */

async function importEngine() {
  const base = pathToFileURL(path.join(ROOT, "src/lib")).href;
  const constants = await import(`${base}/constants.js`);
  const store = await import(`${base}/store.js`);
  const queue = await import(`${base}/queue.js`);
  const sync = await import(`${base}/sync.js`);
  const reconcile = await import(`${base}/reconcile.js`);
  const raindropMod = await import(`${base}/raindrop.js`);
  return { constants, store, queue, sync, reconcile, raindropMod };
}

function patchClient(raindropMod, clientImpl) {
  // Replace RaindropClient constructor used by sync/reconcile by monkeypatching prototype methods
  const Proto = raindropMod.RaindropClient.prototype;
  for (const key of Object.keys(clientImpl)) {
    if (key.startsWith("_")) continue;
    Proto[key] = function (...args) {
      return clientImpl[key](...args);
    };
  }
}

async function resetAll(store) {
  storage.clear();
  seedEdge();
  await store.ensurePairsMigrated();
}

function edgeUrls() {
  return [...bookmarks.values()].filter((n) => n.url).map((n) => n.url);
}

function findEdgeByUrl(url) {
  return [...bookmarks.values()].find((n) => n.url === url);
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

async function scenario62_oneWay() {
  console.log("\n== 6.2 One-way mode unchanged ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE, JOB } = eng.constants;
  await resetAll(eng.store);

  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  await eng.store.setConfig({
    token: "mock",
    rootName: "ERS-Verify-OneWay",
    syncMode: SYNC_MODE.ONE_WAY,
    defaultPolicy: POLICY.SYNC_KEEP,
  });

  // Create disposable Edge bookmark under Favorites bar
  const folder = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Verify-Folder",
  });
  const bm = await chrome.bookmarks.create({
    parentId: folder.id,
    title: "ERS one-way",
    url: "https://example.com/ers-verify-oneway",
  });

  await eng.queue.enqueue(bm.id);
  await eng.sync.drain();

  assert.equal(mock._raindrops.size, 1, "uploaded to Raindrop");
  assert.ok(await eng.store.hasSynced(bm.id), "paired");
  assert.ok(findEdgeByUrl("https://example.com/ers-verify-oneway"), "edge kept (sync-and-keep)");

  // Bidirectional jobs must no-op / be dropped in one-way
  await eng.queue.enqueueJob({
    id: "pull-999",
    kind: JOB.PULL_CREATE,
    raindropId: "999",
    link: "https://example.com/should-not-pull",
    title: "nope",
    relativeSegments: ["Favorites bar", "ERS-Verify-Folder"],
  });
  await eng.sync.drain();
  assert.equal(
    edgeUrls().includes("https://example.com/should-not-pull"),
    false,
    "one-way does not pull"
  );

  const before = mock._raindrops.size;
  await eng.sync.handleBookmarkRemoved(bm.id, { parentId: folder.id });
  await eng.sync.drain();
  assert.equal(mock._raindrops.size, before, "one-way does not propagate Edge delete");

  // Reconcile should be a no-op
  const r = await eng.reconcile.reconcile();
  assert.equal(r.enqueued, 0);
  console.log("  ✔ one-way upload works; no pull; no delete propagation");
}

async function scenario63_bidirectional() {
  console.log("\n== 6.3 Bidirectional pull + deletes + tombstone ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE } = eng.constants;
  await resetAll(eng.store);
  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  const rootName = "ERS-Verify-Bi";
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
  });

  const root = await mock.createCollection(rootName, null);
  const bar = await mock.createCollection("Favorites bar", root._id);
  const folder = await mock.createCollection("ERS-Verify-Folder", bar._id);

  // Raindrop-origin item → should pull into Edge
  const remote = mock._seedRich(folder._id, {
    link: "https://example.com/ers-verify-pull",
    title: "ERS pull me",
    tags: ["keep-me"],
    note: "rich-note",
  });

  await eng.reconcile.reconcile();
  await eng.sync.drain();
  const pulled = findEdgeByUrl("https://example.com/ers-verify-pull");
  assert.ok(pulled, "pulled into Edge");
  assert.equal(await eng.store.getBookmarkIdForRaindrop(String(remote._id)), pulled.id);

  // Edge user delete → Raindrop delete + tombstone
  await chrome.bookmarks.remove(pulled.id);
  await eng.sync.handleBookmarkRemoved(pulled.id, { parentId: pulled.parentId });
  await eng.sync.drain();
  assert.equal(mock._raindrops.has(remote._id), false, "raindrop deleted");
  assert.equal(mock._trash.has(remote._id), true, "moved to trash mock");
  assert.equal(await eng.store.hasTombstone(String(remote._id)), true, "tombstone set");

  // Resurrect attempt: put raindrop back in library; reconcile must NOT recreate
  mock._raindrops.set(remote._id, remote);
  mock._trash.delete(remote._id);
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-pull"),
    false,
    "tombstone blocks recreate"
  );

  // Stale pull-create already on the queue must also honor the tombstone
  const { JOB } = eng.constants;
  await eng.queue.enqueueJob({
    id: `pull-${remote._id}-stale`,
    kind: JOB.PULL_CREATE,
    raindropId: String(remote._id),
    link: "https://example.com/ers-verify-pull",
    title: "ERS pull me",
    relativeSegments: ["Favorites bar", "ERS-Verify-Folder"],
  });
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-pull"),
    false,
    "stale pull-create honors tombstone"
  );

  // Pending delete-raindrop cancels a competing pull-create
  const pendingRid = "pending-del-1";
  await eng.queue.enqueueJob({
    id: `pull-${pendingRid}`,
    kind: JOB.PULL_CREATE,
    raindropId: pendingRid,
    link: "https://example.com/ers-verify-pending-del",
    title: "should not pull",
    relativeSegments: ["Favorites bar", "ERS-Verify-Folder"],
  });
  await eng.queue.enqueueJob({
    id: `dr-${pendingRid}`,
    kind: JOB.DELETE_RAINDROP,
    raindropId: pendingRid,
    bookmarkId: "gone",
  });
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-pending-del"),
    false,
    "pending delete blocks pull-create"
  );
  assert.equal(await eng.store.hasTombstone(pendingRid), true, "delete job still ran");

  // Fresh pair for remote-delete → Edge delete
  await eng.store.clearTombstone(String(remote._id));
  const remote2 = mock._seedRich(folder._id, {
    link: "https://example.com/ers-verify-remote-del",
    title: "ERS remote del",
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  const edge2 = findEdgeByUrl("https://example.com/ers-verify-remote-del");
  assert.ok(edge2, "second pull");

  await mock.deleteRaindrop(remote2._id);
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.equal(!!findEdgeByUrl("https://example.com/ers-verify-remote-del"), false, "Edge deleted");
  assert.equal(await eng.store.hasTombstone(String(remote2._id)), true);

  console.log("  ✔ pull, deletes, tombstone, stale/pending pull guards");
}

async function scenario64_syncAndDelete() {
  console.log("\n== 6.4 sync-and-delete in bidirectional leaves Raindrop + tags ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE } = eng.constants;
  await resetAll(eng.store);
  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  const rootName = "ERS-Verify-SAD";
  // Global default must stay keep-both in bidirectional; offload via folder override.
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_DELETE, // coerced to SYNC_KEEP on write
  });
  const cfg = await eng.store.getConfig();
  assert.equal(cfg.defaultPolicy, POLICY.SYNC_KEEP, "bidirectional coerces global keep-both");

  // Pre-create root so upload path works
  await mock.createCollection(rootName, null);

  const folder = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Verify-SAD-Folder",
  });
  await eng.store.setOverride(
    folder.id,
    POLICY.SYNC_DELETE,
    "Favorites bar / ERS-Verify-SAD-Folder"
  );
  const bm = await chrome.bookmarks.create({
    parentId: folder.id,
    title: "ERS sad",
    url: "https://example.com/ers-verify-sad",
  });

  await eng.queue.enqueue(bm.id);
  await eng.sync.drain();

  assert.equal(mock._raindrops.size, 1, "raindrop exists");
  const only = [...mock._raindrops.values()][0];
  // Simulate user enriching in Raindrop after create
  only.tags = ["user-tag"];
  only.note = "user-note";

  assert.equal(!!findEdgeByUrl("https://example.com/ers-verify-sad"), false, "Edge removed");
  assert.ok(
    (await eng.store.getRaindropId(bm.id)) ||
      (await eng.store.getBookmarkIdForRaindrop(String(only._id))),
    "pair retained"
  );
  // Policy remove must not delete Raindrop
  assert.equal(only.tags[0], "user-tag");
  assert.equal(only.note, "user-note");
  assert.equal(mock._trash.size, 0, "not trashed by policy delete");

  // Stale storage heal: raw sync-and-delete under bidirectional is fixed on read
  await chrome.storage.local.set({
    config: {
      token: "mock",
      rootName,
      syncMode: SYNC_MODE.BIDIRECTIONAL,
      defaultPolicy: POLICY.SYNC_DELETE,
      pruneEmpty: false,
    },
  });
  const healed = await eng.store.getConfig();
  assert.equal(healed.defaultPolicy, POLICY.SYNC_KEEP, "getConfig heals stale offload");

  console.log("  ✔ Edge gone via folder offload; Raindrop kept; stale global coerced");
}

async function scenario65_exclude() {
  console.log("\n== 6.5 exclude blocks upload, ingest, delete propagation ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE } = eng.constants;
  await resetAll(eng.store);
  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  const rootName = "ERS-Verify-Ex";
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
  });

  const excl = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Verify-Exclude",
  });
  await eng.store.setOverride(excl.id, POLICY.EXCLUDE, "Favorites bar / ERS-Verify-Exclude");

  const bm = await chrome.bookmarks.create({
    parentId: excl.id,
    title: "secret",
    url: "https://example.com/ers-verify-exclude",
  });
  await eng.queue.enqueue(bm.id);
  await eng.sync.drain();
  assert.equal(mock._raindrops.size, 0, "exclude not uploaded");

  const root = await mock.createCollection(rootName, null);
  const bar = await mock.createCollection("Favorites bar", root._id);
  const remoteFolder = await mock.createCollection("ERS-Verify-Exclude", bar._id);
  mock._seedRich(remoteFolder._id, {
    link: "https://example.com/ers-verify-exclude-remote",
    title: "should not ingest",
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-exclude-remote"),
    false,
    "exclude path not ingested"
  );

  // Even if somehow paired, delete under exclude shouldn't be the normal path;
  // engine relies on exclude never uploading — verify remove of unpaired does nothing.
  const before = mock._raindrops.size;
  await chrome.bookmarks.remove(bm.id);
  await eng.sync.handleBookmarkRemoved(bm.id, { parentId: excl.id });
  await eng.sync.drain();
  assert.equal(mock._raindrops.size, before, "no raindrop delete for unpaired exclude bookmark");

  // Synced first, then folder marked exclude — delete must not propagate.
  const keepFolder = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Verify-WasKeep",
  });
  const laterExcl = await chrome.bookmarks.create({
    parentId: keepFolder.id,
    title: "ERS-Verify-LaterExclude",
    url: "https://example.com/ers-verify-later-exclude",
  });
  await eng.queue.enqueue(laterExcl.id);
  await eng.sync.drain();
  assert.equal(mock._raindrops.size, before + 1, "uploaded before exclude");
  await eng.store.setOverride(keepFolder.id, POLICY.EXCLUDE, "Favorites bar / ERS-Verify-WasKeep");
  const rid = await eng.store.getRaindropId(laterExcl.id);
  assert.ok(rid);
  await chrome.bookmarks.remove(laterExcl.id);
  await eng.sync.handleBookmarkRemoved(laterExcl.id, { parentId: keepFolder.id });
  await eng.sync.drain();
  assert.equal(
    mock._raindrops.has(Number(rid)),
    true,
    "mapped exclude delete does not hit Raindrop"
  );

  // Synced, then exclude — remote Raindrop delete must not remove Edge.
  const keepRemote = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Verify-WasKeep-Remote",
  });
  const laterExclRemote = await chrome.bookmarks.create({
    parentId: keepRemote.id,
    title: "ERS-Verify-LaterExclude-Remote",
    url: "https://example.com/ers-verify-later-exclude-remote",
  });
  await eng.queue.enqueue(laterExclRemote.id);
  await eng.sync.drain();
  const ridRemote = await eng.store.getRaindropId(laterExclRemote.id);
  assert.ok(ridRemote, "paired before exclude");
  await eng.store.setOverride(
    keepRemote.id,
    POLICY.EXCLUDE,
    "Favorites bar / ERS-Verify-WasKeep-Remote"
  );
  await mock.deleteRaindrop(Number(ridRemote));
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-later-exclude-remote"),
    "excluded Edge bookmark kept after remote Raindrop delete"
  );
  assert.equal(
    await eng.store.getRaindropId(laterExclRemote.id),
    null,
    "pair cleared so DELETE_EDGE does not thrash"
  );
  assert.equal(
    await eng.store.hasTombstone(String(ridRemote)),
    true,
    "tombstone recorded for absent raindrop"
  );

  console.log(
    "  ✔ exclude blocks upload + ingest; Edge↔Raindrop deletes do not propagate either way"
  );
}

async function scenario66_raindropFolderModes() {
  console.log("\n== 6.6 Raindrop → Edge folder modes ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE, RAINDROP_FOLDER_MODE, JOB } = eng.constants;
  await resetAll(eng.store);
  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  const rootName = "ERS-Verify-Folders";
  const root = await mock.createCollection(rootName, null);
  const research = await mock.createCollection("Research", root._id);
  const papers = await mock.createCollection("Papers", research._id);
  // Empty sibling collection — only mirror-all should create it in Edge.
  await mock.createCollection("Inbox", research._id);

  mock._seedRich(papers._id, {
    link: "https://example.com/ers-verify-papers",
    title: "ERS papers",
  });

  // --- existing-only: missing path → skip (no catch-all, no folders) ---
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-papers"),
    false,
    "existing-only skips missing path"
  );
  assert.equal(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Research"),
    false,
    "existing-only creates no Research folder"
  );
  assert.equal(
    [...bookmarks.values()].some((n) => !n.url && n.title === "_Unfiled"),
    false,
    "no catch-all / _Unfiled"
  );

  // Stale pull job still dropped at drain without creating folders
  await eng.queue.enqueueJob({
    id: "pull-stale-existing",
    kind: JOB.PULL_CREATE,
    raindropId: "stale-ex",
    link: "https://example.com/ers-verify-stale-existing",
    title: "stale",
    relativeSegments: ["Research", "Papers"],
  });
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-stale-existing"),
    false,
    "drain existing-only drops incomplete path"
  );

  // --- create-as-needed: folders + bookmark; empty Inbox still absent ---
  await resetAll(eng.store);
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  });
  // Mock Raindrop tree from earlier in this scenario is reused.
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  const pulled = findEdgeByUrl("https://example.com/ers-verify-papers");
  assert.ok(pulled, "create-as-needed pulled bookmark");
  assert.ok(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Research"),
    "create-as-needed created Research"
  );
  assert.ok(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Papers"),
    "create-as-needed created Papers"
  );
  assert.equal(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Inbox"),
    false,
    "create-as-needed does not mirror empty Inbox"
  );

  // --- mirror-all: empty Inbox folder appears ---
  await resetAll(eng.store);
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.MIRROR_ALL,
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(findEdgeByUrl("https://example.com/ers-verify-papers"), "mirror-all still pulls");
  assert.ok(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Inbox"),
    "mirror-all ensures empty Inbox folder"
  );

  console.log("  ✔ existing-only skip; create-as-needed; mirror-all empty folders");
}

async function scenario67_raindropFolderAllowlist() {
  console.log("\n== 6.7 Raindrop folder allowlist ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE, RAINDROP_FOLDER_MODE } = eng.constants;
  await resetAll(eng.store);
  const mock = makeMockRaindrop();
  patchClient(eng.raindropMod, mock);

  const rootName = "ERS-Verify-Allowlist";
  const root = await mock.createCollection(rootName, null);
  const research = await mock.createCollection("Research", root._id);
  const papers = await mock.createCollection("Papers", research._id);
  await mock.createCollection("Inbox", research._id);
  const other = await mock.createCollection("Other", root._id);

  mock._seedRich(papers._id, {
    link: "https://example.com/ers-verify-allow-papers",
    title: "ERS allow papers",
  });
  mock._seedRich(other._id, {
    link: "https://example.com/ers-verify-allow-other",
    title: "ERS allow other",
  });

  // Non-empty allowlist: only Research (covers Papers); Other skipped; Inbox ensured.
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    raindropFolderAllowlist: {
      [String(research._id)]: { path: "Research" },
    },
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();

  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-allow-papers"),
    "allowlisted subtree pulls"
  );
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-allow-other"),
    false,
    "unchecked Raindrop-only skipped"
  );
  assert.ok(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Inbox"),
    "allowlist ensures empty Inbox under Research"
  );
  assert.equal(
    [...bookmarks.values()].some((n) => !n.url && n.title === "Other"),
    false,
    "unchecked empty Other not created"
  );

  // Edge-existing bypass: put Other on Edge, keep allowlist without Other.
  await resetAll(eng.store);
  const otherRoot = await chrome.bookmarks.create({
    parentId: "2",
    title: rootName,
  });
  await chrome.bookmarks.create({
    parentId: otherRoot.id,
    title: "Other",
  });

  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    raindropFolderAllowlist: {
      [String(research._id)]: { path: "Research" },
    },
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-allow-other"),
    "Edge-existing bypasses allowlist"
  );
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-allow-papers"),
    "allowlisted still pulls under existing-only"
  );

  // Empty allowlist preserves create-as-needed (Other path missing → still creates).
  await resetAll(eng.store);
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    raindropFolderAllowlist: {},
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-allow-other"),
    "empty allowlist leaves create-as-needed unchanged"
  );

  // Prune: missing Raindrop ids drop; fully mirrored allowlist ids stay
  // (Clear selection exits selective mode — reconcile must not undo opt-in).
  await resetAll(eng.store);
  const folderRoot = await chrome.bookmarks.create({
    parentId: "2",
    title: rootName,
  });
  const researchEdge = await chrome.bookmarks.create({
    parentId: folderRoot.id,
    title: "Research",
  });
  await chrome.bookmarks.create({ parentId: researchEdge.id, title: "Papers" });
  await chrome.bookmarks.create({ parentId: researchEdge.id, title: "Inbox" });
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    raindropFolderAllowlist: {
      [String(research._id)]: { path: "Research" },
      99999: { path: "Deleted" },
    },
  });
  await eng.reconcile.reconcile();
  const afterPrune = await eng.store.getConfig();
  assert.deepEqual(
    afterPrune.raindropFolderAllowlist,
    { [String(research._id)]: { path: "Research" } },
    "reconcile keeps live allowlist ids; drops missing only"
  );
  // Selective mode still active: Other (unchecked) must not pull.
  await eng.sync.drain();
  assert.equal(
    !!findEdgeByUrl("https://example.com/ers-verify-allow-other"),
    false,
    "after prune of missing ids, selective mode still skips unchecked"
  );

  // Legacy pull job without collectionId still resolves under allowlist.
  await resetAll(eng.store);
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    raindropFolderAllowlist: {
      [String(research._id)]: { path: "Research" },
    },
  });
  const { JOB } = eng.constants;
  await eng.queue.enqueueJob({
    id: "pull-legacy-no-col",
    kind: JOB.PULL_CREATE,
    raindropId: "legacy-col",
    link: "https://example.com/ers-verify-legacy-col",
    title: "legacy",
    relativeSegments: ["Research", "Papers"],
    // intentionally no collectionId
  });
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-legacy-col"),
    "legacy pull resolves collectionId from path"
  );

  // Outside-root allowlist: pull once, second reconcile must not DELETE_EDGE.
  await resetAll(eng.store);
  const indie = await mock.createCollection("IndieOutside", null);
  const indieItem = mock._seedRich(indie._id, {
    link: "https://example.com/ers-verify-indie-outside",
    title: "ERS indie outside",
  });
  await eng.store.setConfig({
    token: "mock",
    rootName,
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
    raindropFolderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    raindropFolderAllowlist: {
      [String(indie._id)]: { path: "IndieOutside" },
    },
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  const pulledIndie = findEdgeByUrl("https://example.com/ers-verify-indie-outside");
  assert.ok(pulledIndie, "outside-root allowlisted pulls");
  const indieFolder = [...bookmarks.values()].find(
    (n) => !n.url && n.title === "IndieOutside",
  );
  assert.ok(indieFolder, "outside-root IndieOutside folder created");
  const raindropContainer = bookmarks.get(String(indieFolder.parentId));
  assert.equal(
    raindropContainer?.title,
    "Raindrop",
    "outside-root folder under Other favorites / Raindrop",
  );
  assert.equal(
    raindropContainer?.parentId,
    "2",
    "Raindrop container lives under Other favorites",
  );
  // Second reconcile: still present in Raindrop, must not queue Edge delete.
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-indie-outside"),
    "outside-root pair survives second reconcile (no false delete)",
  );
  const pairs = await eng.store.getPairs();
  assert.ok(
    pairs.byRaindrop[String(indieItem._id)],
    "pair still mapped after second reconcile",
  );

  // Drop into Other favorites / Raindrop / IndieOutside → original outside-root collection.
  const dropped = await chrome.bookmarks.create({
    parentId: indieFolder.id,
    title: "ERS drop into outside-root",
    url: "https://example.com/ers-verify-indie-drop",
  });
  await eng.queue.enqueue(dropped.id);
  await eng.sync.drain();
  const droppedRain = [...mock._raindrops.values()].find(
    (r) => r.link === "https://example.com/ers-verify-indie-drop",
  );
  assert.ok(droppedRain, "drop under Raindrop/ uploads to Raindrop");
  assert.equal(
    Number(droppedRain.collection?.$id),
    Number(indie._id),
    "drop lands in original outside-root collection (not Edge/Other favorites/Raindrop/…)",
  );

  // Clear allowlist: outside-root pair must still survive (getRaindrop confirm).
  await eng.store.setConfig({
    raindropFolderAllowlist: {},
  });
  await eng.reconcile.reconcile();
  await eng.sync.drain();
  assert.ok(
    findEdgeByUrl("https://example.com/ers-verify-indie-outside"),
    "outside-root pair survives Clear selection / empty allowlist",
  );
  assert.ok(
    (await eng.store.getPairs()).byRaindrop[String(indieItem._id)],
    "pair still mapped after clearing allowlist",
  );

  console.log(
    "  ✔ allowlist skip/allow/empty-folder/Edge-bypass/empty-preserves-mode/prune/legacy/outside-root/upload-roundtrip/clear"
  );
}

async function scenario68_rateLimitBudget() {
  console.log("\n== 6.8 Rate-limit gate + capped delete-confirm GETs ==");
  const eng = await importEngine();
  const { POLICY, SYNC_MODE, JOB, MAX_ALIVE_CHECKS_PER_TICK } = eng.constants;
  await resetAll(eng.store);

  const mock = makeMockRaindrop();
  let getRaindropCalls = 0;
  const origGet = mock.getRaindrop.bind(mock);
  mock.getRaindrop = async (id) => {
    getRaindropCalls++;
    return origGet(id);
  };
  patchClient(eng.raindropMod, mock);

  await eng.store.setConfig({
    token: "mock",
    rootName: "ERS-Verify-Rate",
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_KEEP,
  });

  // Global pause must skip reconcile/drain API work.
  await eng.store.noteRateLimitedUntil(Date.now() + 60_000);
  const skipped = await eng.reconcile.reconcile();
  assert.equal(skipped.skipped, true, "reconcile skips while rate-limited");
  assert.equal(skipped.reason, "rate_limited", "skip reason is rate_limited");
  assert.equal(mock._collections.size, 0, "no collection fetch while gated");
  await eng.store.clearRateLimit();

  // Create root + many pairs that are NOT in the Raindrop listing → delete confirms.
  const root = await mock.createCollection("ERS-Verify-Rate", null);
  const orphans = MAX_ALIVE_CHECKS_PER_TICK + 5;
  for (let i = 0; i < orphans; i++) {
    const rid = 9000 + i;
    mock._raindrops.set(rid, {
      _id: rid,
      link: `https://example.com/ers-orphan-${i}`,
      title: `orphan-${i}`,
      collection: { $id: root._id },
    });
    // Pair exists, then remove from Raindrop so confirm path runs.
    await eng.store.recordSynced(`bm-orphan-${i}`, String(rid));
    mock._raindrops.delete(rid);
  }

  getRaindropCalls = 0;
  await eng.reconcile.reconcile();
  assert.equal(
    getRaindropCalls,
    MAX_ALIVE_CHECKS_PER_TICK,
    `alive checks exactly capped (got ${getRaindropCalls})`
  );
  let deleteJobs = (await eng.queue.list()).filter((j) => j.kind === JOB.DELETE_EDGE);
  assert.equal(
    deleteJobs.length,
    MAX_ALIVE_CHECKS_PER_TICK,
    "only confirmed-gone pairs enqueue deletes this tick"
  );
  const pairs = await eng.store.getPairs();
  assert.equal(
    Object.keys(pairs.byRaindrop).length,
    orphans,
    "pairs uncleared until DELETE_EDGE drains (no stampede side effects)"
  );
  const offsetAfter = (await eng.store.getReconcileState()).aliveConfirmOffset;
  assert.equal(
    offsetAfter,
    MAX_ALIVE_CHECKS_PER_TICK % orphans,
    "aliveConfirmOffset advances past the first window"
  );

  // Second cycle rotates — remaining orphans get delete jobs (cap may wrap).
  getRaindropCalls = 0;
  await eng.reconcile.reconcile();
  assert.ok(
    getRaindropCalls > 0 && getRaindropCalls <= MAX_ALIVE_CHECKS_PER_TICK,
    `second cycle still capped (got ${getRaindropCalls})`
  );
  deleteJobs = (await eng.queue.list()).filter((j) => j.kind === JOB.DELETE_EDGE);
  assert.equal(deleteJobs.length, orphans, "all orphans eventually queued across cycles");

  // 429 during drain sets global pause + defers due jobs.
  await eng.store.clearRateLimit();
  const folder = await chrome.bookmarks.create({
    parentId: "1",
    title: "ERS-Rate-Folder",
  });
  const bm = await chrome.bookmarks.create({
    parentId: folder.id,
    title: "rate-limit-me",
    url: "https://example.com/ers-rate-limit-upload",
  });
  await eng.queue.enqueue(bm.id);
  const Proto = eng.raindropMod.RaindropClient.prototype;
  const prevCreate = Proto.createRaindrop;
  Proto.createRaindrop = async () => {
    throw new eng.raindropMod.RateLimitError(Date.now() + 30_000);
  };
  await eng.sync.drain();
  Proto.createRaindrop = prevCreate;
  assert.equal(await eng.store.isRateLimited(), true, "429 sets global rate-limit pause");
  const due = await eng.queue.due(Date.now());
  assert.equal(due.length, 0, "due jobs deferred past the pause");

  // Heartbeat cooldown: after a completed cycle, force:false skips re-listing.
  await eng.store.clearRateLimit();
  await eng.store.setReconcileState({
    cursorPage: 0,
    outsideCursor: null,
    seenAcc: null,
    running: false,
    lastRunAt: Date.now(),
    lastError: null,
  });
  const cooled = await eng.reconcile.reconcile({ force: false });
  assert.equal(cooled.skipped, true, "heartbeat cooldown skips idle re-scan");
  assert.equal(cooled.reason, "cooldown", "skip reason is cooldown");
  const forced = await eng.reconcile.reconcile({ force: true });
  assert.notEqual(forced.skipped, true, "manual reconcile bypasses cooldown");

  // Manual reconcileNow must set the global gate on RateLimitError (not only fail the UI).
  await eng.store.clearRateLimit();
  const prevRoot = Proto.getRootCollections;
  Proto.getRootCollections = async () => {
    throw new eng.raindropMod.RateLimitError(Date.now() + 45_000);
  };
  const manual = await eng.sync.reconcileNow();
  Proto.getRootCollections = prevRoot;
  assert.equal(manual.skipped, true, "reconcileNow returns skipped on 429");
  assert.equal(manual.reason, "rate_limited", "reconcileNow skip reason is rate_limited");
  assert.equal(await eng.store.isRateLimited(), true, "reconcileNow 429 sets global pause");

  console.log("  ✔ global gate, capped confirms, round-robin, skip reasons, cooldown, reconcileNow gate");
}

async function optionalLiveSmoke() {
  if (!USE_LIVE) {
    console.log("\n== Live Raindrop smoke skipped (pass --live with token for API check) ==");
    return;
  }
  console.log("\n== Live Raindrop smoke (ERS-Verify-* only) ==");
  verifyRootTitle = `ERS-Verify-${Date.now()}`;
  try {
    const root = await liveCall("POST", "/collection", { title: verifyRootTitle });
    createdLive.collections.push(root.item._id);
    const child = await liveCall("POST", "/collection", {
      title: "ERS-Verify-Child",
      parent: { $id: root.item._id },
    });
    createdLive.collections.push(child.item._id);

    const created = await liveCall("POST", "/raindrop", {
      link: "https://example.com/ers-verify-live",
      title: "ERS-Verify-Live",
      collection: { $id: child.item._id },
      tags: ["ers-verify"],
      note: "dispose-me",
    });
    createdLive.raindrops.push(created.item._id);

    const listed = await liveCall(
      "GET",
      `/raindrops/${root.item._id}?nested=true&perpage=50&page=0`
    );
    assert.ok(
      (listed.items || []).some((i) => i._id === created.item._id),
      "nested list"
    );

    await liveCall("PUT", `/raindrop/${created.item._id}`, { title: "ERS-Verify-Live-Renamed" });
    const after = await liveCall("GET", `/raindrop/${created.item._id}`);
    assert.ok(after.item.tags?.includes("ers-verify"), "tags preserved on partial PUT");
    assert.equal(after.item.note, "dispose-me", "note preserved");

    await liveCall("DELETE", `/raindrop/${created.item._id}`);
    createdLive.raindrops = createdLive.raindrops.filter((id) => id !== created.item._id);
    console.log("  ✔ live create/list/partial-update/delete on disposable collection only");
  } finally {
    await liveCleanup();
    console.log("  ✔ live cleanup complete");
  }
}

async function main() {
  console.log(
    `Mode: ${USE_LIVE ? "mock Edge + live Raindrop (ERS-Verify-* only)" : "fully mocked (no real Edge/Raindrop writes)"}`
  );
  console.log("Edge: in-memory disposable tree only (Favorites bar / Other favorites).");

  await scenario62_oneWay();
  await scenario63_bidirectional();
  await scenario64_syncAndDelete();
  await scenario65_exclude();
  await scenario66_raindropFolderModes();
  await scenario67_raindropFolderAllowlist();
  await scenario68_rateLimitBudget();
  await optionalLiveSmoke();

  console.log("\nAll checklist scenarios passed.");
}

main().catch(async (err) => {
  console.error("\nVERIFY FAILED:", err);
  if (USE_LIVE) await liveCleanup();
  process.exit(1);
});
