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
  "Run Grok",
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
  "run_grok_streaming_task",
  "cancel_grok_run",
  "get_static_preview",
  "inspect_grok_environment",
  "list_grok_mcp",
  "doctor_grok_mcp",
  "list_grok_plugins",
  "list_grok_sessions",
  "install_chrome_native_host",
  "pick_project_folder",
]) {
  assert.ok(read("src-tauri/src/lib.rs").includes(command), `missing Tauri command: ${command}`);
}

const libRs = read("src-tauri/src/lib.rs");
assert.ok(libRs.includes("--max-turns"), "Grok max-turn guard missing");
assert.ok(libRs.includes("is_noisy_grok_line"), "Tracing-noise filter missing");
assert.ok(libRs.includes("GROK_DESKTOP_VERBOSE_GROK_STDERR"), "Verbose stderr escape hatch missing");
assert.ok(libRs.includes("theme_mode: Option<String>"), "SessionState must round-trip themeMode");
assert.ok(libRs.includes("messages: serde_json::Value"), "SessionState must round-trip messages");

assert.ok(app.includes("handlePromptKeyDown"), "Enter-to-send composer handler missing");
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
assert.ok(css.includes(".message-error"), "Error message styles missing");
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

assert.ok(app.includes("MessageItem = memo"), "Chat messages must be memoized to keep typing snappy");
assert.ok(app.includes("activity-strip"), "Activity strip above composer missing");
assert.ok(app.includes("Grok is thinking"), "Thinking-state activity label missing");
assert.ok(app.includes("Streaming response"), "Streaming activity label missing");
assert.ok(app.includes("setBusyRunner((current) => (current === \"grok\" ? null : current))"), "cancelGrok must clear busyRunner in finally");
assert.ok(app.includes("setActiveGrokRunId((current) => (current === runIdSnapshot ? null : current))"), "cancelGrok must clear activeGrokRunId");

assert.ok(app.includes("ReactMarkdown"), "Markdown rendering missing — chat must render code/lists/headers");
assert.ok(app.includes("remarkGfm"), "GFM plugin missing");
assert.ok(app.includes("markdown-body"), "markdown-body wrapper missing");
assert.ok(app.includes("typing-dots"), "Streaming typing dots missing");
assert.ok(app.includes("stickToBottomRef"), "Smart sticky-bottom auto-scroll missing");

assert.ok(css.includes(".markdown-body pre"), "Code block styling missing");
assert.ok(css.includes(".markdown-body code"), "Inline code styling missing");
assert.ok(css.includes(".activity-strip"), "Activity strip styles missing");
assert.ok(css.includes(".activity-pulse"), "Activity pulse animation missing");
assert.ok(css.includes(".typing-dots"), "Typing dots styles missing");
assert.ok(css.includes(".repo-picker") && css.includes("min-width: 260px"), "Repo-picker min-width guard missing");

assert.ok(app.includes("setTimeout"), "Debounced localStorage writes missing");
assert.ok(app.includes("grok-desktop-run-count-total"), "Lifetime run counter key missing");

const packageJsonText = read("package.json");
assert.ok(packageJsonText.includes('"react-markdown"'), "react-markdown dependency missing");
assert.ok(packageJsonText.includes('"remark-gfm"'), "remark-gfm dependency missing");

console.log("smoke: ok");
