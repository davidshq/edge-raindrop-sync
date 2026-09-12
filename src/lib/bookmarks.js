// Thin promise wrappers and path resolution over the chrome.bookmarks API.
//
// Mirror placement (Raindrop relative path → Edge parent) lives in
// resolveMirrorPlacement / resolveEdgeParentForMirror / ancestorIdsForMirrorPath
// so pull-create and exclude checks cannot drift.
//
// Note on identity: the on-disk Chromium "guid" is not exposed by the
// chrome.bookmarks API. We use the node `id`, which is stable across browser
// restarts and survives renames/moves within the profile — which is exactly the
// rename-survival property the design wanted from a GUID.

export async function getNode(id) {
  const [node] = await chrome.bookmarks.get(id);
  return node;
}

export async function getTree() {
  return chrome.bookmarks.getTree();
}

export async function getChildren(id) {
  return chrome.bookmarks.getChildren(id);
}

export async function removeNode(id) {
  await chrome.bookmarks.remove(id);
}

export async function removeFolder(id) {
  // remove() rejects on non-empty folders; this is only called on empties.
  await chrome.bookmarks.remove(id);
}

export async function createBookmark({ parentId, title, url }) {
  return chrome.bookmarks.create({ parentId, title: title || url, url });
}

export async function createFolder({ parentId, title }) {
  return chrome.bookmarks.create({ parentId, title });
}

/** Top-level user-visible roots under the invisible absolute root (id "0"). */
export async function getTopRoots() {
  return getChildren("0");
}

/**
 * Ensure folder titles under `parentId` exist; return the deepest folder id.
 * Creates missing folders as needed.
 */
export async function ensureFolderPath(parentId, titles) {
  let currentId = parentId;
  for (const title of titles) {
    const children = await getChildren(currentId);
    let folder = children.find((c) => !c.url && (c.title || "") === title);
    if (!folder) {
      folder = await createFolder({ parentId: currentId, title });
    }
    currentId = folder.id;
  }
  return currentId;
}

/**
 * Map a Raindrop-relative collection path to an Edge placement plan.
 * `relativeSegments` is under the Raindrop root (root title already stripped),
 * e.g. ["Favorites bar", "Work"] or ["Inbox"].
 *
 * Returns `{ startId, titles }` such that `ensureFolderPath(startId, titles)`
 * is the parent for a pull-create. Policy checks walk the same plan without
 * creating missing folders.
 */
export async function resolveMirrorPlacement(relativeSegments, rootName, topRoots) {
  const tops = topRoots ?? (await getTopRoots());
  const other =
    tops.find((t) => /other/i.test(t.title || "")) ||
    tops.find((t) => !/bar|toolbar|favorites bar/i.test(t.title || "")) ||
    tops[0];
  const bar =
    tops.find((t) => /bar|toolbar/i.test(t.title || "")) ||
    tops.find((t) => /favorite/i.test(t.title || "") && t !== other) ||
    tops[0];

  if (!other && !bar) {
    throw new Error("No Edge bookmark roots found");
  }

  const base = other || bar;

  if (relativeSegments.length === 0) {
    // Directly under Raindrop root → Other favorites/<rootName>
    return { startId: base.id, titles: [rootName] };
  }

  const [first, ...rest] = relativeSegments;
  const match = tops.find((t) => (t.title || "").toLowerCase() === first.toLowerCase());
  if (match) {
    return { startId: match.id, titles: rest };
  }

  // Unrecognized first segment → Other favorites/<rootName>/<segments…>
  return { startId: base.id, titles: [rootName, ...relativeSegments] };
}

/** Create (as needed) the Edge parent folder for a Raindrop-mirrored path. */
export async function resolveEdgeParentForMirror(relativeSegments, rootName) {
  const { startId, titles } = await resolveMirrorPlacement(relativeSegments, rootName);
  return ensureFolderPath(startId, titles);
}

/**
 * Nearest-first ancestor folder ids for the Edge path a mirror pull would use.
 * Walks existing folders only (stops at the first missing title) so exclude
 * policy can be evaluated without creating folders.
 */
export async function ancestorIdsForMirrorPath(relativeSegments, rootName, topRoots) {
  const { startId, titles } = await resolveMirrorPlacement(
    relativeSegments,
    rootName,
    topRoots,
  );
  const ancestorIds = [startId];
  let parentId = startId;
  for (const title of titles) {
    const children = await getChildren(parentId);
    const folder = children.find((c) => !c.url && (c.title || "") === title);
    if (!folder) break;
    ancestorIds.unshift(folder.id);
    parentId = folder.id;
  }
  return ancestorIds;
}

// Resolve a bookmark's location into:
//   segments      : folder titles from the top root down to the parent folder
//                   e.g. ["Favorites bar", "Work", "ProjectA"]
//   ancestorIds   : the same folders' ids, nearest-first (parent folder first)
//                   e.g. [ProjectA.id, Work.id, FavoritesBar.id]
// The invisible absolute root (id "0") is excluded. The top root folder (e.g.
// "Favorites bar" / "Other favorites") is included so both Edge roots are
// preserved under the chosen Raindrop root collection.
export async function resolveLocation(node) {
  const segments = [];
  const ancestorIds = [];
  let current = node;
  while (current && current.parentId && current.parentId !== "0") {
    const parent = await getNode(current.parentId);
    segments.unshift(parent.title);
    ancestorIds.push(parent.id);
    current = parent;
  }
  return { segments, ancestorIds };
}

// Collect every URL-bearing node in the tree (used by backfill), each tagged
// with its resolved location so the caller can apply policy. `segments` and
// `ancestorIds` describe the folders descended into, excluding the invisible
// absolute root (id "0"). This mirrors resolveLocation()'s output shape.
export async function collectAllBookmarks() {
  const tree = await getTree();
  const out = [];
  const walk = (node, segments, ancestorIds) => {
    for (const child of node.children ?? []) {
      if (child.url) {
        out.push({ node: child, segments, ancestorIds });
      } else {
        walk(child, [...segments, child.title], [child.id, ...ancestorIds]);
      }
    }
  };
  for (const root of tree) walk(root, [], []); // root is id "0": empty path
  return out;
}
