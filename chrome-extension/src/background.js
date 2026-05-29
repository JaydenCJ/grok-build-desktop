const STATE_KEY = "grokDesktopAgentTabs";
const SETTINGS_KEY = "grokDesktopAgentSettings";
const NATIVE_HOST = "com.grok.desktop.native";
const INJECTABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const DEFAULT_SETTINGS = {
  focusGuard: true,
  visibleMotion: true,
  controlledTabsOnly: true
};

let nativePort = null;
let nativeConnected = false;
let nativeError = "";
let reconnectTimer = null;

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || {};
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function setSettings(nextSettings) {
  const settings = { ...(await getSettings()), ...nextSettings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await broadcastSettings(settings);
  postNative({ type: "state", tabs: stateAsList(await getState()), settings });
  return settings;
}

function stateAsList(state) {
  return Object.values(state).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function isInjectableUrl(url = "") {
  try {
    return INJECTABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function bridgeInfo() {
  return {
    connected: nativeConnected,
    error: nativeError,
    host: NATIVE_HOST
  };
}

function scheduleNativeReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, 15000);
}

function connectNative() {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    nativeConnected = true;
    nativeError = "";

    nativePort.onMessage.addListener((message) => {
      // Desktop → Chrome command pushed up through the native host.
      if (message?.type === "dispatch" && message.command) {
        void handleDesktopDispatch(message.command);
        return;
      }
      nativeConnected = Boolean(message?.ok);
      nativeError = message?.ok ? "" : message?.error || "Native host reported an error.";
    });

    nativePort.onDisconnect.addListener(() => {
      nativeConnected = false;
      nativeError = chrome.runtime.lastError?.message || "Native host disconnected.";
      nativePort = null;
      scheduleNativeReconnect();
    });

    nativePort.postMessage({
      type: "hello",
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      sentAt: Date.now()
    });
  } catch (error) {
    nativeConnected = false;
    nativeError = error instanceof Error ? error.message : String(error);
    nativePort = null;
    scheduleNativeReconnect();
  }

  return nativePort;
}

function postNative(message) {
  const port = connectNative();
  if (!port) return false;

  try {
    port.postMessage({
      ...message,
      extensionId: chrome.runtime.id,
      sentAt: Date.now()
    });
    return true;
  } catch (error) {
    nativeConnected = false;
    nativeError = error instanceof Error ? error.message : String(error);
    nativePort = null;
    scheduleNativeReconnect();
    return false;
  }
}

// Desktop → Chrome: act on a command the Tauri app wrote (pushed up by the
// native host). Targets the controlled tab (or the active tab). Supported:
//   { action:"navigate", url }            → load a URL in the tab
//   { action:"cursor", x, y, label }      → pulse the agent cursor + label
//   { action:"dom", domAction:{...} }     → forward a DOM action to content.js
//   { action:"note"|undefined, text }     → show text as the agent action label
async function handleDesktopDispatch(command) {
  const state = await getState();
  // Prefer a controlled tab; fall back to the active tab.
  let tabId = Object.values(state).find((t) => t.status === "controlling")?.id;
  if (!tabId) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = active?.id;
  }
  if (!tabId) return;

  const action = command.action || "note";
  try {
    if (action === "navigate" && command.url) {
      await chrome.tabs.update(Number(tabId), { url: String(command.url) });
      return;
    }
    if (action === "dom" && command.domAction) {
      await ensureContent(Number(tabId));
      await chrome.tabs.sendMessage(Number(tabId), {
        type: "GROK_DESKTOP_AGENT_DOM_ACTION",
        ...command.domAction,
      });
      return;
    }
    // cursor / note → visible agent feedback on the page.
    await ensureContent(Number(tabId));
    await chrome.tabs.sendMessage(Number(tabId), {
      type: "GROK_DESKTOP_AGENT_CURSOR",
      payload: {
        x: Number(command.x) || 160,
        y: Number(command.y) || 140,
        label: String(command.label || command.text || "Grok"),
        visible: true,
        duration: 2600,
        animate: true,
        motionMs: 700,
      },
    });
  } catch (_e) {
    /* content script not present on this page (chrome://, store, etc.) */
  }
}

async function setState(state, options = {}) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  const count = Object.keys(state).length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2f7d7e" });

  if (options.syncNative !== false) {
    postNative({ type: "state", tabs: stateAsList(state), settings: await getSettings() });
  }
}

