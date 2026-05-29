import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const packageJson = JSON.parse(read("package.json"));
for (const scriptName of ["build", "check", "test", "doctor", "mac:build", "mac:build:dmg", "mac:install"]) {
  assert.ok(packageJson.scripts?.[scriptName], `missing package script: ${scriptName}`);
}

const app = read("src/App.tsx");
for (const label of [
  "Grok Desktop",
  "Grok Code",
  "grok-build",
  "Approvals",
  "Effort",
  "Reasoning",
  "Best-of-N",
  "Subagents",
  "MCP",
  "Preview",
  "Agents",
  "Plugins",
  "Hooks",
  "Permissions",
  "Memory",
  "Terminal",
  "Context Files",
  "Command History",
  "Theme",
  "Stop",
]) {
  assert.ok(app.includes(label), `App UI missing label: ${label}`);
}

for (const command of [
  "load_session_state",
  "save_session_state",
  "get_static_preview",
  "inspect_grok_environment",
  "list_grok_mcp",
  "doctor_grok_mcp",
  "list_grok_plugins",
  "list_grok_sessions",
  "install_chrome_native_host",
  "pick_project_folder",
  // F: run queue + streaming-json pipeline
  "enqueue_run",
  "cancel_run",
  "get_queue",
  "clear_queue",
  "resume_pending_runs",
  "cancel_pending_runs",
]) {
  assert.ok(read("src-tauri/src/lib.rs").includes(command), `missing Tauri command: ${command}`);
}

const libRs = read("src-tauri/src/lib.rs");
assert.ok(libRs.includes("--max-turns"), "Grok max-turn guard missing");
assert.ok(libRs.includes("is_noisy_grok_line"), "Tracing-noise filter missing");
assert.ok(libRs.includes("GROK_DESKTOP_VERBOSE_GROK_STDERR"), "Verbose stderr escape hatch missing");
assert.ok(libRs.includes("theme_mode: Option<String>"), "SessionState must round-trip themeMode");
assert.ok(libRs.includes("messages: serde_json::Value"), "SessionState must round-trip messages");
// F: Rust queue + streaming-json
assert.ok(app.includes("streaming-json"),
  "App.tsx must pass --output-format streaming-json in buildGrokArgs");
assert.ok(libRs.includes("pub mod runs"), "runs module must be exported for tests + commands");
assert.ok(libRs.includes("RunQueue"), "lib.rs must wire RunQueue into managed state");
assert.ok(libRs.includes("forward_queue_message"), "lib.rs must forward queue messages to Tauri events");

assert.ok(app.includes("<Composer"), "Composer component must be rendered in App");
assert.ok(!app.includes("[code output hidden]"), "Main Grok output should not hide code blocks");
assert.ok(app.includes("type ChatMessage"), "ChatMessage type missing");
assert.ok(app.includes("parseAvailableModels"), "Dynamic model parser missing");
assert.ok(app.includes("togglePanel"), "Panel mutual-exclusivity helper missing");
assert.ok(app.includes("pickFolder"), "Folder picker handler missing");
assert.ok(app.includes("workspace-statusbar"), "Workspace status bar missing");
assert.ok(app.includes("starter-grid"), "Empty-state starter cards missing");
assert.ok(app.includes("starter-card"), "Empty-state starter card buttons missing");
assert.ok(app.includes("How can Grok help today"), "Empty-state heading missing");
assert.ok(app.includes("conversationScrollRef"), "Conversation auto-scroll ref missing");

const css = read("src/App.css");
assert.ok(css.includes(".workspace-statusbar"), "Status bar styles missing");
assert.ok(css.includes(".status-cluster"), "Status cluster styles missing");
assert.ok(css.includes(".repo-pick-button"), "Folder picker button styles missing");
assert.ok(css.includes(".message.user-message"), "User message styles missing");
assert.ok(!css.includes("grid-template-rows: auto minmax(0, 1fr) auto 36px;"), "Old 36px empty workspace row should be gone");

