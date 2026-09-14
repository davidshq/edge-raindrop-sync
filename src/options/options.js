// Options page logic. Reads/writes config and overrides directly (this is an
// extension page with the same permissions), and messages the service worker
// for backfill, reconcile, and status so work continues after the page closes.
// Folder-policy edits are held in a draft until "Save folder policies" so a
// parent change cannot surprise-apply to children mid-edit.

import { ALL_POLICIES, MSG, POLICY, SYNC_MODE, RAINDROP_FOLDER_MODE } from "../lib/constants.js";
import {
  getConfig,
  setConfig,
  getOverrides,
  setOverrides,
  getRaindropFolderAllowlist,
  setRaindropFolderAllowlist,
} from "../lib/store.js";
import { getTree, mirrorPathExists, getTopRoots } from "../lib/bookmarks.js";
import {
  buildCollectionIndex,
  findRootCollection,
  collectionsUnderRoot,
  getById,
  getByParent,
} from "../lib/collections.js";
import { isCollectionAllowed, pruneAllowlist } from "../lib/allowlist.js";
import { RaindropClient } from "../lib/raindrop.js";

const $ = (id) => document.getElementById(id);

// Folder-policy labels. "Offload" is sync-and-delete: useful as a per-folder
// exception under bidirectional, not as the bidirectional global default.
const POLICY_LABELS = {
  [POLICY.SYNC_DELETE]: "Offload (delete from Edge)",
  [POLICY.SYNC_KEEP]: "Keep in Edge",
  [POLICY.EXCLUDE]: "Exclude",
};

/** In-memory draft of folder overrides; only written on Save. */
let draftOverrides = {};
/** Last persisted snapshot, used for dirty checks and Discard. */
let savedOverrides = {};
/** Draft Raindrop-only allowlist { [id]: { path } }. */
let draftAllowlist = {};
let savedAllowlist = {};
/** Last fetched Raindrop-only rows for the expandable list. */
let raindropOnlyRows = [];
let policiesStatusTimer = null;
/** One-way "After upload" choice restored when leaving bidirectional. */
let oneWayPolicyMemory = POLICY.SYNC_DELETE;

/* ---- settings ---- */

/**
 * Bidirectional implies keep-both globally. One-way shows the after-upload
 * policy control. Folder overrides may still offload or exclude subtrees.
 * Raindrop→Edge folders select is bidirectional-only.
 */
function updateSyncModeUi(mode) {
  const bi = mode === SYNC_MODE.BIDIRECTIONAL;
  $("oneWayModeHelp").classList.toggle("hidden", bi);
  $("bidirectionalModeHelp").classList.toggle("hidden", !bi);
  $("bidirectionalWarn").classList.toggle("hidden", !bi);
  $("oneWayPolicyBlock").classList.toggle("hidden", bi);
  $("bidirectionalPolicyBlock").classList.toggle("hidden", !bi);
  $("reconcile").classList.toggle("hidden", !bi);
  $("reconcileLine").classList.toggle("hidden", !bi);

  if (bi) {
    $("defaultPolicy").value = POLICY.SYNC_KEEP;
    updateFolderModeHelp($("raindropFolderMode").value);
    $("raindropOnlySection").classList.remove("hidden");
  } else {
    $("defaultPolicy").value = oneWayPolicyMemory;
    $("raindropOnlySection").classList.add("hidden");
  }
}

function updateFolderModeHelp(mode) {
  const m = mode || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED;
  $("folderModeHelpExisting").classList.toggle("hidden", m !== RAINDROP_FOLDER_MODE.EXISTING_ONLY);
  $("folderModeHelpCreate").classList.toggle("hidden", m !== RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED);
  $("folderModeHelpMirror").classList.toggle("hidden", m !== RAINDROP_FOLDER_MODE.MIRROR_ALL);
}

function effectiveDefaultPolicy(syncMode) {
  if (syncMode === SYNC_MODE.BIDIRECTIONAL) return POLICY.SYNC_KEEP;
  return $("defaultPolicy").value;
}

