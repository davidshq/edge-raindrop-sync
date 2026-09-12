// Popup: compact status and quick actions. Delegates to the service worker.

import { SYNC_MODE } from "../lib/constants.js";

const $ = (id) => document.getElementById(id);

async function refresh() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "getStatus" });
  } catch {
    return;
  }
  if (!resp?.ok) return;

  $("pending").textContent = resp.pending ?? 0;
  const last = resp.status?.lastActivityAt;
  $("lastActivity").textContent = last
    ? `Last sync ${new Date(last).toLocaleTimeString()}`
    : "No syncs yet";

  const bi = resp.syncMode === SYNC_MODE.BIDIRECTIONAL;
  $("modeLine").textContent = bi ? "Mode: bidirectional" : "Mode: one-way";
  $("reconcile").classList.toggle("hidden", !bi);

  const halt = $("halt");
  if (resp.status?.deletionsHalted && resp.status?.lastError) {
    halt.textContent = resp.status.lastError;
    halt.classList.remove("hidden");
  } else {
    halt.classList.add("hidden");
  }
}

$("backfill").addEventListener("click", async () => {
  $("msg").textContent = "Queuing backfill…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "runBackfill" });
    $("msg").textContent = resp?.ok ? `Queued ${resp.queued}.` : `Failed: ${resp?.error}`;
  } catch (err) {
    $("msg").textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("reconcile").addEventListener("click", async () => {
  $("msg").textContent = "Reconciling…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "reconcileNow" });
    $("msg").textContent = resp?.ok
      ? `Reconcile queued ${resp.enqueued ?? 0}.`
      : `Failed: ${resp?.error}`;
  } catch (err) {
    $("msg").textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
setInterval(refresh, 2000);