const manifest = JSON.parse(read("chrome-extension/manifest.json"));
assert.equal(manifest.manifest_version, 3, "Chrome extension must stay Manifest V3");
assert.ok(manifest.permissions?.includes("nativeMessaging"), "native messaging permission missing");

assert.ok(
  existsSync(join(root, "docs/design/grok-desktop-uiux-concept.png")),
  "imagegen UIUX concept asset missing",
);

assert.ok(
  existsSync(join(root, "docs/design/grok-desktop-grok-style-uiux-v2.png")),
  "Grok style imagegen UIUX concept asset missing",
);

assert.ok(
  existsSync(join(root, "docs/design/grok-desktop-restrained-dark-light-uiux.png")),
  "restrained dark/light imagegen UIUX concept asset missing",
);

assert.ok(
  existsSync(join(root, "docs/design/grok-desktop-10pt-power-clean-ui.png")),
  "10-point power-clean imagegen UIUX concept asset missing",
);

// Polish / ship-readiness guards
const mainTsx = read("src/main.tsx");
assert.ok(mainTsx.includes("AppErrorBoundary"), "Error boundary missing — corrupted state must not brick the app");
assert.ok(mainTsx.includes("Reset session and reload"), "Recovery action button missing in error boundary");

// F: new streaming pipeline (MessageItem + MessageList + StatusBar + QueueDock + Composer + markdown worker)
assert.ok(read("src/components/MessageItem.tsx").includes("memo("),
  "MessageItem must be memoized for streaming perf");
assert.ok(app.includes("<MessageList"), "App must render MessageList for the virtualized chat");
assert.ok(app.includes("<StatusBar"), "App must render StatusBar (replaces activity strip)");
assert.ok(app.includes("<QueueDock"), "App must render QueueDock for the FIFO run queue");

const streamStoreSrc = read("src/lib/streamStore.ts");
assert.ok(streamStoreSrc.includes("grok-desktop://run-event"),
  "streamStore must listen for run-event Tauri events");
assert.ok(streamStoreSrc.includes("grok-desktop://run-state-changed"),
  "streamStore must listen for run-state-changed Tauri events");
assert.ok(streamStoreSrc.includes("grok-desktop://queue-changed"),
  "streamStore must listen for queue-changed Tauri events");
assert.ok(streamStoreSrc.includes("subscribe"),
  "streamStore must expose subscribe API for useSyncExternalStore");

// markdown worker (off-thread CommonMark + highlight.js)
const workerSrc = read("src/lib/markdown.worker.ts");
assert.ok(workerSrc.includes("marked"), "Markdown worker missing marked");
assert.ok(workerSrc.includes("highlight"), "Markdown worker missing syntax highlighting");

// Hooks
for (const hookFile of ["useActiveRun", "useQueue", "useRunSnapshot", "useElapsed"]) {
  assert.ok(existsSync(join(root, `src/hooks/${hookFile}.ts`)),
    `hook file missing: src/hooks/${hookFile}.ts`);
}
assert.ok(read("src/hooks/useActiveRun.ts").includes("useSyncExternalStore"),
  "selector hooks must use useSyncExternalStore for fine-grained subscriptions");

assert.ok(app.includes("stickToBottomRef"), "Smart sticky-bottom auto-scroll missing");

assert.ok(css.includes(".markdown-body pre") || css.includes(".message-body pre"), "Code block styling missing");
assert.ok(css.includes(".markdown-body code") || css.includes(".message-body code"), "Inline code styling missing");
assert.ok(css.includes(".status-bar"), "StatusBar styles missing");
assert.ok(css.includes(".queue-dock"), "QueueDock styles missing");
assert.ok(css.includes(".composer"), "Composer styles missing");
assert.ok(css.includes(".repo-picker") && css.includes("min-width: 260px"), "Repo-picker min-width guard missing");

