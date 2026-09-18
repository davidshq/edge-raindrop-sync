// Shared Auth / rate-limit handling for drain and reconcile orchestration.
// On rate limit: set a global pause, defer all due jobs, abort the current loop.

import { setStatus, appendLog, noteRateLimitedUntil } from "./store.js";
import * as queue from "./queue.js";
import { AuthError, RateLimitError } from "./raindrop.js";

/**
 * @returns {Promise<boolean>} true if the caller should abort the current loop
 */
export async function handleClientError(err, { job } = {}) {
  if (err instanceof AuthError) {
    await setStatus({ deletionsHalted: true, lastError: err.message });
    await appendLog("error", `${err.message} — deletions halted, jobs kept.`);
    if (job) await setStatus({ pending: await queue.size() });
    return true;
  }
  if (err instanceof RateLimitError) {
    const entered = await noteRateLimitedUntil(err.retryAt);
    if (job) await queue.deferUntil(job.id, err.retryAt);
    await queue.deferAllDueUntil(err.retryAt);
    await setStatus({ pending: await queue.size() });
    if (entered) {
      const kind = err.proactive ? "budget low" : "HTTP 429";
      await appendLog(
        "warn",
        `Raindrop rate limit (${kind}); pausing API calls until ${new Date(err.retryAt).toISOString()}.`
      );
    }
    return true;
  }
  return false;
}
