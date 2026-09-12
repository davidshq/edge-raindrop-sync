// In-process async mutex for chrome.storage.local read-modify-write.
//
// chrome.storage.local has no transactions: concurrent get→mutate→set on the
// same key can drop updates (e.g. drain remove overwriting an interleaved
// enqueue). One SW instance is the only writer process we care about; chaining
// mutations through this lock is enough for that model.

let tail = Promise.resolve();

/**
 * Run `fn` exclusively relative to other withLock callers in this worker.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withLock(fn) {
  const run = tail.then(() => fn());
  // Keep the chain alive even when fn rejects so later callers are not stuck.
  tail = run.then(
    () => {},
    () => {},
  );
  return run;
}
