#!/usr/bin/env node
// Offline unit checks for pure sync helpers (no Raindrop token / Edge / chrome).
// Imports the real src/lib modules — do not reimplement algorithms here.
// Run: node scripts/verify-bidirectional-logic.mjs
// Or:  npm test

import assert from "node:assert/strict";
import { resolvePolicy, isExcluded } from "../src/lib/policy.js";
import {
  collectionPathFromRoot,
  collectionIdAlive,
  ensureCollectionPath,
  collectionsUnderRoot,
  collectionIdFromRelative,
} from "../src/lib/collections.js";
import { jobKind } from "../src/lib/queue.js";
import {
  POLICY,
  JOB,
  DEFAULT_CONFIG,
  RAINDROP_FOLDER_MODE,
  SYNC_MODE,
} from "../src/lib/constants.js";
import { normalizeConfig } from "../src/lib/store.js";
import {
  isAllowlistActive,
  isCollectionAllowed,
  canCreateRaindropOnlyPath,
  pruneAllowlist,
} from "../src/lib/allowlist.js";

console.log("== policy resolution ==");
{
  const overrides = {
    work: { policy: POLICY.SYNC_KEEP },
    secrets: { policy: POLICY.EXCLUDE },
  };
  assert.equal(resolvePolicy(["secrets", "work"], overrides, POLICY.SYNC_DELETE), POLICY.EXCLUDE);
  assert.equal(resolvePolicy(["archive", "work"], overrides, POLICY.SYNC_DELETE), POLICY.SYNC_KEEP);
  assert.equal(resolvePolicy(["misc"], overrides, POLICY.SYNC_DELETE), POLICY.SYNC_DELETE);
  assert.equal(isExcluded(["secrets", "work"], overrides, POLICY.SYNC_DELETE), true);
  assert.equal(isExcluded(["archive", "work"], overrides, POLICY.SYNC_DELETE), false);
  console.log("  ✔ nearest-ancestor + exclude");
}

console.log("== raindropFolderMode default ==");
{
  assert.equal(
    DEFAULT_CONFIG.raindropFolderMode,
    RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    "default preserves create-as-needed"
  );
  console.log("  ✔ default create-as-needed");
}

console.log("== bidirectional coerces global keep-both ==");
{
  const coerced = normalizeConfig({
    syncMode: SYNC_MODE.BIDIRECTIONAL,
    defaultPolicy: POLICY.SYNC_DELETE,
  });
  assert.equal(coerced.defaultPolicy, POLICY.SYNC_KEEP);
  const oneWay = normalizeConfig({
    syncMode: SYNC_MODE.ONE_WAY,
    defaultPolicy: POLICY.SYNC_DELETE,
  });
  assert.equal(oneWay.defaultPolicy, POLICY.SYNC_DELETE, "one-way offload unchanged");
  console.log("  ✔ stale bidirectional offload → keep-both");
}

console.log("== collection path under root ==");
{
  const byId = new Map();
  const root = { _id: 1, title: "Edge", parent: null };
  const bar = { _id: 2, title: "Favorites bar", parent: { $id: 1 } };
  const work = { _id: 3, title: "Work", parent: { $id: 2 } };
  const other = { _id: 9, title: "Elsewhere", parent: null };
  for (const c of [root, bar, work, other]) {
    byId.set(c._id, c);
    byId.set(String(c._id), c);
  }
  const index = { byId };
  assert.deepEqual(collectionPathFromRoot(index, 3, 1), ["Edge", "Favorites bar", "Work"]);
  assert.deepEqual(collectionPathFromRoot(index, 9, 1), []);

  const under = collectionsUnderRoot(index, 1);
  assert.equal(under.length, 3, "root + bar + work");
  assert.ok(under.some((u) => u.relativeSegments.join("/") === "Favorites bar/Work"));
  assert.ok(
    under.some((u) => u.relativeSegments.length === 0),
    "includes root with empty relative"
  );
  console.log("  ✔ path under root / outside root / collectionsUnderRoot");
}

console.log("== collection cache vs live index ==");
{
  const byParent = new Map();
  const byId = new Map();
  const root = { _id: 1, title: "Edge", parent: null };
  byParent.set("root", new Map([["edge", root]]));
  byId.set(1, root);
  byId.set("1", root);
  const index = { byParent, byId };

  assert.equal(collectionIdAlive(index, 1), true);
  assert.equal(collectionIdAlive(index, 999), false);

  const created = [];
  const client = {
    async createCollection(title, parentId) {
      const col = { _id: 50, title, parent: parentId != null ? { $id: parentId } : null };
      created.push(col);
      return col;
    },
  };
  const cache = { Edge: 999 }; // stale — id 999 not in index
  const uncached = [];
  const id = await ensureCollectionPath(
    client,
    index,
    ["Edge"],
    cache,
    async () => {},
    async (path) => uncached.push(path)
  );
  assert.equal(id, 1, "match existing live collection by title, not stale cache");
  assert.deepEqual(uncached, ["Edge"]);
  assert.equal(created.length, 0, "must not create a duplicate root");
  assert.equal(cache.Edge, 1);
  console.log("  ✔ stale cache dropped; title match reused");
}