async function loadSettings() {
  const config = await getConfig();
  $("token").value = config.token || "";
  $("rootName").value = config.rootName || "";
  $("syncMode").value = config.syncMode || SYNC_MODE.ONE_WAY;
  $("defaultPolicy").value = config.defaultPolicy;
  $("pruneEmpty").checked = !!config.pruneEmpty;
  $("raindropFolderMode").value =
    config.raindropFolderMode || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED;

  const mode = $("syncMode").value;
  if (mode === SYNC_MODE.ONE_WAY) {
    oneWayPolicyMemory = config.defaultPolicy || POLICY.SYNC_DELETE;
  } else if (config.defaultPolicy && config.defaultPolicy !== POLICY.SYNC_KEEP) {
    // Stale global offload under bidirectional: remember it for one-way return,
    // but UI/save will coerce global default to keep.
    oneWayPolicyMemory = config.defaultPolicy;
  } else {
    oneWayPolicyMemory = POLICY.SYNC_DELETE;
  }
  updateSyncModeUi(mode);
}

async function saveSettings() {
  const previous = await getConfig();
  const syncMode = $("syncMode").value;
  const defaultPolicy = effectiveDefaultPolicy(syncMode);
  if (syncMode === SYNC_MODE.ONE_WAY) {
    oneWayPolicyMemory = defaultPolicy;
  }
  await setConfig({
    token: $("token").value.trim(),
    rootName: $("rootName").value.trim() || "Edge",
    syncMode,
    defaultPolicy,
    pruneEmpty: $("pruneEmpty").checked,
    raindropFolderMode: $("raindropFolderMode").value || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  });
  updateSyncModeUi(syncMode);
  if (syncMode === SYNC_MODE.BIDIRECTIONAL) {
    refreshRaindropOnlyList().catch(() => {});
  }
  $("saveStatus").textContent = "Saved.";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);

  // First switch into bidirectional: kick an immediate reconcile.
  if (syncMode === SYNC_MODE.BIDIRECTIONAL && previous.syncMode !== SYNC_MODE.BIDIRECTIONAL) {
    runReconcile("Starting initial reconcile…");
  }
}

async function testToken() {
  const token = $("token").value.trim();
  const out = $("tokenStatus");
  if (!token) {
    out.textContent = "Enter a token first.";
    return;
  }
  out.textContent = "Checking…";
  try {
    const user = await new RaindropClient(token).getUser();
    out.textContent = `OK — ${user.fullName || user.email || "authenticated"}.`;
  } catch (err) {
    out.textContent = `Failed: ${err.message}`;
  }
}

/* ---- status + log ---- */

async function refreshStatus() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
  } catch {
    return;
  }
  if (!resp?.ok) return;

  $("pending").textContent = resp.pending ?? 0;
  const last = resp.status?.lastActivityAt;
  $("lastActivity").textContent = last ? new Date(last).toLocaleString() : "—";

  const rec = resp.reconcile?.lastRunAt;
  $("lastReconcile").textContent = rec ? new Date(rec).toLocaleString() : "—";
  if (resp.reconcile?.lastError) {
    $("lastReconcile").textContent += ` (error: ${resp.reconcile.lastError})`;
  }

  const banner = $("haltBanner");
  if (resp.status?.deletionsHalted && resp.status?.lastError) {
    banner.textContent = `Deletions halted: ${resp.status.lastError}. Jobs are kept and will retry once resolved.`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  const log = $("log");
  log.innerHTML = "";
  for (const entry of resp.log ?? []) {
    const li = document.createElement("li");
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = new Date(entry.at).toLocaleTimeString();
    const msg = document.createElement("span");
    msg.className = `lvl-${entry.level}`;
    msg.textContent = entry.message;
    li.append(ts, msg);
    log.append(li);
  }
}

