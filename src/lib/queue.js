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

export async function list() {
  return readQueue();
}

export async function size() {
  return (await readQueue()).length;
}

/** Enqueue an upload job for a bookmark id (backward-compatible). */
export async function enqueue(id) {
  return enqueueJob({ id, kind: JOB.UPLOAD });
}

export async function enqueueJob(job) {
  return withLock(async () => {
    const jobs = await readQueue();
    if (jobs.some((j) => j.id === job.id)) return false;
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

export async function enqueueMany(ids) {
  return withLock(async () => {
    const jobs = await readQueue();
    const known = new Set(jobs.map((j) => j.id));
    let added = 0;
    for (const id of ids) {
      if (known.has(id)) continue;
      jobs.push({ id, kind: JOB.UPLOAD, attempts: 0, nextAttemptAt: 0 });
      known.add(id);
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

// Jobs whose backoff window has elapsed, in queue order.
export async function due(now) {
  const jobs = await readQueue();
  return jobs.filter((j) => (j.nextAttemptAt ?? 0) <= now);
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
