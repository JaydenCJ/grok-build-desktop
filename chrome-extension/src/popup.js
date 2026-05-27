const tabList = document.getElementById("tab-list");
const refreshButton = document.getElementById("refresh");
const snapshotAllButton = document.getElementById("snapshot-all");
const trackButton = document.getElementById("track");
const controlButton = document.getElementById("control");
const bridgeStatus = document.getElementById("bridge-status");
const focusGuardInput = document.getElementById("focus-guard");
const visibleMotionInput = document.getElementById("visible-motion");
const controlledOnlyInput = document.getElementById("controlled-only");

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function formatAge(timestamp) {
  if (!timestamp) return "not scanned";
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function snapshotSummary(snapshot) {
  if (!snapshot) return "No page snapshot yet.";
  const heading = snapshot.headings?.find((item) => item.text)?.text;
  return heading || snapshot.description || snapshot.textSample || "Snapshot collected.";
}

function renderBridge(bridge = {}) {
  bridgeStatus.textContent = bridge.connected ? "Bridge live" : "Local bridge off";
  bridgeStatus.classList.toggle("connected", Boolean(bridge.connected));
  bridgeStatus.title = bridge.error || bridge.host || "";
}

function renderSettings(settings = {}) {
  focusGuardInput.checked = settings.focusGuard !== false;
  visibleMotionInput.checked = settings.visibleMotion !== false;
  controlledOnlyInput.checked = settings.controlledTabsOnly !== false;
}

async function updateSettings() {
  const response = await send({
    type: "GROK_DESKTOP_SET_SETTINGS",
    settings: {
      focusGuard: focusGuardInput.checked,
      visibleMotion: visibleMotionInput.checked,
      controlledTabsOnly: controlledOnlyInput.checked,
    },
  });
  renderSettings(response.settings);
  await render();
}

function tabCard(tab) {
  const card = document.createElement("article");
  card.className = "tab-card";

  const meta = document.createElement("div");
  meta.className = "tab-meta";

  const status = document.createElement("span");
  status.className = `status ${tab.status}`;
  status.textContent = tab.status;

  const age = document.createElement("span");
  age.className = "age";
  age.textContent = formatAge(tab.snapshot?.updatedAt || tab.updatedAt);

  meta.append(status, age);

  const title = document.createElement("strong");
  title.textContent = tab.title || "Untitled";

  const url = document.createElement("small");
  url.textContent = tab.url || "";

  const snapshot = document.createElement("p");
  snapshot.className = "snapshot";
  snapshot.textContent = snapshotSummary(tab.snapshot);

  const actions = document.createElement("div");
  actions.className = "tab-actions";

  const scan = document.createElement("button");
  scan.textContent = "Scan";
  scan.addEventListener("click", async () => {
    scan.disabled = true;
    scan.textContent = "Scanning";
    await send({ type: "GROK_DESKTOP_SNAPSHOT_TAB", tabId: tab.id });
    await render();
  });

  const cursor = document.createElement("button");
  cursor.textContent = "Cursor";
  cursor.addEventListener("click", () => {
    send({
      type: "GROK_DESKTOP_PULSE_CURSOR",
      tabId: tab.id,
      payload: {
        x: 140,
        y: 120,
        label: "Grok Desktop",
        visible: true,
        duration: 1800,
        animate: true,
        motionMs: 680
      }
    });
  });

  const toggle = document.createElement("button");
  toggle.textContent = tab.status === "controlling" ? "Watch" : "Control";
  toggle.addEventListener("click", async () => {
    await send({
      type: "GROK_DESKTOP_SET_TAB_STATUS",
      tabId: tab.id,
      status: tab.status === "controlling" ? "watching" : "controlling"
    });
    await render();
  });

  const stop = document.createElement("button");
  stop.textContent = "Stop";
  stop.addEventListener("click", async () => {
    await send({ type: "GROK_DESKTOP_UNTRACK_TAB", tabId: tab.id });
    await render();
  });

  actions.append(scan, cursor, toggle, stop);
  card.append(meta, title, url, snapshot, actions);
  return card;
}

async function render() {
  const response = await send({ type: "GROK_DESKTOP_GET_STATE" });
  renderBridge(response.bridge);
  renderSettings(response.settings);
  const tabs = Object.values(response.tabs || {}).sort((a, b) => b.updatedAt - a.updatedAt);

  tabList.textContent = "";
  if (!tabs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No monitored tabs yet.";
    tabList.append(empty);
    return;
  }

  for (const tab of tabs) {
    tabList.append(tabCard(tab));
  }
}

trackButton.addEventListener("click", async () => {
  await send({ type: "GROK_DESKTOP_TRACK_ACTIVE_TAB", status: "watching" });
  await render();
});

controlButton.addEventListener("click", async () => {
  await send({ type: "GROK_DESKTOP_TRACK_ACTIVE_TAB", status: "controlling" });
  await render();
});

snapshotAllButton.addEventListener("click", async () => {
  snapshotAllButton.disabled = true;
  snapshotAllButton.textContent = "Scanning";
  await send({ type: "GROK_DESKTOP_SNAPSHOT_ALL" });
  snapshotAllButton.textContent = "Scan all";
  snapshotAllButton.disabled = false;
  await render();
});

refreshButton.addEventListener("click", render);
focusGuardInput.addEventListener("change", updateSettings);
visibleMotionInput.addEventListener("change", updateSettings);
controlledOnlyInput.addEventListener("change", updateSettings);
render();
