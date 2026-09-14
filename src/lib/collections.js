// Mirrors an Edge folder path into nested Raindrop collections (ensure-if-missing).
//
// Raindrop allows duplicate collection titles, so "does this collection exist?"
// is answered by matching title within a given parent — never by global title.
// We build an in-memory index of existing collections once per drain pass and
// also persist a path -> collectionId cache so steady-state syncs make zero
// collection lookups. Cache hits are validated against the live index so a
// deleted/renamed Raindrop collection cannot keep receiving new raindrops.
//
// Index maps store dual keys (id + String(id)); use getById / getByParent so
// call sites never miss a collection due to number/string mismatch.

const ROOT = "root"; // sentinel parent key for top-level collections

/**
 * Lookup a collection by id, tolerating number vs string keys (index stores both).
 * @param {{ byId?: Map }|null|undefined} index
 * @param {string|number|null|undefined} id
 */
export function getById(index, id) {
  if (id == null || !index?.byId) return null;
  return index.byId.get(id) || index.byId.get(String(id)) || null;
}

/**
 * Children map for a parent id (title→collection), with number/string key fallback.
 * @param {{ byParent?: Map }|null|undefined} index
 * @param {string|number} parentId
 * @returns {Map|undefined}
 */
export function getByParent(index, parentId) {
  if (parentId == null || !index?.byParent) return undefined;
  return index.byParent.get(parentId) || index.byParent.get(String(parentId));
}

/**
 * Build collection indexes from the account's root and nested collections.
 * @returns {{ byParent: Map, byId: Map<string|number, object> }}
 */
export async function buildCollectionIndex(client) {
  const [roots, children] = await Promise.all([
    client.getRootCollections(),
    client.getChildCollections(),
  ]);
  const byParent = new Map();
  const byId = new Map();
  const add = (col) => {
    const parentId = col.parent && col.parent.$id ? col.parent.$id : ROOT;
    if (!byParent.has(parentId)) byParent.set(parentId, new Map());
    byParent.get(parentId).set((col.title || "").toLowerCase(), col);
    byId.set(col._id, col);
    byId.set(String(col._id), col);
  };
  roots.forEach(add);
  children.forEach(add);
  return { byParent, byId };
}

/** Find a root-level collection by title (case-insensitive). */
export function findRootCollection(index, title) {
  const siblings = getByParent(index, ROOT);
  return siblings?.get((title || "").toLowerCase()) ?? null;
}

/**
 * Titles from the configured root down to `collectionId` (inclusive of root).
 * Returns [] if the collection is not under the root.
 */
export function collectionPathFromRoot(index, collectionId, rootId) {
  const titles = [];
  let current = getById(index, collectionId);
  const seen = new Set();
  while (current) {
    if (seen.has(current._id)) return [];
    seen.add(current._id);
    titles.unshift(current.title || "");
    if (String(current._id) === String(rootId)) return titles;
    const parentId = current.parent?.$id;
    if (parentId == null) return []; // walked off the top without hitting root
    current = getById(index, parentId);
  }
  return [];
}

/** True when `id` is present in the live collection index. */
export function collectionIdAlive(index, id) {
  return getById(index, id) != null;
}

/**
 * Every collection under `rootId` (including the root), with relative segments
 * (root title stripped). Dedupes by `_id` because the index stores dual keys.
 * @returns {{ collectionId: number|string, relativeSegments: string[] }[]}
 */
export function collectionsUnderRoot(index, rootId) {
  if (!index?.byId) return [];
  const seen = new Set();
  const out = [];
  for (const col of index.byId.values()) {
    if (!col || seen.has(col._id)) continue;
    seen.add(col._id);
    const full = collectionPathFromRoot(index, col._id, rootId);
    if (!full.length) continue;
    out.push({ collectionId: col._id, relativeSegments: full.slice(1) });
  }
  return out;
}

/**
 * Resolve a Raindrop collection id from titles relative to `rootId`
 * (e.g. ["Favorites bar", "Work"]). Returns null if any segment is missing.
 */
export function collectionIdFromRelative(index, rootId, relativeSegments) {
  if (!index?.byParent || rootId == null) return null;
  let parentId = rootId;
  let col = getById(index, rootId);
  for (const title of relativeSegments || []) {
    const siblings = getByParent(index, parentId);
    col = siblings?.get((title || "").toLowerCase()) ?? null;
    if (!col) return null;
    parentId = col._id;
  }
  return col ? col._id : null;
}

/**
 * Ensure every collection along `fullSegments` exists (e.g.
 * ["Edge", "Favorites bar", "Work"]) and return the deepest collection's id.
 *
 * `cache` is the path→id map (loaded once per drain, mutated here).
 * `persist(path, id)` writes a warm entry; optional `uncache(path)` drops a
 * stale entry when the cached id is missing from the live index.
 */
export async function ensureCollectionPath(client, index, fullSegments, cache, persist, uncache) {
  const byParent = index.byParent || index;
  let parentId = ROOT;
  let pathSoFar = "";
  let collectionId = null;

  for (const title of fullSegments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${title}` : title;

    if (cache[pathSoFar] != null) {
      const cachedId = cache[pathSoFar];
      if (collectionIdAlive(index, cachedId)) {
        collectionId = cachedId;
        parentId = collectionId;
        continue;
      }
      // Stale: collection deleted/renamed in Raindrop since we cached the path.
      delete cache[pathSoFar];
      if (typeof uncache === "function") await uncache(pathSoFar);
    }

    // Prefer getByParent when index has byId/byParent shape; fall back for
    // legacy callers that pass a bare byParent Map as `index`.
    const siblings =
      index.byParent != null ? getByParent(index, parentId) : byParent.get(parentId);
    let col = siblings && siblings.get(title.toLowerCase());
    if (!col) {
      col = await client.createCollection(title, parentId === ROOT ? null : parentId);
      if (!byParent.has(parentId)) byParent.set(parentId, new Map());
      byParent.get(parentId).set(title.toLowerCase(), col);
      if (index.byId) {
        index.byId.set(col._id, col);
        index.byId.set(String(col._id), col);
      }
    }

    collectionId = col._id;
    cache[pathSoFar] = collectionId;
    await persist(pathSoFar, collectionId);
    parentId = collectionId;
  }

  return collectionId;
}
