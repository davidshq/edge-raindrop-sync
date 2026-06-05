// Options page logic. Reads/writes config and overrides directly (this is an
// extension page with the same permissions), and messages the service worker
// for backfill and status so work continues after the page closes.

import { ALL_POLICIES, POLICY } from "../lib/constants.js";
import { getConfig, setConfig, getOverrides, setOverride, clearOverride } from "../lib/store.js";
import { getTree } from "../lib/bookmarks.js";
import { RaindropClient } from "../lib/raindrop.js";

const $ = (id) => document.getElementById(id);

const POLICY_LABELS = {
  [POLICY.SYNC_DELETE]: "Sync & delete",
  [POLICY.SYNC_KEEP]: "Sync & keep",
  [POLICY.EXCLUDE]: "Exclude",
};

/* ---- settings ---- */

async function loadSettings() {
  const config = await getConfig();
  $("token").value = config.token || "";
  $("rootName").value = config.rootName || "";
  $("defaultPolicy").value = config.defaultPolicy;
  $("pruneEmpty").checked = !!config.pruneEmpty;
}

async function saveSettings() {
  await setConfig({
    token: $("token").value.trim(),
    rootName: $("rootName").value.trim() || "Edge",
    defaultPolicy: $("defaultPolicy").value,
    pruneEmpty: $("pruneEmpty").checked,
  });
  $("saveStatus").textContent = "Saved.";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);
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
    return; // worker waking up; try again next tick
  }
  if (!resp?.ok) return;

  $("pending").textContent = resp.pending ?? 0;
  const last = resp.status?.lastActivityAt;
  $("lastActivity").textContent = last ? new Date(last).toLocaleString() : "—";

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

/* ---- folder policy editor ---- */

async function renderTree() {
  const [overrides, tree] = await Promise.all([getOverrides(), getTree()]);
  const container = $("tree");
  container.innerHTML = "";

  const rows = [];
  const walk = (node, depth, pathSegments) => {
    for (const child of node.children ?? []) {
      if (child.url) continue; // folders only
      const path = [...pathSegments, child.title];
      rows.push(buildRow(child, depth, path, overrides));
      walk(child, depth + 1, path);
    }
  };
  for (const root of tree) walk(root, 0, []); // root id "0": children are top roots

  if (rows.length === 0) {
    container.textContent = "No folders found.";
    return;
  }
  rows.forEach((r) => container.append(r));
}

function buildRow(folder, depth, path, overrides) {
  const row = document.createElement("div");
  row.className = "tree-row";
  const current = overrides[folder.id]?.policy;
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
  select.addEventListener("change", async () => {
    if (select.value === "inherit") {
      await clearOverride(folder.id);
      row.classList.remove("has-override");
    } else {
      await setOverride(folder.id, select.value, path.join(" / "));
      row.classList.add("has-override");
    }
  });

  row.append(name, select);
  return row;
}

/* ---- wire up ---- */

$("save").addEventListener("click", saveSettings);
$("testToken").addEventListener("click", testToken);
$("backfill").addEventListener("click", runBackfill);

loadSettings();
renderTree();
refreshStatus();
setInterval(refreshStatus, 3000);
