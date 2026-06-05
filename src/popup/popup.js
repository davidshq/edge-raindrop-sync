// Popup: compact status and quick actions. Delegates to the service worker.

const $ = (id) => document.getElementById(id);

async function refresh() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "getStatus" });
  } catch {
    return;
  }
  if (!resp?.ok) return;

  $("pending").textContent = resp.pending ?? 0;
  const last = resp.status?.lastActivityAt;
  $("lastActivity").textContent = last
    ? `Last sync ${new Date(last).toLocaleTimeString()}`
    : "No syncs yet";

  const halt = $("halt");
  if (resp.status?.deletionsHalted && resp.status?.lastError) {
    halt.textContent = resp.status.lastError;
    halt.classList.remove("hidden");
  } else {
    halt.classList.add("hidden");
  }
}

$("backfill").addEventListener("click", async () => {
  $("msg").textContent = "Queuing backfill…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "runBackfill" });
    $("msg").textContent = resp?.ok ? `Queued ${resp.queued}.` : `Failed: ${resp?.error}`;
  } catch (err) {
    $("msg").textContent = `Failed: ${err.message}`;
  }
  refresh();
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

refresh();
setInterval(refresh, 2000);
