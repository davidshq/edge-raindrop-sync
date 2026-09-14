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
} from "../src/lib/collections.js";
import { jobKind } from "../src/lib/queue.js";
import { POLICY, JOB, DEFAULT_CONFIG, RAINDROP_FOLDER_MODE, SYNC_MODE } from "../src/lib/constants.js";
import { normalizeConfig } from "../src/lib/store.js";

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
    "default preserves create-as-needed",
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
  assert.ok(under.some((u) => u.relativeSegments.length === 0), "includes root with empty relative");
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
    async (path) => uncached.push(path),
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

console.log("\nAll offline checks passed.");
console.log("Engine scenarios: npm test runs verify-checklist.mjs next (mocked Edge).");
console.log("Manual Edge still useful for SW lifecycle / Options UI only.");
