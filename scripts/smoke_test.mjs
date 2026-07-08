import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const packageJson = JSON.parse(read('package.json'));
for (const scriptName of [
  'build',
  'check',
  'test',
  'doctor',
  'mac:build',
  'mac:build:dmg',
  'mac:install',
]) {
  assert.ok(packageJson.scripts?.[scriptName], `missing package script: ${scriptName}`);
}

// App.tsx was split into focused modules (src/app/* + components/ + hooks/),
// and user-facing copy was extracted into src/i18n/en.ts. Guards that assert
// on "the app source" search the combined text so the intent (feature X
// exists and is wired) survives mechanical extraction.
const appModules = [
  'src/App.tsx',
  ...readdirSync(join(root, 'src/app'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `src/app/${f}`),
  ...readdirSync(join(root, 'src/hooks'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `src/hooks/${f}`),
  ...readdirSync(join(root, 'src/components'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/components/${f}`),
  ...readdirSync(join(root, 'src/i18n'))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => `src/i18n/${f}`),
];
const app = appModules.map(read).join('\n');
for (const label of [
  'Grok Desktop',
  'Grok Code',
  'grok-build',
  'Approvals',
  'Effort',
  'Reasoning',
  'Best-of-N',
  'Subagents',
  'MCP',
  'Preview',
  'Agents',
  'Plugins',
  'Hooks',
  'Permissions',
  'Memory',
  'Terminal',
  'Context Files',
  'Command History',
  'Theme',
  'Stop',
]) {
  assert.ok(app.includes(label), `App UI missing label: ${label}`);
}

for (const command of [
  'load_session_state',
  'save_session_state',
  'get_static_preview',
  'inspect_grok_environment',
  'list_grok_mcp',
  'doctor_grok_mcp',
  'list_grok_plugins',
  'list_grok_sessions',
  'pick_project_folder',
  // F: run queue + streaming-json pipeline
  'enqueue_run',
  'cancel_run',
  'get_queue',
  'clear_queue',
  'resume_pending_runs',
  'cancel_pending_runs',
]) {
  assert.ok(read('src-tauri/src/lib.rs').includes(command), `missing Tauri command: ${command}`);
}

const libRs = read('src-tauri/src/lib.rs');
assert.ok(libRs.includes('--max-turns'), 'Grok max-turn guard missing');
assert.ok(libRs.includes('is_noisy_grok_line'), 'Tracing-noise filter missing');
assert.ok(
  libRs.includes('GROK_DESKTOP_VERBOSE_GROK_STDERR'),
  'Verbose stderr escape hatch missing',
);
assert.ok(libRs.includes('theme_mode: Option<String>'), 'SessionState must round-trip themeMode');
assert.ok(libRs.includes('messages: serde_json::Value'), 'SessionState must round-trip messages');
// NOTE: the restore-must-not-clobber guards and the buildGrokArgs flag
// mapping used to be source-string asserts here; they are now REAL behavior
// tests in src/hooks/__tests__/useSessionPersistence.test.tsx and
// src/app/__tests__/grokArgs.test.ts (run via `npm run test:unit`).
assert.ok(libRs.includes('pub mod runs'), 'runs module must be exported for tests + commands');
assert.ok(libRs.includes('RunQueue'), 'lib.rs must wire RunQueue into managed state');
assert.ok(
  libRs.includes('forward_queue_message'),
  'lib.rs must forward queue messages to Tauri events',
);

assert.ok(app.includes('<Composer'), 'Composer component must be rendered in App');
assert.ok(!app.includes('[code output hidden]'), 'Main Grok output should not hide code blocks');
assert.ok(app.includes('type ChatMessage'), 'ChatMessage type missing');
assert.ok(app.includes('parseAvailableModels'), 'Dynamic model parser missing');
assert.ok(app.includes('togglePanel'), 'Panel mutual-exclusivity helper missing');
assert.ok(app.includes('pickFolder'), 'Folder picker handler missing');
assert.ok(app.includes('workspace-statusbar'), 'Workspace status bar missing');
assert.ok(app.includes('starter-grid'), 'Empty-state starter cards missing');
assert.ok(app.includes('starter-card'), 'Empty-state starter card buttons missing');
assert.ok(app.includes('How can Grok help today'), 'Empty-state heading missing');
// Scroll-follow lives in MessageList (Virtuoso owns the scroller); App's old
// conversationScrollRef effects were dead code — the outer div never scrolls.
const messageList = read('src/components/MessageList.tsx');
assert.ok(messageList.includes('followOutput'), 'MessageList follow-output missing');
assert.ok(messageList.includes('atBottomStateChange'), 'MessageList at-bottom tracking missing');

const css = read('src/App.css');
assert.ok(css.includes('.workspace-statusbar'), 'Status bar styles missing');
assert.ok(css.includes('.status-cluster'), 'Status cluster styles missing');
assert.ok(css.includes('.repo-pick-button'), 'Folder picker button styles missing');
assert.ok(css.includes('.message.user-message'), 'User message styles missing');
assert.ok(
  !css.includes('grid-template-rows: auto minmax(0, 1fr) auto 36px;'),
  'Old 36px empty workspace row should be gone',
);

assert.ok(
  existsSync(join(root, 'docs/design/grok-desktop-uiux-concept.png')),
  'imagegen UIUX concept asset missing',
);

assert.ok(
  existsSync(join(root, 'docs/design/grok-desktop-grok-style-uiux-v2.png')),
  'Grok style imagegen UIUX concept asset missing',
);

assert.ok(
  existsSync(join(root, 'docs/design/grok-desktop-restrained-dark-light-uiux.png')),
  'restrained dark/light imagegen UIUX concept asset missing',
);

assert.ok(
  existsSync(join(root, 'docs/design/grok-desktop-10pt-power-clean-ui.png')),
  '10-point power-clean imagegen UIUX concept asset missing',
);

// Polish / ship-readiness guards
const mainTsx = read('src/main.tsx');
assert.ok(
  mainTsx.includes('AppErrorBoundary'),
  'Error boundary missing — corrupted state must not brick the app',
);
assert.ok(
  mainTsx.includes('Reset session and reload'),
  'Recovery action button missing in error boundary',
);

// F: new streaming pipeline (MessageItem + MessageList + StatusBar + QueueDock + Composer + markdown worker)
assert.ok(
  read('src/components/MessageItem.tsx').includes('memo('),
  'MessageItem must be memoized for streaming perf',
);
assert.ok(app.includes('<MessageList'), 'App must render MessageList for the virtualized chat');
assert.ok(app.includes('<StatusBar'), 'App must render StatusBar (replaces activity strip)');
assert.ok(app.includes('<QueueDock'), 'App must render QueueDock for the FIFO run queue');

const streamStoreSrc = read('src/lib/streamStore.ts');
assert.ok(
  streamStoreSrc.includes('grok-desktop://run-event'),
  'streamStore must listen for run-event Tauri events',
);
assert.ok(
  streamStoreSrc.includes('grok-desktop://run-state-changed'),
  'streamStore must listen for run-state-changed Tauri events',
);
assert.ok(
  streamStoreSrc.includes('grok-desktop://queue-changed'),
  'streamStore must listen for queue-changed Tauri events',
);
assert.ok(
  streamStoreSrc.includes('subscribe'),
  'streamStore must expose subscribe API for useSyncExternalStore',
);

// markdown worker (off-thread CommonMark + highlight.js)
const workerSrc = read('src/lib/markdown.worker.ts');
assert.ok(workerSrc.includes('marked'), 'Markdown worker missing marked');
assert.ok(workerSrc.includes('highlight'), 'Markdown worker missing syntax highlighting');

// Hooks
for (const hookFile of ['useActiveRun', 'useQueue', 'useRunSnapshot', 'useElapsed']) {
  assert.ok(
    existsSync(join(root, `src/hooks/${hookFile}.ts`)),
    `hook file missing: src/hooks/${hookFile}.ts`,
  );
}
assert.ok(
  read('src/hooks/useActiveRun.ts').includes('useSyncExternalStore'),
  'selector hooks must use useSyncExternalStore for fine-grained subscriptions',
);

// Smart sticky-bottom auto-scroll: MessageList pins to the bottom only while
// the user is already there (atBottomRef), never yanking them back down.
assert.ok(messageList.includes('atBottomRef'), 'Smart sticky-bottom auto-scroll missing');

assert.ok(
  css.includes('.markdown-body pre') || css.includes('.message-body pre'),
  'Code block styling missing',
);
assert.ok(
  css.includes('.markdown-body code') || css.includes('.message-body code'),
  'Inline code styling missing',
);
assert.ok(css.includes('.status-bar'), 'StatusBar styles missing');
assert.ok(css.includes('.queue-dock'), 'QueueDock styles missing');
assert.ok(css.includes('.composer'), 'Composer styles missing');
assert.ok(
  css.includes('.repo-picker') && css.includes('min-width: 260px'),
  'Repo-picker min-width guard missing',
);

assert.ok(app.includes('setTimeout'), 'Debounced localStorage writes missing');
assert.ok(app.includes('grok-desktop-run-count-total'), 'Lifetime run counter key missing');

const packageJsonText = read('package.json');
assert.ok(
  packageJsonText.includes('"marked"'),
  'marked dependency missing — markdown worker uses marked',
);
assert.ok(
  packageJsonText.includes('"highlight.js"'),
  'highlight.js dependency missing — markdown worker uses it for code fences',
);
assert.ok(
  packageJsonText.includes('"react-virtuoso"'),
  'react-virtuoso dependency missing — MessageList virtualizes chat',
);
assert.ok(
  packageJsonText.includes('"test:unit"'),
  'vitest test:unit script missing for streamStore tests',
);

// v0.3.0: Prompt library (D MVP)
assert.ok(existsSync(join(root, 'src-tauri/src/prompts/mod.rs')), 'prompts module missing');
assert.ok(existsSync(join(root, 'src/lib/prompts.ts')), 'prompts TS wrapper missing');
for (const cmd of ['list_prompts', 'upsert_prompt', 'delete_prompt']) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for prompts: ${cmd}`);
}
assert.ok(libRs.includes('pub mod prompts'), 'lib.rs must export prompts module');
assert.ok(libRs.includes('PromptStore::open_at'), 'lib.rs must open prompts.sqlite on setup');

// The G2 agent overlay was removed: it depended on an "agent-overlay" window
// that was never created (the static window config was dropped for a macOS
// fullscreen-transparency bug and never replaced programmatically), so every
// code path was dead. Guard against it creeping back half-wired.
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'));
assert.ok(
  !existsSync(join(root, 'overlay.html')),
  'dead agent-overlay entry point must stay removed',
);
assert.ok(!libRs.includes('set_agent_overlay'), 'dead set_agent_overlay command must stay removed');
assert.ok(
  !(tauriConf.app?.windows ?? []).some((w) => w.label === 'agent-overlay'),
  'agent-overlay window must not be declared statically (macOS fullscreen+transparent bug)',
);

// v0.3.0: Grok-themed CSS tokens
assert.ok(css.includes('--grok-bg-0'), 'Grok-themed CSS tokens missing (--grok-bg-0..4 expected)');
assert.ok(css.includes('--grok-accent'), 'Grok accent color token missing');

// v0.4.0: rename to Grok Build Desktop
assert.ok(
  tauriConf.productName === 'Grok Build Desktop',
  "tauri productName must be 'Grok Build Desktop'",
);
assert.ok(app.includes('Grok Build Desktop'), "Sidebar brand must read 'Grok Build Desktop'");

// v0.4.0: action-policy risk warning stays visible in the UI. (The policy →
// CLI-flag mapping itself is behavior-tested in src/app/__tests__/grokArgs.test.ts.)
assert.ok(app.includes('autopilot-warning'), 'Autopilot risk warning banner missing');

// v0.4.0: dedicated Settings page (theme/Dark/Light moved here)
assert.ok(
  existsSync(join(root, 'src/components/SettingsPage.tsx')),
  'SettingsPage component missing',
);
const settingsSrc = read('src/components/SettingsPage.tsx');
assert.ok(
  settingsSrc.includes('common.dark') && settingsSrc.includes('common.light'),
  'SettingsPage must host the Dark/Light theme control (via i18n keys)',
);
assert.ok(app.includes('<SettingsPage'), 'App must render SettingsPage');

// v0.4.0: Tools = MCP integration hub
assert.ok(
  existsSync(join(root, 'src/components/ToolsPage.tsx')),
  'ToolsPage (MCP hub) component missing',
);
assert.ok(existsSync(join(root, 'src/lib/mcp.ts')), 'mcp lib wrapper missing');
assert.ok(
  read('src/lib/mcp.ts').includes('MCP_CATALOG'),
  'mcp lib must export the community MCP catalog',
);
assert.ok(app.includes('<ToolsPage'), 'App must render ToolsPage');
for (const cmd of ['grok_mcp_add', 'grok_mcp_remove']) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for MCP: ${cmd}`);
}

// v0.4.0: minimal header + model picker in composer footer
assert.ok(app.includes('window-titlebar minimal'), 'Minimal Claude-Desktop-style top bar missing');
assert.ok(app.includes('model-select-footer'), 'Model picker must be in the composer footer');

// Regression guard: conversation panel must be flex (a 2-row grid let the
// TabBar steal the scroll row and collapsed MessageList to 0 height).
assert.ok(
  !css.includes('grid-template-rows: minmax(0, 1fr) auto'),
  'conversation-panel must not use the 2-row grid that collapsed the chat',
);

// v0.4.0: Claude-class history right-click menu — rich, real, persisted.
const ctxMenu = read('src/components/ContextMenu.tsx');
for (const cap of ['submenu', 'shortcut', 'ctx-header', 'ctx-submenu', 'ctx-shortcut']) {
  assert.ok(ctxMenu.includes(cap), `ContextMenu must support ${cap}`);
}
for (const action of [
  'openHistoryMenu',
  'Pin to top',
  'Move to group',
  'Save to Prompt Library',
  'togglePinPrompt',
  'toggleArchivePrompt',
  'deleteSession',
  'setPromptGroupId',
]) {
  assert.ok(app.includes(action), `History context menu missing real action: ${action}`);
}
// History list organized into persisted sections (pinned / group / archived).
for (const piece of [
  'history-section-head',
  'historyView',
  'pinnedPromptIds',
  'promptGroups',
  'archivedPromptIds',
]) {
  assert.ok(app.includes(piece), `History organization missing: ${piece}`);
}
assert.ok(css.includes('.ctx-submenu'), 'submenu flyout style missing');

// v0.4.0 UX pass — regression guards for the polish fixes:
// 1) No duplicate fake macOS traffic-lights (the native titlebar has the real ones).
assert.ok(!app.includes('mac-lights'), 'fake .mac-lights traffic dots must stay removed');
assert.ok(!css.includes('.mac-lights'), 'dead .mac-lights CSS must stay removed');
// 2) Status bar must not cry "Last run failed" before any run happened.
assert.ok(
  app.includes('lastRun && totalRuns > 0'),
  'status bar must gate the last-run label on an actual run (totalRuns > 0)',
);
// 3) Primary buttons use the theme-flipping ink token, not hardcoded white
//    (which is invisible on the dark-theme off-white accent).
assert.ok(
  !/\.composer-send\s*\{[^}]*color:\s*white/s.test(css),
  'composer-send must not hardcode white text (use --accent-ink)',
);
// 4) Restored assistant messages render markdown via the worker, not raw <pre>.
assert.ok(
  read('src/components/MessageItem.tsx').includes('scheduleMarkdownParse'),
  'MessageItem must render restored messages through the markdown worker',
);
// 5) Sidebar must be a flex column whose history list scrolls — a fixed-track
//    grid overflowed with many history items and clipped the composer + bottom
//    buttons (the whole app-shell row grew past 100vh).
assert.ok(
  /\.app-sidebar > \.history-nav\s*\{\s*flex:\s*1 1 auto;\s*\}/.test(css),
  'sidebar must let history-nav flex-grow so the list scrolls, not the sidebar',
);
assert.ok(
  /\.history-list\s*\{[^}]*flex:\s*1 1 auto/s.test(css),
  "history-list must flex + scroll so the sidebar can't grow past the viewport",
);
// 6) The ≤1280px workspace layout must not reserve a dead fixed dock row
//    (it left a big gap below the status bar; docks are absolute overlays).
assert.ok(
  !css.includes('auto auto minmax(0, 1fr) 280px auto'),
  'workspace ≤1280px must not reserve a dead 280px dock row',
);
// 7) Bottom-left status chips (project/model/policy) must be real clickable
//    buttons, not dead text (they open the folder picker / model / permissions).
assert.ok(
  app.includes('className="status-cluster status-action"'),
  'status bar project/model/policy chips must be clickable buttons',
);
assert.ok(
  css.includes('button.status-cluster.status-action'),
  'clickable status chips need a hover affordance',
);
// 8) MCP add must emit per-arg --args=VALUE (clap rejects a bare leading-dash
//    value like npx's -y → "unexpected argument '-y'"). Verified against the
//    real grok CLI.
assert.ok(
  libRs.includes('format!("--args={}"'),
  'grok_mcp_add must emit per-arg --args=VALUE (bare -y is rejected by clap)',
);
assert.ok(
  read('src/lib/mcp.ts').includes('--args=${a}'),
  'MCP command preview must mirror the --args= form the backend runs',
);
// 9) Run config (effort/reasoning/permission/best-of-n) lives in the composer
//    footer, one glance below the chat box.
assert.ok(
  app.includes('composerSection.agentEffort') && app.includes('className="run-select"'),
  'run-config selects must be in the composer footer (below the chat box)',
);
// 10) Top bar: day/night theme toggle + a panels menu (Preview/Context/Terminal/Tools).
assert.ok(
  app.includes('titlebar-icon-btn theme-toggle') && app.includes('<Moon size'),
  'title bar must have a clear day/night (sun/moon) theme toggle',
);
assert.ok(
  app.includes('openPanelMenu') && app.includes('Tools & MCP'),
  'top-right must open a panels menu wired to Preview/Context/Terminal/Tools',
);
// 11) The sidebar lists CONVERSATIONS (sessions), and clicking one switches to
//     that whole conversation — not individual messages within one chat.
assert.ok(
  app.includes('switchToSession') && app.includes('deleteSession'),
  'history rows must switch/delete whole conversations (sessions)',
);
assert.ok(
  app.includes('recentPrompts') && app.includes('tabs') && app.includes('activeTabId'),
  'conversation list must be derived from sessions (tabs)',
);
assert.ok(
  /active \? ["'] active["']/.test(app),
  'the open conversation must be marked active in the sidebar',
);
// 12) Live phase must be spelled out (thinking…/writing…/working…), not just a
//     token counter — the user asked to always see what Grok is doing now.
assert.ok(
  read('src/components/StatusBar.tsx').includes('statusBar.writing') &&
    read('src/components/StatusBar.tsx').includes('statusBar.working'),
  'StatusBar must surface the live phase (writing…/working…)',
);
// 13) Best-of-N defaulting to 1 is behavior-tested in useModelConfig.test.tsx.
// 14) grok-build adaptation: durable guidance goes through --rules (system
//     prompt), NOT a preamble in the user turn (behavior-tested in
//     grokArgs.test.ts). The old 25-line preamble — and especially its FALSE
//     "0 skills … discovered by grok inspect" line — must stay gone (grok
//     discovers its own ecosystem; we never echo it back wrong).
assert.ok(
  !app.includes('Grok Desktop Professional Coding Session'),
  'the heavy user-turn preamble must be removed',
);
assert.ok(
  !app.includes('discovered by grok inspect.'),
  "must not echo grok's ecosystem back to it (the old line hard-said 0 skills)",
);

// 15) Grok Skills hub — curated catalog + real install (writes SKILL.md to
//     ~/.grok/skills) so grok-build discovers it.
assert.ok(
  read('src/lib/skills.ts').includes('SKILL_CATALOG') &&
    read('src/lib/skills.ts').includes('install_grok_skill'),
  'skills lib must ship a catalog + install wrapper',
);
for (const cmd of ['list_grok_skills', 'install_grok_skill', 'remove_grok_skill']) {
  assert.ok(libRs.includes(cmd), `missing Tauri command for skills: ${cmd}`);
}
assert.ok(
  read('src/components/ToolsPage.tsx').includes('SKILL_CATALOG') &&
    read('src/components/ToolsPage.tsx').includes('tools-tab'),
  'Tools page must expose a Skills tab',
);

// 16) Security hardening guards.
// marked does not sanitize its HTML — every dangerouslySetInnerHTML value in
// MessageItem must go through the DOMPurify wrapper.
const messageItem = read('src/components/MessageItem.tsx');
assert.ok(
  messageItem.includes('sanitizeHtml('),
  'MessageItem must sanitize worker HTML before dangerouslySetInnerHTML',
);
assert.ok(
  !messageItem.includes('__html: html'),
  'MessageItem must never inject unsanitized worker HTML',
);
// The preview iframe must stay an opaque origin: allow-scripts combined with
// allow-same-origin would let previewed project JS reach the app's origin.
assert.ok(
  app.includes('sandbox="allow-forms allow-popups allow-scripts"'),
  'preview iframe must keep its sandbox attribute',
);
assert.ok(
  !app.includes('allow-same-origin'),
  'preview iframe sandbox must not include allow-same-origin',
);
// A real CSP must be configured, and script-src must stay clean: no inline
// scripts and no remote script origins in the shipped app. The preview iframe
// no longer depends on the app CSP — it loads from the grokpreview:// custom
// protocol, whose responses carry their own Content-Security-Policy header.
const csp = tauriConf.app?.security?.csp;
assert.ok(
  typeof csp === 'string' && csp.includes("default-src 'self'"),
  'tauri.conf.json must set a real Content-Security-Policy (not null)',
);
const scriptSrc = csp
  .split(';')
  .map((d) => d.trim())
  .find((d) => d.startsWith('script-src'));
assert.ok(scriptSrc, 'CSP must declare an explicit script-src directive');
assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src must not allow 'unsafe-inline'");
assert.ok(
  !scriptSrc.includes('https:') && !scriptSrc.includes('http:'),
  'script-src must not allow remote script origins',
);
assert.ok(!/'unsafe-eval'/.test(scriptSrc), "script-src must not allow 'unsafe-eval'");
// The preview scheme must stay frameable and nothing else remote must be.
assert.ok(
  csp.includes('frame-src grokpreview:'),
  'CSP must allow framing the grokpreview custom protocol',
);
// index.html must not carry inline scripts or remote stylesheet/script tags,
// or the strict script-src/style-src above would silently break the app.
const indexHtml = read('index.html');
assert.ok(
  !/<script(?![^>]*\bsrc=)/i.test(indexHtml),
  'index.html must not contain inline <script> blocks',
);
assert.ok(
  !/https:\/\/fonts\.googleapis\.com|https:\/\/fonts\.gstatic\.com/.test(indexHtml),
  'fonts must be bundled locally, not loaded from Google Fonts',
);
// The Rust preview protocol handler must attach its own CSP to responses.
const rustLib = read('src-tauri/src/lib.rs');
assert.ok(
  rustLib.includes('PREVIEW_DOCUMENT_CSP'),
  'preview scheme responses must carry their own Content-Security-Policy',
);
assert.ok(
  rustLib.includes('register_uri_scheme_protocol'),
  'the grokpreview custom protocol must be registered',
);
// Directory-scoped MCP catalog installs must go through the folder picker —
// never silently expose $HOME.
assert.ok(
  read('src/components/ToolsPage.tsx').includes('pickExposedFolder'),
  'ToolsPage must make the user pick the folder exposed to filesystem/git MCP servers',
);

// ── Production build artifacts ─────────────────────────────────────────────
// The shipped bundle must exist and honour the same security invariants as
// the source: no inline scripts (script-src 'self' would silently block
// them) and no remote script/style/font references (the strict CSP allows
// only local origins, and fonts are bundled).
assert.ok(
  existsSync(join(root, 'dist/index.html')),
  'dist/index.html missing — run `npm run build` before `npm test`',
);
const distIndex = read('dist/index.html');
assert.ok(
  !/<script(?![^>]*\bsrc=)/i.test(distIndex),
  "dist/index.html must not contain inline <script> blocks (blocked by script-src 'self')",
);
assert.ok(
  !/<script[^>]*\bsrc=["']https?:/i.test(distIndex),
  'dist/index.html must not load scripts from remote origins',
);
assert.ok(
  !/<link[^>]*\bhref=["']https?:/i.test(distIndex),
  'dist/index.html must not reference remote stylesheets/fonts',
);
assert.ok(
  !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(distIndex),
  'dist/index.html must not reference Google Fonts (fonts are bundled)',
);
// Every local asset index.html references must actually be in dist/.
for (const [, assetPath] of distIndex.matchAll(/(?:src|href)=["']\/([^"']+)["']/g)) {
  assert.ok(
    existsSync(join(root, 'dist', assetPath)),
    `dist/index.html references missing asset: ${assetPath}`,
  );
}
assert.ok(
  readdirSync(join(root, 'dist/assets')).some((f) => f.endsWith('.js')),
  'dist/assets must contain the built JS bundle',
);

console.log('smoke: ok');