async function runBackfill() {
  $("backfillStatus").textContent = "Queuing…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RUN_BACKFILL });
    $("backfillStatus").textContent = resp?.ok
      ? `Queued ${resp.queued} of ${resp.scanned} scanned.`
      : `Failed: ${resp?.error}`;
  } catch (err) {
    $("backfillStatus").textContent = `Failed: ${err.message}`;
  }
  refreshStatus();
}

async function runReconcile(pendingMsg) {
  $("backfillStatus").textContent = pendingMsg || "Reconciling…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RECONCILE_NOW });
    $("backfillStatus").textContent = resp?.ok
      ? `Reconcile: queued ${resp.enqueued ?? 0} (done=${resp.done}).`
      : `Failed: ${resp?.error}`;
  } catch (err) {
    $("backfillStatus").textContent = `Failed: ${err.message}`;
  }
  refreshStatus();
}

/* ---- folder policy editor (draft until Save) ---- */

function cloneOverrides(overrides) {
  return structuredClone(overrides ?? {});
}

function cloneAllowlist(allowlist) {
  return structuredClone(allowlist ?? {});
}

function overridesEqual(a, b) {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    const left = a[keysA[i]];
    const right = b[keysB[i]];
    if (left?.policy !== right?.policy || left?.path !== right?.path) return false;
  }
  return true;
}

function allowlistsEqual(a, b) {
  const keysA = Object.keys(a || {}).sort();
  const keysB = Object.keys(b || {}).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if ((a[keysA[i]]?.path || "") !== (b[keysB[i]]?.path || "")) return false;
  }
  return true;
}

function policiesDirty() {
  return (
    !overridesEqual(draftOverrides, savedOverrides) ||
    !allowlistsEqual(draftAllowlist, savedAllowlist)
  );
}

function updatePoliciesUi(statusText) {
  const dirty = policiesDirty();
  $("savePolicies").disabled = !dirty;
  $("discardPolicies").disabled = !dirty;
  $("clearRaindropOnly").disabled = Object.keys(draftAllowlist).length === 0;
  if (statusText !== undefined) {
    $("policiesStatus").textContent = statusText;
    return;
  }
  $("policiesStatus").textContent = dirty ? "Unsaved changes" : "";
}

function flashPoliciesStatus(text) {
  if (policiesStatusTimer) clearTimeout(policiesStatusTimer);
  updatePoliciesUi(text);
  policiesStatusTimer = setTimeout(() => {
    policiesStatusTimer = null;
    updatePoliciesUi();
  }, 1500);
}

function applyDraftChange(folderId, policy, path) {
  if (policy === "inherit") {
    delete draftOverrides[folderId];
  } else {
    draftOverrides[folderId] = { policy, path };
  }
  updatePoliciesUi();
}

function setAllowlistChecked(collectionId, path, checked) {
  const id = String(collectionId);
  if (checked) {
    draftAllowlist[id] = { path };
  } else {
    delete draftAllowlist[id];
  }
  paintRaindropOnlyList();
  updatePoliciesUi();
}

/** Clear draft Raindrop-only allowlist (Save folder policies to persist). */
function clearRaindropOnlySelection() {
  if (Object.keys(draftAllowlist).length === 0) return;
  draftAllowlist = {};
  paintRaindropOnlyList();
  updatePoliciesUi();
}

async function renderTree() {
  const [overrides, allowlist, tree] = await Promise.all([
    getOverrides(),
    getRaindropFolderAllowlist(),
    getTree(),
  ]);
  savedOverrides = cloneOverrides(overrides);
  draftOverrides = cloneOverrides(overrides);
  savedAllowlist = cloneAllowlist(allowlist);
  draftAllowlist = cloneAllowlist(allowlist);
  paintTree(tree);
  updatePoliciesUi();
  const config = await getConfig();
  if (config.syncMode === SYNC_MODE.BIDIRECTIONAL) {
    refreshRaindropOnlyList().catch(() => {});
  }
}

