// Mirrors an Edge folder path into nested Raindrop collections (ensure-if-missing).
//
// Raindrop allows duplicate collection titles, so "does this collection exist?"
// is answered by matching title within a given parent — never by global title.
// We build an in-memory index of existing collections once per drain pass and
// also persist a path -> collectionId cache so steady-state syncs make zero
// collection lookups.

const ROOT = "root"; // sentinel parent key for top-level collections

// Build a parent -> (lowercased title -> collection) index from the account's
// root and nested collections. Called at most once per drain pass.
export async function buildCollectionIndex(client) {
  const [roots, children] = await Promise.all([
    client.getRootCollections(),
    client.getChildCollections(),
  ]);
  const byParent = new Map();
  const add = (col) => {
    const parentId = col.parent && col.parent.$id ? col.parent.$id : ROOT;
    if (!byParent.has(parentId)) byParent.set(parentId, new Map());
    byParent.get(parentId).set((col.title || "").toLowerCase(), col);
  };
  roots.forEach(add);
  children.forEach(add);
  return byParent;
}

// Ensure every collection along `fullSegments` exists (e.g.
// ["Edge", "Favorites bar", "Work"]) and return the deepest collection's id.
// `cache` is the persistent path->id map, loaded once per pass and mutated here.
export async function ensureCollectionPath(client, index, fullSegments, cache, persist) {
  let parentId = ROOT;
  let pathSoFar = "";
  let collectionId = null;

  for (const title of fullSegments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${title}` : title;

    if (cache[pathSoFar]) {
      collectionId = cache[pathSoFar];
      parentId = collectionId;
      continue;
    }

    const siblings = index.get(parentId);
    let col = siblings && siblings.get(title.toLowerCase());
    if (!col) {
      col = await client.createCollection(title, parentId === ROOT ? null : parentId);
      if (!index.has(parentId)) index.set(parentId, new Map());
      index.get(parentId).set(title.toLowerCase(), col);
    }

    collectionId = col._id;
    cache[pathSoFar] = collectionId;
    await persist(pathSoFar, collectionId);
    parentId = collectionId;
  }

  return collectionId;
}
