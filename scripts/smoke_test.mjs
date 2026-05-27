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
]) {
  assert.ok(app.includes(label), `App UI missing label: ${label}`);
}

for (const command of [
  "load_session_state",
  "save_session_state",
  "run_grok_streaming_task",
  "inspect_grok_environment",
  "list_grok_mcp",
  "doctor_grok_mcp",
  "list_grok_plugins",
  "list_grok_sessions",
  "install_chrome_native_host",
]) {
  assert.ok(read("src-tauri/src/lib.rs").includes(command), `missing Tauri command: ${command}`);
}

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

console.log("smoke: ok");