function paintTree(tree) {
  const container = $("tree");
  container.innerHTML = "";

  const rows = [];
  const walk = (node, depth, pathSegments) => {
    for (const child of node.children ?? []) {
      if (child.url) continue;
      const path = [...pathSegments, child.title];
      rows.push(buildRow(child, depth, path));
      walk(child, depth + 1, path);
    }
  };
  for (const root of tree) walk(root, 0, []);

  if (rows.length === 0) {
    container.textContent = "No folders found.";
    return;
  }
  rows.forEach((r) => container.append(r));
}

function buildRow(folder, depth, path) {
  const row = document.createElement("div");
  row.className = "tree-row";
  const current = draftOverrides[folder.id]?.policy;
  if (current) row.classList.add("has-override");

  const name = document.createElement("div");
  name.className = "name";
  name.style.paddingLeft = `${depth * 18}px`;
  const title = document.createElement("div");
  title.textContent = folder.title || "(untitled)";
  const sub = document.createElement("div");
  sub.className = "path";
  sub.textContent = path.join(" / ");
  name.append(title, sub);

  const select = document.createElement("select");
  const inherit = new Option("Inherit", "inherit", !current, !current);
  select.append(inherit);
  for (const p of ALL_POLICIES) {
    select.append(new Option(POLICY_LABELS[p], p, current === p, current === p));
  }
  select.addEventListener("change", () => {
    applyDraftChange(folder.id, select.value, path.join(" / "));
    row.classList.toggle("has-override", select.value !== "inherit");
  });

  row.append(name, select);
  return row;
}

async function refreshRaindropOnlyList() {
  const status = $("raindropOnlyStatus");
  // Use the dropdown so the list loads before Settings are saved.
  if ($("syncMode").value !== SYNC_MODE.BIDIRECTIONAL) return;
  const config = await getConfig();
  if (!config.token) {
    status.textContent = "Add a Raindrop token in Settings to load collections.";
    raindropOnlyRows = [];
    paintRaindropOnlyList();
    return;
  }
  status.textContent = "Loading…";
  try {
    const client = new RaindropClient(config.token);
    const index = await buildCollectionIndex(client);
    const root = findRootCollection(index, config.rootName);
    if (!root) {
      status.textContent = `Root “${config.rootName}” not found in Raindrop yet.`;
      raindropOnlyRows = [];
      paintRaindropOnlyList();
      return;
    }
    const topRoots = await getTopRoots();
    const under = collectionsUnderRoot(index, root._id);

    // Heal sticky selective mode: drop allowlist ids that no longer cover any
    // Raindrop-only path (fully mirrored or gone from Raindrop).
    const pathExists = (relative) => mirrorPathExists(relative, config.rootName, topRoots);
    const draftPruned = await pruneAllowlist(draftAllowlist, index, root._id, pathExists);
    const savedPruned = await pruneAllowlist(savedAllowlist, index, root._id, pathExists);
    let pruneNote = "";
    if (draftPruned.removed > 0) {
      draftAllowlist = draftPruned.allowlist;
    }
    if (savedPruned.removed > 0) {
      savedAllowlist = savedPruned.allowlist;
      await setRaindropFolderAllowlist(savedAllowlist);
      pruneNote = ` · cleared ${savedPruned.removed} synced/stale`;
    }
    if (draftPruned.removed > 0 || savedPruned.removed > 0) {
      updatePoliciesUi();
    }

    const rows = [];
    for (const { collectionId, relativeSegments } of under) {
      // Skip the bare root collection (no relative path).
      if (!relativeSegments.length) continue;
      const exists = await pathExists(relativeSegments);
      if (exists) continue;
      const path = relativeSegments.join(" / ");
      const col = getById(index, collectionId);
      // Prefer Raindrop's raindrop count; fall back to "no child collections".
      const empty =
        col?.count != null
          ? Number(col.count) === 0
          : !(getByParent(index, collectionId)?.size);
      rows.push({
        id: String(collectionId),
        path,
        depth: relativeSegments.length - 1,
        empty,
        title: col?.title || relativeSegments[relativeSegments.length - 1],
      });
    }
    // Sort by path for stable indentation.
    rows.sort((a, b) => a.path.localeCompare(b.path));
    raindropOnlyRows = rows;
    // Keep a mini index for parent-covers-child UI (ids only).
    raindropOnlyRows._index = index;
    raindropOnlyRows._rootId = root._id;
    status.textContent = rows.length
      ? `${rows.length} Raindrop-only path(s)${pruneNote}`
      : `None — all under root are in Edge.${pruneNote}`;
    paintRaindropOnlyList();
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    raindropOnlyRows = [];
    paintRaindropOnlyList();
  }
}

