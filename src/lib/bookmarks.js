// Thin promise wrappers and path resolution over the chrome.bookmarks API.
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