assert.ok(app.includes("setTimeout"), "Debounced localStorage writes missing");
assert.ok(app.includes("grok-desktop-run-count-total"), "Lifetime run counter key missing");

const packageJsonText = read("package.json");
assert.ok(packageJsonText.includes('"marked"'), "marked dependency missing — markdown worker uses marked");
assert.ok(packageJsonText.includes('"highlight.js"'), "highlight.js dependency missing — markdown worker uses it for code fences");
assert.ok(packageJsonText.includes('"react-virtuoso"'), "react-virtuoso dependency missing — MessageList virtualizes chat");
assert.ok(packageJsonText.includes('"test:unit"'), "vitest test:unit script missing for streamStore tests");

// E: Telegram remote daemon
const cargoToml = read("src-tauri/Cargo.toml");
assert.ok(cargoToml.includes("teloxide"), "teloxide dep missing — Telegram remote daemon");
assert.ok(cargoToml.includes("dotenvy"), "dotenvy dep missing — .env loader");
assert.ok(existsSync(join(root, "src-tauri/src/telegram/mod.rs")), "telegram module missing");
assert.ok(existsSync(join(root, "src-tauri/src/telegram/config.rs")), "telegram config module missing");
assert.ok(existsSync(join(root, "src-tauri/src/telegram/commands.rs")), "telegram commands module missing");
assert.ok(existsSync(join(root, "src-tauri/src/telegram/stream.rs")), "telegram stream module missing");
const teleCommands = read("src-tauri/src/telegram/commands.rs");
for (const cmd of ["Grok(String)", "Queue", "Cancel(String)", "Status", "Help"]) {
  assert.ok(teleCommands.includes(cmd), `telegram command variant missing: ${cmd}`);
}
assert.ok(libRs.includes("telegram::spawn_daemon"),
  "lib.rs must spawn telegram daemon from setup()");
assert.ok(libRs.includes("pub mod telegram"), "lib.rs must export telegram module");
assert.ok(read(".env.example").includes("TELEGRAM_BOT_TOKEN"),
  ".env.example must document TELEGRAM_BOT_TOKEN");
assert.ok(read(".env.example").includes("TELEGRAM_ALLOWED_CHAT_IDS"),
  ".env.example must document TELEGRAM_ALLOWED_CHAT_IDS");

// v0.3.0: Prompt library (D MVP)
assert.ok(existsSync(join(root, "src-tauri/src/prompts/mod.rs")),
  "prompts module missing");
assert.ok(existsSync(join(root, "src/lib/prompts.ts")),
  "prompts TS wrapper missing");
assert.ok(existsSync(join(root, "src/components/PromptLibrary.tsx")),
  "PromptLibrary component missing");
for (const cmd of ["list_prompts", "upsert_prompt", "delete_prompt"]) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for prompts: ${cmd}`);
}
assert.ok(libRs.includes("pub mod prompts"),
  "lib.rs must export prompts module");
assert.ok(libRs.includes("PromptStore::open_at"),
  "lib.rs must open prompts.sqlite on setup");

// v0.3.0: G2 agent overlay
assert.ok(existsSync(join(root, "overlay.html")),
  "overlay.html entry point missing");
assert.ok(existsSync(join(root, "src/overlay.tsx")),
  "src/overlay.tsx entry point missing");
assert.ok(existsSync(join(root, "src/components/AgentOverlay.tsx")),
  "AgentOverlay component missing");
assert.ok(existsSync(join(root, "src/components/AgentOverlayDriver.tsx")),
  "AgentOverlayDriver missing");
assert.ok(existsSync(join(root, "src/lib/overlay.ts")),
  "overlay TS wrapper missing");
for (const cmd of ["set_agent_overlay", "set_agent_cursor"]) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for overlay: ${cmd}`);
}
const tauriConf = JSON.parse(read("src-tauri/tauri.conf.json"));
// G2 agent-overlay window: declared statically with `fullscreen: true` had a
// macOS bug — fullscreen mode does not honor transparent, producing an opaque
// white block over a whole display. Until G2 is rewritten to create the
// overlay window programmatically (WebviewWindowBuilder + set_position +
// set_size, no fullscreen flag), the static window config is intentionally
// absent. The set_agent_overlay command stays available; calling it when no
// "agent-overlay" window exists returns an error that AgentOverlayDriver
// catches silently.
const overlayWindow = (tauriConf.app?.windows ?? []).find((w) => w.label === "agent-overlay");
if (overlayWindow) {
  assert.notEqual(overlayWindow.fullscreen, true,
    "agent-overlay must NOT use fullscreen: true — macOS fullscreen mode is opaque");
  assert.equal(overlayWindow.transparent, true, "agent-overlay window must be transparent");
  assert.equal(overlayWindow.alwaysOnTop, true, "agent-overlay window must be alwaysOnTop");
  assert.equal(overlayWindow.decorations, false, "agent-overlay window must hide decorations");
}