function paintRaindropOnlyList() {
  const container = $("raindropOnlyList");
  container.innerHTML = "";
  if (!raindropOnlyRows.length) {
    container.textContent = "";
    return;
  }
  const index = raindropOnlyRows._index;
  const rootId = raindropOnlyRows._rootId;
  for (const row of raindropOnlyRows) {
    const el = document.createElement("div");
    el.className = "rd-row";
    el.style.paddingLeft = `${Math.max(0, row.depth) * 16}px`;

    const coveredByParent =
      index &&
      rootId != null &&
      isCollectionAllowed(row.id, index, rootId, draftAllowlist) &&
      !draftAllowlist[row.id];

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!draftAllowlist[row.id] || coveredByParent;
    cb.disabled = coveredByParent;
    cb.addEventListener("change", () => {
      setAllowlistChecked(row.id, row.path, cb.checked);
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.textContent = row.title;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = coveredByParent ? `${row.path} · included via parent` : row.path;
    meta.append(title, sub);

    const badge = document.createElement("span");
    badge.className = `rd-badge ${row.empty ? "empty" : "only"}`;
    badge.textContent = row.empty ? "empty" : "Raindrop only";

    el.append(cb, meta, badge);
    container.append(el);
  }
}

async function savePolicies() {
  if (!policiesDirty()) return;
  await setOverrides(cloneOverrides(draftOverrides));
  await setRaindropFolderAllowlist(cloneAllowlist(draftAllowlist));
  savedOverrides = cloneOverrides(draftOverrides);
  savedAllowlist = cloneAllowlist(draftAllowlist);
  flashPoliciesStatus("Saved.");
}

async function discardPolicies() {
  if (!policiesDirty()) return;
  draftOverrides = cloneOverrides(savedOverrides);
  draftAllowlist = cloneAllowlist(savedAllowlist);
  const tree = await getTree();
  paintTree(tree);
  paintRaindropOnlyList();
  updatePoliciesUi();
}

/* ---- wire up ---- */

$("save").addEventListener("click", saveSettings);
$("testToken").addEventListener("click", testToken);
$("backfill").addEventListener("click", runBackfill);
$("reconcile").addEventListener("click", () => runReconcile());
$("syncMode").addEventListener("change", () => {
  const mode = $("syncMode").value;
  if (mode === SYNC_MODE.BIDIRECTIONAL) {
    oneWayPolicyMemory = $("defaultPolicy").value || oneWayPolicyMemory;
    refreshRaindropOnlyList().catch(() => {});
  }
  updateSyncModeUi(mode);
});
$("raindropFolderMode").addEventListener("change", () => {
  updateFolderModeHelp($("raindropFolderMode").value);
});
$("defaultPolicy").addEventListener("change", () => {
  if ($("syncMode").value === SYNC_MODE.ONE_WAY) {
    oneWayPolicyMemory = $("defaultPolicy").value;
  }
});
$("savePolicies").addEventListener("click", savePolicies);
$("discardPolicies").addEventListener("click", discardPolicies);
$("refreshRaindropOnly").addEventListener("click", () => {
  refreshRaindropOnlyList();
});
$("clearRaindropOnly").addEventListener("click", clearRaindropOnlySelection);

window.addEventListener("beforeunload", (event) => {
  if (!policiesDirty()) return;
  event.preventDefault();
});

loadSettings();
renderTree();
refreshStatus();
setInterval(refreshStatus, 3000);
