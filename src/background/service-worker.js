// MV3 service worker — the always-on (but ephemeral) entry point.
//
// It does as little as possible: register listeners, enqueue on bookmark
// creation, and run the drain on events and on a heartbeat alarm. All real work
// and all state live in the lib modules and chrome.storage.

import { ALARM_NAME, HEARTBEAT_MINUTES } from "../lib/constants.js";
import { drain } from "../lib/sync.js";
import { startBackfill } from "../lib/backfill.js";
import * as queue from "../lib/queue.js";
import { getStatus, getLog, appendLog } from "../lib/store.js";

function ensureHeartbeat() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureHeartbeat();
  appendLog("info", "Extension installed; heartbeat scheduled.");
});

chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeat();
});

// Live capture: enqueue new bookmarks (URL nodes only) and kick the drain.
chrome.bookmarks.onCreated.addListener(async (id, node) => {
  if (!node.url) return; // folders are mirrored lazily when a bookmark needs them
  await queue.enqueue(id);
  drain();
});

// Heartbeat: drains pending/retryable jobs even with no bookmark activity.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) drain();
});

// Message API for the options page and popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "runBackfill": {
          const result = await startBackfill();
          drain();
          sendResponse({ ok: true, ...result });
          break;
        }
        case "drainNow": {
          drain();
          sendResponse({ ok: true });
          break;
        }
        case "getStatus": {
          sendResponse({
            ok: true,
            status: await getStatus(),
            pending: await queue.size(),
            log: await getLog(),
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
