// Options page logic. Reads/writes config and overrides directly (this is an
// extension page with the same permissions), and messages the service worker
// for backfill, reconcile, and status so work continues after the page closes.
// Folder-policy edits are held in a draft until "Save folder policies" so a
// parent change cannot surprise-apply to children mid-edit.

import { ALL_POLICIES, POLICY, SYNC_MODE, RAINDROP_FOLDER_MODE } from "../lib/constants.js";
import { getConfig, setConfig, getOverrides, setOverrides } from "../lib/store.js";
import { getTree } from "../lib/bookmarks.js";
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
  } else {
    $("defaultPolicy").value = oneWayPolicyMemory;
  }
}

function updateFolderModeHelp(mode) {
  const m = mode || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED;
  $("folderModeHelpExisting").classList.toggle(
    "hidden",
    m !== RAINDROP_FOLDER_MODE.EXISTING_ONLY,
  );
  $("folderModeHelpCreate").classList.toggle(
    "hidden",
    m !== RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  );
  $("folderModeHelpMirror").classList.toggle(
    "hidden",
    m !== RAINDROP_FOLDER_MODE.MIRROR_ALL,
  );
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
    raindropFolderMode:
      $("raindropFolderMode").value || RAINDROP_FOLDER_MODE.CREATE_AS_NEEDED,
  });
  updateSyncModeUi(syncMode);
  $("saveStatus").textContent = "Saved.";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);

  // First switch into bidirectional: kick an immediate reconcile.
  if (
    syncMode === SYNC_MODE.BIDIRECTIONAL &&
    previous.syncMode !== SYNC_MODE.BIDIRECTIONAL
  ) {
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
    resp = await chrome.runtime.sendMessage({ type: "getStatus" });
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
    const resp = await chrome.runtime.sendMessage({ type: "runBackfill" });
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
    const resp = await chrome.runtime.sendMessage({ type: "reconcileNow" });
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

function policiesDirty() {
  return !overridesEqual(draftOverrides, savedOverrides);
}

function updatePoliciesUi(statusText) {
  const dirty = policiesDirty();
  $("savePolicies").disabled = !dirty;
  $("discardPolicies").disabled = !dirty;
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

async function renderTree() {
  const [overrides, tree] = await Promise.all([getOverrides(), getTree()]);
  savedOverrides = cloneOverrides(overrides);
  draftOverrides = cloneOverrides(overrides);
  paintTree(tree);
  updatePoliciesUi();
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

async function savePolicies() {
  if (!policiesDirty()) return;
  await setOverrides(cloneOverrides(draftOverrides));
  savedOverrides = cloneOverrides(draftOverrides);
  flashPoliciesStatus("Saved.");
}

async function discardPolicies() {
  if (!policiesDirty()) return;
  draftOverrides = cloneOverrides(savedOverrides);
  const tree = await getTree();
  paintTree(tree);
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

window.addEventListener("beforeunload", (event) => {
  if (!policiesDirty()) return;
  event.preventDefault();
});

loadSettings();
renderTree();
refreshStatus();
setInterval(refreshStatus, 3000);
