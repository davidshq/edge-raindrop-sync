#!/usr/bin/env node
// Pre-build spike for the Raindrop.io API (tasks 1.1–1.4).
//
// Verifies, against a real account, the exact behaviors the folder-mirroring
// core depends on:
//   1.1  token auth works (GET /user)
//   1.2  nested collections to depth 3 via parent.$id
//   1.3  child lookup by parent + title; whether titles must be unique per parent
//   1.4  raindrop creation into a specific collection; rate-limit headers
//
// Usage:
//   RAINDROP_TOKEN=xxxxx node scripts/spike-raindrop.mjs [--cleanup]
//   node scripts/spike-raindrop.mjs <token> [--cleanup]
//
// --cleanup deletes everything the spike created when it finishes.

const API = "https://api.raindrop.io/rest/v1";

const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const token = process.env.RAINDROP_TOKEN || args.find((a) => !a.startsWith("--"));

if (!token) {
  console.error("No token. Set RAINDROP_TOKEN or pass it as the first argument.");
  process.exit(1);
}

let lastRateHeaders = {};

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  lastRateHeaders = {
    limit: res.headers.get("X-RateLimit-Limit"),
    remaining: res.headers.get("X-RateLimit-Remaining"),
    reset: res.headers.get("X-RateLimit-Reset"),
    retryAfter: res.headers.get("Retry-After"),
  };
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return json;
}

const created = { collections: [], raindrops: [] };

async function createCollection(title, parentId) {
  const body = { title };
  if (parentId != null) body.parent = { $id: parentId };
  const { item } = await call("POST", "/collection", body);
  created.collections.push(item._id);
  return item;
}

async function main() {
  console.log("== 1.1 Token check (GET /user) ==");
  const { user } = await call("GET", "/user");
  console.log(`  OK: ${user.fullName || user.email || user._id}`);

  console.log("\n== 1.2 Nested collections to depth 3 ==");
  const root = await createCollection("ERS Spike Root");
  console.log(`  root: "${root.title}" (_id ${root._id})`);
  const child = await createCollection("Child", root._id);
  console.log(`  child: "${child.title}" parent=${child.parent?.$id}`);
  const grand = await createCollection("Grandchild", child._id);
  console.log(`  grandchild: "${grand.title}" parent=${grand.parent?.$id}`);
  console.log(
    grand.parent?.$id === child._id
      ? "  ✔ depth-3 nesting via parent.$id confirmed"
      : "  ✗ grandchild parent did not match — nesting may be limited",
  );

  console.log("\n== 1.3 Child lookup by parent + title; duplicate titles ==");
  const childrens = await call("GET", "/collections/childrens");
  const underChild = (childrens.items || []).filter((c) => c.parent?.$id === child._id);
  console.log(`  /collections/childrens returned ${childrens.items?.length ?? 0} nested total`);
  console.log(`  found ${underChild.length} under "Child" by parent.$id match`);
  const dup = await createCollection("Grandchild", child._id);
  console.log(
    dup._id !== grand._id
      ? `  ⚠ duplicate title allowed under same parent (got new _id ${dup._id}) — ensure-if-missing MUST match existing by title, not blindly create`
      : "  ✔ duplicate title was de-duplicated by Raindrop",
  );

  console.log("\n== 1.4 Raindrop creation + rate-limit headers ==");
  const { item: drop } = await call("POST", "/raindrop", {
    link: "https://example.com/ers-spike",
    title: "ERS Spike Bookmark",
    collection: { $id: grand._id },
    pleaseParse: {},
  });
  created.raindrops.push(drop._id);
  console.log(`  created raindrop _id ${drop._id} in collection ${drop.collection?.$id}`);
  console.log(`  rate-limit headers: ${JSON.stringify(lastRateHeaders)}`);

  console.log("\nSpike complete. Findings to fold into the client:");
  console.log("  - parent.$id nesting depth:", grand.parent?.$id === child._id ? "OK to 3" : "LIMITED");
  console.log("  - duplicate titles per parent:", dup._id !== grand._id ? "ALLOWED (match-before-create)" : "de-duplicated");
  console.log("  - rate-limit signal:", JSON.stringify(lastRateHeaders));

  if (cleanup) {
    console.log("\n== Cleanup ==");
    for (const id of created.raindrops) {
      await call("DELETE", `/raindrop/${id}`).catch(() => {});
    }
    // Delete deepest-first.
    for (const id of [...created.collections].reverse()) {
      await call("DELETE", `/collection/${id}`).catch(() => {});
    }
    console.log("  removed spike collections and raindrop.");
  } else {
    console.log('\n(Use --cleanup to remove the "ERS Spike Root" collection tree.)');
  }
}

main().catch((err) => {
  console.error("\nSpike failed:", err.message);
  process.exit(1);
});
