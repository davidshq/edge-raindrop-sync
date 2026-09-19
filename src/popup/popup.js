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
  $("title").textContent = bi ? "Edge ↔ Raindrop" : "Edge → Raindrop";
  $("modeLine").textContent = bi ? "Mode: bidirectional" : "Mode: one-way";
  $("pullAction").classList.toggle("hidden", !bi);

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
  const out = $("importStatus");
  out.textContent = "Queuing Edge bookmarks…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RUN_BACKFILL });
    out.textContent = resp?.ok
      ? `Queued ${resp.queued} Edge bookmark(s).`
      : `Failed: ${resp?.error}`;
  } catch (err) {
    out.textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("reconcile").addEventListener("click", async () => {
  const out = $("pullStatus");
  out.textContent = "Pulling from Raindrop…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG.RECONCILE_NOW });
    if (!resp?.ok) {
      out.textContent = `Failed: ${resp?.error}`;
    } else if (resp.skipped) {
      if (resp.reason === "rate_limited") {
        out.textContent = "Paused for Raindrop rate limits — try Pull now again shortly.";
      } else if (resp.reason === "cooldown") {
        out.textContent = "Pull is on cooldown — try again later.";
      } else {
        out.textContent = "A pull is already running — try again shortly.";
      }
    } else if (!resp.done) {
      out.textContent =
        `Scanning… queued ${resp.enqueued ?? 0}. Open Settings to run the pull to completion.`;
    } else {
      out.textContent =
        (resp.enqueued ?? 0) > 0
          ? `Pull finished: queued ${resp.enqueued} Raindrop change(s).`
          : "Pull finished. Nothing new to bring into Edge.";
    }
  } catch (err) {
    out.textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
setInterval(refresh, 2000);
