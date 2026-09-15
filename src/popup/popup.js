// Popup: compact status and quick actions. Delegates to the service worker.

import { MSG, SYNC_MODE } from "../lib/constants.js";

const $ = (id) => document.getElementById(id);

async function refresh() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
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
  const rateUntil = resp.status?.rateLimitedUntil;
  if (rateUntil && rateUntil > Date.now()) {
    halt.textContent = `Rate limited until ${new Date(rateUntil).toLocaleTimeString()}`;
    halt.classList.remove("hidden");
  } else if (resp.status?.deletionsHalted && resp.status?.lastError) {
    halt.textContent = resp.status.lastError;
    halt.classList.remove("hidden");
  } else {
    halt.classList.add("hidden");
  }
}

$("backfill").addEventListener("click", async () => {
  $("msg").textContent = "Queuing backfill…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RUN_BACKFILL });
    $("msg").textContent = resp?.ok ? `Queued ${resp.queued}.` : `Failed: ${resp?.error}`;
  } catch (err) {
    $("msg").textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("reconcile").addEventListener("click", async () => {
  $("msg").textContent = "Reconciling…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RECONCILE_NOW });
    if (!resp?.ok) {
      $("msg").textContent = `Failed: ${resp?.error}`;
    } else if (resp.skipped) {
      if (resp.reason === "rate_limited") {
        $("msg").textContent = "Paused for Raindrop rate limits — try again shortly.";
      } else if (resp.reason === "cooldown") {
        $("msg").textContent = "Reconcile on cooldown — try again later.";
      } else {
        $("msg").textContent = "Already running — try again shortly.";
      }
    } else if (!resp.done) {
      $("msg").textContent =
        `Scanning… queued ${resp.enqueued ?? 0} (more pages; open Options to run to completion).`;
    } else {
      $("msg").textContent =
        (resp.enqueued ?? 0) > 0
          ? `Finished: queued ${resp.enqueued} pull(s).`
          : "Finished (no new pulls).";
    }
  } catch (err) {
    $("msg").textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
setInterval(refresh, 2000);
