// Raindrop collection allowlist for selective Raindrop-only sync.
//
// When the allowlist is non-empty, Raindrop-only paths (missing in Edge) sync
// only if the raindrop's collection or an ancestor under the root is listed.
// Edge paths that already exist bypass the allowlist. Empty allowlist leaves
// raindropFolderMode behavior unchanged.
//
// Stale entries (deleted collections, or subtrees fully present in Edge) are
// pruned so selective mode cannot stick on after everything has mirrored.

import { collectionsUnderRoot, getById } from "./collections.js";
import { RAINDROP_FOLDER_MODE } from "./constants.js";

/**
 * @param {Record<string, { path?: string }>|null|undefined} allowlist
 * @returns {boolean}
 */
export function isAllowlistActive(allowlist) {
  return !!allowlist && Object.keys(allowlist).length > 0;
}

/**
 * True if `collectionId` or any ancestor under `rootId` is on the allowlist.
 * @param {string|number|null|undefined} collectionId
 * @param {{ byId: Map }} index
 * @param {string|number} rootId
 * @param {Record<string, { path?: string }>|null|undefined} allowlist
 */
export function isCollectionAllowed(collectionId, index, rootId, allowlist) {
  if (!isAllowlistActive(allowlist) || collectionId == null || !index?.byId) {
    return false;
  }
  let current = getById(index, collectionId);
  const seen = new Set();
  while (current) {
    if (seen.has(current._id)) return false;
    seen.add(current._id);
    const key = String(current._id);
    if (allowlist[key] || allowlist[current._id]) return true;
    if (String(current._id) === String(rootId)) return false;
    const parentId = current.parent?.$id;
    if (parentId == null) return false;
    current = getById(index, parentId);
  }
  return false;
}

/**
 * Whether a pull that would create Edge folders is permitted.
 * Edge-existing paths always allowed. With active allowlist, need membership.
 * With empty allowlist, `existing-only` blocks missing paths; other modes allow.
 *
 * `existingOnlyValue` defaults to RAINDROP_FOLDER_MODE.EXISTING_ONLY so callers
 * only pass the varying gate fields.
 *
 * @param {{
 *   allowlist: Record<string, { path?: string }>|null|undefined,
 *   collectionId: string|number|null|undefined,
 *   index: { byId: Map }|null|undefined,
 *   rootId: string|number|null|undefined,
 *   edgePathExists: boolean,
 *   folderMode: string,
 *   existingOnlyValue?: string,
 * }} opts
 */
export function canCreateRaindropOnlyPath(opts) {
  const {
    allowlist,
    collectionId,
    index,
    rootId,
    edgePathExists,
    folderMode,
    existingOnlyValue = RAINDROP_FOLDER_MODE.EXISTING_ONLY,
  } = opts;
  if (edgePathExists) return true;
  if (isAllowlistActive(allowlist)) {
    if (rootId == null || !index) return false;
    return isCollectionAllowed(collectionId, index, rootId, allowlist);
  }
  return folderMode !== existingOnlyValue;
}

/**
 * Keep only allowlist ids that still cover at least one not-yet-mirrored
 * collection under the root. Drops deleted/moved ids and fully-mirrored trees
 * so an empty allowlist (and normal folder modes) can return.
 *
 * @param {Record<string, { path?: string }>|null|undefined} allowlist
 * @param {{ byId: Map, byParent?: Map }} index
 * @param {string|number} rootId
 * @param {(relativeSegments: string[]) => boolean|Promise<boolean>} edgePathExists
 * @returns {Promise<{ allowlist: Record<string, { path?: string }>, removed: number }>}
 */
export async function pruneAllowlist(allowlist, index, rootId, edgePathExists) {
  const src = allowlist && typeof allowlist === "object" ? allowlist : {};
  const keys = Object.keys(src);
  if (!keys.length) return { allowlist: {}, removed: 0 };

  const under = collectionsUnderRoot(index, rootId);
  const next = {};
  let removed = 0;

  for (const id of keys) {
    const singleton = { [id]: src[id] };
    let stillNeeded = false;
    for (const { collectionId, relativeSegments } of under) {
      if (!relativeSegments.length) continue;
      if (!isCollectionAllowed(collectionId, index, rootId, singleton)) continue;
      if (await edgePathExists(relativeSegments)) continue;
      stillNeeded = true;
      break;
    }
    if (stillNeeded) next[id] = src[id];
    else removed++;
  }

  return { allowlist: next, removed };
}
