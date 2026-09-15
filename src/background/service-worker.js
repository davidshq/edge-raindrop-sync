// MV3 service worker — the always-on (but ephemeral) entry point.
//
// It does as little as possible: register listeners, enqueue on bookmark
// events, and run drain/reconcile on events and on a heartbeat alarm. All real
// work and all state live in the lib modules and chrome.storage.
//
// Async handlers await (or chain) their work so Chromium keeps the worker
// alive through fetch/storage. The heartbeat is (re)created on every SW
// evaluation, not only onInstalled/onStartup.

import { ALARM_NAME, HEARTBEAT_MINUTES, MSG } from "../lib/constants.js";
import {
  tick,
  drain,
  reconcileNow,
  handleBookmarkCreated,
  handleBookmarkRemoved,
} from "../lib/sync.js";
import { startBackfill } from "../lib/backfill.js";
import * as queue from "../lib/queue.js";
import {
  getStatus,
  getLog,
  appendLog,
  getReconcileState,
  getConfig,
  ensurePairsMigrated,
} from "../lib/store.js";

function ensureHeartbeat() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_MINUTES });
}

function logSwError(context, err) {
  const message = err?.message || String(err);
  console.error(`[ers] ${context}:`, err);
  return appendLog("error", `${context}: ${message}`);
}

// Recreate the alarm whenever this worker starts — not only on install/startup.
ensureHeartbeat();

chrome.runtime.onInstalled.addListener(() => {
  ensureHeartbeat();
  void ensurePairsMigrated();
  void appendLog("info", "Extension installed; heartbeat scheduled.");
});

chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeat();
  void ensurePairsMigrated();
});

// Live capture: enqueue new bookmarks (URL nodes only) unless pull-suppressed.
chrome.bookmarks.onCreated.addListener((id, node) => {
  void handleBookmarkCreated(id, node).catch((err) => logSwError("onCreated", err));
});

// User deletes: propagate to Raindrop when bidirectional (unless policy-suppressed).
chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  void handleBookmarkRemoved(id, removeInfo).catch((err) => logSwError("onRemoved", err));
});

// Heartbeat: drain + bidirectional reconcile.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  void tick().catch((err) => logSwError("heartbeat", err));
});

// Message API for the options page and popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case MSG.RUN_BACKFILL: {
          const result = await startBackfill();
          await drain();
          sendResponse({ ok: true, ...result });
          break;
        }
        case MSG.DRAIN_NOW: {
          await drain();
          sendResponse({ ok: true });
          break;
        }
        case MSG.RECONCILE_NOW: {
          // Goes through sync.reconcileNow so RateLimitError sets the global gate
          // (same path as heartbeat), not only a UI error string.
          const result = await reconcileNow();
          sendResponse({ ok: true, ...result });
          break;
        }
        case MSG.GET_STATUS: {
          const config = await getConfig();
          sendResponse({
            ok: true,
            status: await getStatus(),
            pending: await queue.size(),
            log: await getLog(),
            reconcile: await getReconcileState(),
            syncMode: config.syncMode,
          });
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the channel open for the async sendResponse
});
