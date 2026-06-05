// Durable job queue, persisted entirely in chrome.storage.local.
//
// A "job" is just a bookmark id to sync plus retry metadata:
//   { id, attempts, nextAttemptAt }
// Nothing here relies on in-memory state, so a worker restart mid-drain simply
// leaves jobs in place for the next drain. Enqueue is idempotent per id, so the
// same bookmark is never queued twice.

import { KEY, BASE_BACKOFF_MS, MAX_BACKOFF_MS } from "./constants.js";
import { _read, _write } from "./store.js";

async function readQueue() {
  return _read(KEY.QUEUE, []);
}

async function writeQueue(jobs) {
  await _write(KEY.QUEUE, jobs);
}

export async function list() {
  return readQueue();
}

export async function size() {
  return (await readQueue()).length;
}

export async function enqueue(id) {
  const jobs = await readQueue();
  if (jobs.some((j) => j.id === id)) return false; // already queued
  jobs.push({ id, attempts: 0, nextAttemptAt: 0 });
  await writeQueue(jobs);
  return true;
}

export async function enqueueMany(ids) {
  const jobs = await readQueue();
  const known = new Set(jobs.map((j) => j.id));
  let added = 0;
  for (const id of ids) {
    if (known.has(id)) continue;
    jobs.push({ id, attempts: 0, nextAttemptAt: 0 });
    known.add(id);
    added++;
  }
  await writeQueue(jobs);
  return added;
}

export async function remove(id) {
  const jobs = await readQueue();
  await writeQueue(jobs.filter((j) => j.id !== id));
}

// Jobs whose backoff window has elapsed, in queue order.
export async function due(now) {
  const jobs = await readQueue();
  return jobs.filter((j) => (j.nextAttemptAt ?? 0) <= now);
}

// Defer a job with exponential backoff (used for transient/unknown errors).
export async function defer(id, now) {
  const jobs = await readQueue();
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  job.attempts = (job.attempts ?? 0) + 1;
  const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (job.attempts - 1), MAX_BACKOFF_MS);
  job.nextAttemptAt = now + backoff;
  await writeQueue(jobs);
}

// Defer a job by an explicit delay (used for rate-limit Retry-After).
export async function deferUntil(id, until) {
  const jobs = await readQueue();
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  job.nextAttemptAt = until;
  await writeQueue(jobs);
}

export async function clear() {
  await writeQueue([]);
}