function tabSummary(tab, status = "watching") {
  return {
    id: tab.id,
    title: tab.title || "Untitled",
    url: tab.url || "",
    status,
    task: "",
    updatedAt: Date.now(),
    snapshot: null
  };
}

async function ensureContent(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "GROK_DESKTOP_PING" });
  } catch {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["src/content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
  }
}

async function syncTabOverlay(tabId, tabState) {
  if (!isInjectableUrl(tabState?.url)) return;
  await ensureContent(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "GROK_DESKTOP_SET_AGENT_CONFIG",
    payload: await getSettings()
  });
  await chrome.tabs.sendMessage(tabId, {
    type: "GROK_DESKTOP_SET_TAB_STATE",
    payload: tabState
  });
}

async function broadcastSettings(settings) {
  const state = await getState();
  for (const rawId of Object.keys(state)) {
    try {
      await chrome.tabs.sendMessage(Number(rawId), {
        type: "GROK_DESKTOP_SET_AGENT_CONFIG",
        payload: settings
      });
    } catch {
      // Inaccessible tabs will receive settings on the next overlay sync.
    }
  }
}

async function trackTab(tab, status = "watching") {
  if (!tab?.id || !isInjectableUrl(tab.url || "")) {
    return { ok: false, error: "This tab cannot be monitored by a Chrome extension." };
  }

  const state = await getState();
  state[tab.id] = tabSummary(tab, status);
  await setState(state);
  await syncTabOverlay(tab.id, state[tab.id]);
  return { ok: true, tab: state[tab.id], bridge: bridgeInfo() };
}

async function untrackTab(tabId) {
  const state = await getState();
  delete state[tabId];
  await setState(state);
  try {
    await chrome.tabs.sendMessage(Number(tabId), { type: "GROK_DESKTOP_SET_TAB_STATE", payload: null });
  } catch {
    // Tab may be gone, restricted, or no longer injectable.
  }
  return { ok: true, bridge: bridgeInfo() };
}

async function collectSnapshot(tabId) {
  const state = await getState();
  if (!state[tabId]) {
    return { ok: false, error: "Tab is not monitored yet.", bridge: bridgeInfo() };
  }

  if (!isInjectableUrl(state[tabId].url)) {
    return { ok: false, error: "This tab does not allow extension snapshots.", bridge: bridgeInfo() };
  }

  await ensureContent(Number(tabId));
  const snapshot = await chrome.tabs.sendMessage(Number(tabId), {
    type: "GROK_DESKTOP_COLLECT_PAGE_SNAPSHOT"
  });

  state[tabId] = {
    ...state[tabId],
    title: snapshot.title || state[tabId].title,
    url: snapshot.url || state[tabId].url,
    snapshot,
    updatedAt: Date.now()
  };
  await setState(state);
  postNative({ type: "snapshot", tabId: Number(tabId), snapshot });

  return { ok: true, tab: state[tabId], snapshot, bridge: bridgeInfo() };
}

