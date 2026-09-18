// Durable job queue, persisted entirely in chrome.storage.local.
//
// Jobs are typed:
//   { id, kind, attempts, nextAttemptAt, ...payload }
// Legacy jobs with only `{ id }` are treated as upload jobs (id = bookmarkId).
// Enqueue is idempotent per job id.
//
// Mutations go through withLock so drain/remove cannot race enqueue and drop jobs.

import { KEY, BASE_BACKOFF_MS, MAX_BACKOFF_MS, JOB } from "./constants.js";
import { _read, _write } from "./store.js";
import { withLock } from "./mutex.js";

async function readQueue() {
  return _read(KEY.QUEUE, []);
}

async function writeQueue(jobs) {
  await _write(KEY.QUEUE, jobs);
}

export function jobKind(job) {
  return job.kind || JOB.UPLOAD;
}

/**
 * Drain ordering: lower runs first. Folder renames before uploads so a pending
 * child upload does not ensureCollectionPath on the new title and orphan the
 * mapped collection (create-new instead of in-place rename).
 */
export function drainJobPriority(kind) {
  return kind === JOB.RENAME_COLLECTION ? 0 : 1;
}

export async function list() {
  return readQueue();
}

export async function size() {
  return (await readQueue()).length;
}

/**
 * Enqueue an upload job for a bookmark id (backward-compatible).
 * @param {string} id bookmark id
 * @param {{ reason?: "move"|"change" }} [opts] activity hint for paired drain
 */
export async function enqueue(id, { reason } = {}) {
  return enqueueJob({ id, kind: JOB.UPLOAD, ...(reason ? { reason } : {}) });
}

export async function enqueueJob(job) {
  return withLock(async () => {
    const jobs = await readQueue();
    const existing = jobs.find((j) => j.id === job.id);
    if (existing) {
      // Promote activity hint when a move coalesces with an earlier change.
      if (job.reason === "move") existing.reason = "move";
      else if (job.reason && !existing.reason) existing.reason = job.reason;
      await writeQueue(jobs);
      return false;
    }
    jobs.push({
      attempts: 0,
      nextAttemptAt: 0,
      kind: JOB.UPLOAD,
      ...job,
    });
    await writeQueue(jobs);
    return true;
  });
}

/**
 * @param {string[]} ids
 * @param {{ reason?: "move"|"change" }} [opts]
 */
export async function enqueueMany(ids, { reason } = {}) {
  return withLock(async () => {
    const jobs = await readQueue();
    const byId = new Map(jobs.map((j) => [j.id, j]));
    let added = 0;
    for (const id of ids) {
      const existing = byId.get(id);
      if (existing) {
        if (reason === "move") existing.reason = "move";
        else if (reason && !existing.reason) existing.reason = reason;
        continue;
      }
      const job = {
        id,
        kind: JOB.UPLOAD,
        attempts: 0,
        nextAttemptAt: 0,
        ...(reason ? { reason } : {}),
      };
      jobs.push(job);
      byId.set(id, job);
      added++;
    }
    await writeQueue(jobs);
    return added;
  });
}

export async function remove(id) {
  return withLock(async () => {
    const jobs = await readQueue();
    await writeQueue(jobs.filter((j) => j.id !== id));
  });
}

// Jobs whose backoff window has elapsed. Folder renames are sorted ahead of
// other kinds so in-place collection rename wins over title-based path ensure.
export async function due(now) {
  const jobs = await readQueue();
  return jobs
    .filter((j) => (j.nextAttemptAt ?? 0) <= now)
    .sort((a, b) => drainJobPriority(jobKind(a)) - drainJobPriority(jobKind(b)));
}

// Defer a job with exponential backoff (used for transient/unknown errors).
export async function defer(id, now) {
  return withLock(async () => {
    const jobs = await readQueue();
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    job.attempts = (job.attempts ?? 0) + 1;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (job.attempts - 1), MAX_BACKOFF_MS);
    job.nextAttemptAt = now + backoff;
    await writeQueue(jobs);
  });
}

// Defer a job by an explicit delay (used for rate-limit Retry-After).
export async function deferUntil(id, until) {
  return withLock(async () => {
    const jobs = await readQueue();
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    job.nextAttemptAt = until;
    await writeQueue(jobs);
  });
}

/**
 * Push every currently-due job out to `until` so a rate-limit pause does not
 * leave a stampede of due work the moment the window opens (or on the next tick).
 * @param {number} until epoch ms
 * @param {number} [now]
 */
export async function deferAllDueUntil(until, now = Date.now()) {
  return withLock(async () => {
    const jobs = await readQueue();
    let changed = false;
    for (const job of jobs) {
      if ((job.nextAttemptAt ?? 0) <= now) {
        job.nextAttemptAt = until;
        changed = true;
      }
    }
    if (changed) await writeQueue(jobs);
  });
}

export async function clear() {
  return withLock(async () => {
    await writeQueue([]);
  });
}
