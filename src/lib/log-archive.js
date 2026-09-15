// Opt-in long-term activity archive in IndexedDB.
//
// Recent activity stays in chrome.storage.local (LOG_LIMIT). When the user
// enables keepLongTermLog, appendLog also writes here so history survives
// past the recent ring buffer. Export/clear run from the options page.
// Failures must not break sync — callers catch and continue.

import { LOG_ARCHIVE_LIMIT } from "./constants.js";

const DB_NAME = "ers-activity-log";
const DB_VERSION = 1;
const STORE = "entries";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("at", "at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

/**
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function waitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Append one activity line and prune oldest entries if over LOG_ARCHIVE_LIMIT.
 * @param {{ at: number, level: string, message: string }} entry
 */
export async function appendArchiveEntry(entry) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.add({
      at: entry.at,
      level: entry.level,
      message: entry.message,
    });
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - LOG_ARCHIVE_LIMIT;
      if (excess <= 0) return;
      let deleted = 0;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || deleted >= excess) return;
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
    };
    await waitTx(tx);
  } finally {
    db.close();
  }
}

/** @returns {Promise<number>} */
export async function countArchiveEntries() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const count = await reqToPromise(tx.objectStore(STORE).count());
    await waitTx(tx);
    return count;
  } finally {
    db.close();
  }
}

/**
 * All archive rows for JSON export (id omitted).
 * @returns {Promise<Array<{ at: number, level: string, message: string }>>}
 */
export async function exportArchiveEntries() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    /** @type {Array<{ at: number, level: string, message: string, id?: number }>} */
    const all = await reqToPromise(tx.objectStore(STORE).getAll());
    await waitTx(tx);
    return all.map(({ at, level, message }) => ({ at, level, message }));
  } finally {
    db.close();
  }
}

/** Remove every archived entry. Recent storage.local log is untouched. */
export async function clearArchive() {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await waitTx(tx);
  } finally {
    db.close();
  }
}