// Vite multi-entry build for overlay.
const viteConfig = read("vite.config.ts");
assert.ok(viteConfig.includes("overlay.html"),
  "vite.config.ts must include overlay.html as a build entry");

// v0.3.0: Grok-themed CSS tokens
assert.ok(css.includes("--grok-bg-0"),
  "Grok-themed CSS tokens missing (--grok-bg-0..4 expected)");
assert.ok(css.includes("--grok-accent"),
  "Grok accent color token missing");

// v0.4.0: rename to Grok Build Desktop
assert.ok(tauriConf.productName === "Grok Build Desktop",
  "tauri productName must be 'Grok Build Desktop'");
assert.ok(app.includes("Grok Build Desktop"),
  "Sidebar brand must read 'Grok Build Desktop'");

// v0.4.0: real action policies (Plan + Autopilot) + risk warning
assert.ok(app.includes('"plan"') && app.includes("--permission-mode") || app.includes('actionPolicy === "plan"'),
  "Plan action policy must map to --permission-mode plan");
assert.ok(app.includes("--always-approve"),
  "Autopilot must pass --always-approve to grok");
assert.ok(app.includes("autopilot-warning"),
  "Autopilot risk warning banner missing");

// v0.4.0: dedicated Settings page (theme/Dark/Light moved here)
assert.ok(existsSync(join(root, "src/components/SettingsPage.tsx")),
  "SettingsPage component missing");
const settingsSrc = read("src/components/SettingsPage.tsx");
assert.ok(settingsSrc.includes("Dark") && settingsSrc.includes("Light"),
  "SettingsPage must host the Dark/Light theme control");
assert.ok(app.includes("<SettingsPage"), "App must render SettingsPage");

// v0.4.0: Tools = MCP integration hub
assert.ok(existsSync(join(root, "src/components/ToolsPage.tsx")),
  "ToolsPage (MCP hub) component missing");
assert.ok(existsSync(join(root, "src/lib/mcp.ts")), "mcp lib wrapper missing");
assert.ok(read("src/lib/mcp.ts").includes("MCP_CATALOG"),
  "mcp lib must export the community MCP catalog");
assert.ok(app.includes("<ToolsPage"), "App must render ToolsPage");
for (const cmd of ["grok_mcp_add", "grok_mcp_remove"]) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for MCP: ${cmd}`);
}

// v0.4.0: minimal header + model picker in composer footer
assert.ok(app.includes("window-titlebar minimal"),
  "Minimal Claude-Desktop-style top bar missing");
assert.ok(app.includes("model-select-footer"),
  "Model picker must be in the composer footer");

// Regression guard: conversation panel must be flex (a 2-row grid let the
// TabBar steal the scroll row and collapsed MessageList to 0 height).
assert.ok(!css.includes("grid-template-rows: minmax(0, 1fr) auto"),
  "conversation-panel must not use the 2-row grid that collapsed the chat");

console.log("smoke: ok");