console.log("== job kind defaults ==");
{
  assert.equal(jobKind({ id: "1" }), JOB.UPLOAD);
  assert.equal(jobKind({ id: "pull-9", kind: JOB.PULL_CREATE }), JOB.PULL_CREATE);
  console.log("  ✔ legacy jobs are upload");
}

console.log("== raindrop folder allowlist ==");
{
  assert.deepEqual(DEFAULT_CONFIG.raindropFolderAllowlist, {});
  assert.equal(isAllowlistActive({}), false);
  assert.equal(isAllowlistActive(null), false);
  assert.equal(isAllowlistActive({ 3: { path: "Work" } }), true);

  const byId = new Map();
  const byParent = new Map();
  const root = { _id: 1, title: "Edge", parent: null };
  const bar = { _id: 2, title: "Favorites bar", parent: { $id: 1 } };
  const work = { _id: 3, title: "Work", parent: { $id: 2 } };
  const nested = { _id: 4, title: "Nested", parent: { $id: 3 } };
  for (const c of [root, bar, work, nested]) {
    byId.set(c._id, c);
    byId.set(String(c._id), c);
  }
  byParent.set(1, new Map([["favorites bar", bar]]));
  byParent.set(2, new Map([["work", work]]));
  byParent.set(3, new Map([["nested", nested]]));
  const index = { byId, byParent };

  assert.equal(isCollectionAllowed(4, index, 1, { 3: { path: "Work" } }), true, "parent covers");
  assert.equal(isCollectionAllowed(4, index, 1, { 9: { path: "Other" } }), false);
  assert.equal(isCollectionAllowed(4, index, 1, {}), false, "empty allowlist → not allowed");

  assert.equal(
    collectionIdFromRelative(index, 1, ["Favorites bar", "Work", "Nested"]),
    4,
    "resolve path → id"
  );
  assert.equal(collectionIdFromRelative(index, 1, ["Missing"]), null);

  assert.equal(
    canCreateRaindropOnlyPath({
      allowlist: {},
      collectionId: 4,
      index,
      rootId: 1,
      edgePathExists: false,
      folderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    }),
    true,
    "empty allowlist + create-as-needed"
  );
  assert.equal(
    canCreateRaindropOnlyPath({
      allowlist: {},
      collectionId: 4,
      index,
      rootId: 1,
      edgePathExists: false,
      folderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    }),
    false,
    "empty allowlist + existing-only blocks"
  );
  assert.equal(
    canCreateRaindropOnlyPath({
      allowlist: { 3: { path: "Work" } },
      collectionId: 4,
      index,
      rootId: 1,
      edgePathExists: false,
      folderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    }),
    true,
    "allowlisted via parent"
  );
  assert.equal(
    canCreateRaindropOnlyPath({
      allowlist: { 3: { path: "Work" } },
      collectionId: 99,
      index,
      rootId: 1,
      edgePathExists: false,
      folderMode: RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
    }),
    false,
    "active allowlist skips unchecked"
  );
  assert.equal(
    canCreateRaindropOnlyPath({
      allowlist: { 3: { path: "Work" } },
      collectionId: 99,
      index,
      rootId: 1,
      edgePathExists: true,
      folderMode: RAINDROP_FOLDER_MODE.EXISTING_ONLY,
    }),
    true,
    "Edge path exists bypasses allowlist"
  );

  const mirrored = new Set(["Favorites bar", "Favorites bar/Work", "Favorites bar/Work/Nested"]);
  const prunedGone = await pruneAllowlist(
    { 3: { path: "Work" }, 99: { path: "Gone" } },
    index,
    1,
    async (rel) => mirrored.has(rel.join("/"))
  );
  assert.equal(prunedGone.removed, 2, "fully mirrored + missing ids pruned");
  assert.deepEqual(prunedGone.allowlist, {});

  const prunedKeep = await pruneAllowlist(
    { 3: { path: "Work" } },
    index,
    1,
    async (rel) => rel.join("/") === "Favorites bar/Work" // Nested still missing
  );
  assert.equal(prunedKeep.removed, 0, "keep while descendant still Raindrop-only");
  assert.ok(prunedKeep.allowlist["3"]);

  const normalized = normalizeConfig({ token: "x" });
  assert.deepEqual(normalized.raindropFolderAllowlist, {});
  console.log("  ✔ active/parent/empty-mode/Edge-bypass/prune/path-resolve");
}

console.log("\nAll offline checks passed.");
console.log("Engine scenarios: npm test runs verify-checklist.mjs next (mocked Edge).");
console.log("Manual Edge still useful for SW lifecycle / Options UI only.");
