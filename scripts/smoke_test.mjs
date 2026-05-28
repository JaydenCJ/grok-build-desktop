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
  "Dark",
  "Light",
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

console.log("smoke: ok");