async function snapshotAllTabs() {
  const state = await refreshTrackedTabs();
  const results = [];

  for (const tabId of Object.keys(state)) {
    try {
      results.push(await collectSnapshot(Number(tabId)));
    } catch (error) {
      results.push({
        ok: false,
        tabId: Number(tabId),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { ok: true, results, tabs: await getState(), bridge: bridgeInfo() };
}

async function refreshTrackedTabs() {
  const state = await getState();
  const refreshed = {};

  for (const rawId of Object.keys(state)) {
    const tabId = Number(rawId);
    try {
      const tab = await chrome.tabs.get(tabId);
      refreshed[tabId] = {
        ...state[rawId],
        title: tab.title || state[rawId].title,
        url: tab.url || state[rawId].url,
        updatedAt: Date.now()
      };
      await syncTabOverlay(tabId, refreshed[tabId]);
    } catch {
      // Dropped closed or inaccessible tabs.
    }
  }

  await setState(refreshed);
  return refreshed;
}

chrome.runtime.onInstalled.addListener(async () => {
  connectNative();
  await refreshTrackedTabs();
});

chrome.runtime.onStartup.addListener(() => {
  connectNative();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await untrackTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.title && !changeInfo.url && changeInfo.status !== "complete") return;

  const state = await getState();
  if (!state[tabId]) return;

  state[tabId] = {
    ...state[tabId],
    title: tab.title || state[tabId].title,
    url: tab.url || state[tabId].url,
    updatedAt: Date.now()
  };
  await setState(state);

  if (changeInfo.status === "complete") {
    await syncTabOverlay(tabId, state[tabId]);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "GROK_DESKTOP_GET_STATE") {
      sendResponse({
        ok: true,
        tabs: await refreshTrackedTabs(),
        bridge: bridgeInfo(),
        settings: await getSettings()
      });
      return;
    }

    if (message.type === "GROK_DESKTOP_SET_SETTINGS") {
      sendResponse({ ok: true, settings: await setSettings(message.settings || {}) });
      return;
    }

    if (message.type === "GROK_DESKTOP_TRACK_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse(await trackTab(tab, message.status || "watching"));
      return;
    }

    if (message.type === "GROK_DESKTOP_TRACK_TAB") {
      const tab = await chrome.tabs.get(message.tabId);
      sendResponse(await trackTab(tab, message.status || "watching"));
      return;
    }

    if (message.type === "GROK_DESKTOP_UNTRACK_TAB") {
      sendResponse(await untrackTab(message.tabId));
      return;
    }

    if (message.type === "GROK_DESKTOP_SET_TAB_STATUS") {
      const state = await getState();
      if (state[message.tabId]) {
        state[message.tabId].status = message.status || "watching";
        state[message.tabId].task = message.task || state[message.tabId].task;
        state[message.tabId].updatedAt = Date.now();
        await setState(state);
        await syncTabOverlay(Number(message.tabId), state[message.tabId]);
      }
      sendResponse({ ok: true, bridge: bridgeInfo() });
      return;
    }

    if (message.type === "GROK_DESKTOP_SNAPSHOT_TAB") {
      sendResponse(await collectSnapshot(message.tabId));
      return;
    }

    if (message.type === "GROK_DESKTOP_SNAPSHOT_ALL") {
      sendResponse(await snapshotAllTabs());
      return;
    }

    if (message.type === "GROK_DESKTOP_PULSE_CURSOR") {
      // Resolve target: explicit tabId, else the active tab.
      let tabId = message.tabId ? Number(message.tabId) : null;
      if (!tabId) {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = active?.id;
      }
      if (tabId) {
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: "GROK_DESKTOP_AGENT_CURSOR",
            payload: message.payload || { x: 120, y: 120, visible: true, label: "Agent", animate: true },
          });
        } catch (_e) { /* content script not injected on this page */ }
      }
      sendResponse({ ok: true, bridge: bridgeInfo() });
      return;
    }

    // Command from the popup composer → forward to the Tauri app via the
    // native bridge so the Grok agent can act on the controlled tab. Without
    // the bridge we can't run AI commands, so report that clearly.
    if (message.type === "GROK_DESKTOP_COMMAND") {
      const port = connectNative();
      if (!port) {
        sendResponse({ ok: false, error: "bridge off — install native host to run commands", bridge: bridgeInfo() });
        return;
      }
      try {
        port.postMessage({
          type: "command",
          command: String(message.command || ""),
          autoApprove: Boolean(message.autoApprove),
          ts: Date.now(),
        });
        sendResponse({ ok: true, bridge: bridgeInfo() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), bridge: bridgeInfo() });
      }
      return;
    }

    if (message.type === "GROK_DESKTOP_AGENT_INPUT" || message.type === "GROK_DESKTOP_AGENT_DOM_ACTION") {
      const settings = await getSettings();
      const state = await getState();
      const tab = state[message.tabId];

      if (settings.controlledTabsOnly && tab?.status !== "controlling") {
        sendResponse({
          ok: false,
          error: "Tab must be in Control mode before Grok Desktop can change page state.",
          bridge: bridgeInfo()
        });
        return;
      }

      const response = await chrome.tabs.sendMessage(Number(message.tabId), message);
      sendResponse({ ok: true, response, bridge: bridgeInfo() });
      return;
    }

    if (message.type === "GROK_DESKTOP_AGENT_CANCEL") {
      // Forward to native host so the Tauri app can cancel any active run.
      // Best-effort: bridge may be offline.
      postNative({ type: "agent_cancel", tabId: _sender?.tab?.id ?? null });
      sendResponse({ ok: true, bridge: bridgeInfo() });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type", bridge: bridgeInfo() });
  })();
  return true;
});

connectNative();
