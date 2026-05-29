// Grok Build Chrome companion — command panel popup.
const $ = (id) => document.getElementById(id);
const tabList = $("tab-list");
const bridgeStatus = $("bridge-status");
const riskBanner = $("risk-banner");
const commandInput = $("command");
const execMode = $("exec-mode");
const execLabel = $("exec-label");
const controlButton = $("control");
const sendButton = $("send");
const trackButton = $("track");
const snapshotAllButton = $("snapshot-all");
const refreshButton = $("refresh");
const focusGuardInput = $("focus-guard");
const visibleMotionInput = $("visible-motion");
const controlledOnlyInput = $("controlled-only");

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function formatAge(ts) {
  if (!ts) return "not scanned";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function renderBridge(bridge = {}) {
  bridgeStatus.textContent = bridge.connected ? "bridge live" : "bridge off";
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
  renderSettings(response?.settings);
}

function tabCard(tab) {
  const card = document.createElement("article");
  card.className = `tab-card ${tab.status || ""}`;

  const row1 = document.createElement("div");
  row1.className = "row1";
  const dot = document.createElement("span");
  dot.className = "tab-dot";
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || "Untitled";
  const st = document.createElement("span");
  st.className = "tab-status";
  st.textContent = tab.status || "";
  row1.append(dot, title, st);

  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = (tab.url || "").replace(/^https?:\/\//, "");

  const actions = document.createElement("div");
  actions.className = "tab-actions";

  const toggle = document.createElement("button");
  toggle.textContent = tab.status === "controlling" ? "Watch" : "Control";
  toggle.addEventListener("click", async () => {
    await send({
      type: "GROK_DESKTOP_SET_TAB_STATUS",
      tabId: tab.id,
      status: tab.status === "controlling" ? "watching" : "controlling",
    });
    await render();
  });

  const scan = document.createElement("button");
  scan.textContent = "Scan";
  scan.addEventListener("click", async () => {
    scan.disabled = true;
    await send({ type: "GROK_DESKTOP_SNAPSHOT_TAB", tabId: tab.id });
    await render();
  });

  const stop = document.createElement("button");
  stop.textContent = "Stop";
  stop.addEventListener("click", async () => {
    await send({ type: "GROK_DESKTOP_UNTRACK_TAB", tabId: tab.id });
    await render();
  });

  actions.append(toggle, scan, stop);
  card.append(row1, url, actions);
  return card;
}

async function render() {
  const response = (await send({ type: "GROK_DESKTOP_GET_STATE" })) || {};
  renderBridge(response.bridge);
  renderSettings(response.settings);
  const tabs = Object.values(response.tabs || {}).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  );
  tabList.textContent = "";
  if (!tabs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No controlled tabs yet — click “Control tab” to start.";
    tabList.append(empty);
    return;
  }
  for (const tab of tabs) tabList.append(tabCard(tab));
}

// Execute-mode toggle: Ask before acting  ↔  Run without confirming (high risk).
let execModeValue = "ask";
function applyExecMode() {
  execMode.dataset.mode = execModeValue;
  execLabel.textContent =
    execModeValue === "auto" ? "Run without confirming" : "Ask before acting";
  riskBanner.hidden = execModeValue !== "auto";
}
execMode.addEventListener("click", () => {
  execModeValue = execModeValue === "auto" ? "ask" : "auto";
  applyExecMode();
});

// Send a command to the controlled tab via the background → native bridge.
async function sendCommand() {
  const text = commandInput.value.trim();
  if (!text) return;
  sendButton.disabled = true;
  try {
    const res = await send({
      type: "GROK_DESKTOP_COMMAND",
      command: text,
      autoApprove: execModeValue === "auto",
    });
    // Visible echo on the controlled tab so the user sees it landed.
    await send({
      type: "GROK_DESKTOP_PULSE_CURSOR",
      payload: { x: 160, y: 140, label: text.slice(0, 40), visible: true, duration: 2200, animate: true, motionMs: 700 },
    });
    if (res && res.ok === false) {
      bridgeStatus.textContent = res.error || "bridge off — connect to run";
    }
    commandInput.value = "";
  } finally {
    sendButton.disabled = false;
  }
}

sendButton.addEventListener("click", () => void sendCommand());
commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendCommand();
  }
});

controlButton.addEventListener("click", async () => {
  await send({ type: "GROK_DESKTOP_TRACK_ACTIVE_TAB", status: "controlling" });
  await render();
});
trackButton.addEventListener("click", async () => {
  await send({ type: "GROK_DESKTOP_TRACK_ACTIVE_TAB", status: "watching" });
  await render();
});
snapshotAllButton.addEventListener("click", async () => {
  await send({ type: "GROK_DESKTOP_SNAPSHOT_ALL" });
  await render();
});
refreshButton.addEventListener("click", render);
focusGuardInput.addEventListener("change", updateSettings);
visibleMotionInput.addEventListener("change", updateSettings);
controlledOnlyInput.addEventListener("change", updateSettings);

applyExecMode();
render();
