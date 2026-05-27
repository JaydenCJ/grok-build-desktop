# Grok Desktop

Grok Desktop is a Grok-first desktop programming environment for professional engineers. The product direction is a Claude Desktop-style app centered on the official Grok Build CLI, with repository context, streamed terminal output, coding workflows, Chrome context, and local tool integrations.

- **Grok Chat**: quick questions, product thinking, explanations, and non-code tasks.
- **Grok Code**: repository inspection, implementation, debugging, reviews, tests, refactors, and terminal verification.

The current build focuses on making Grok feel like a native coding desktop app rather than a raw CLI wrapper. Grok is the only model path exposed in the UI.

## Quick Start

```bash
cd "/Users/you/Projects/grok-desktop"
npm install
npm run tauri:dev
```

macOS release bundle:

```bash
npm run mac:build
```

Generated artifacts land under `src-tauri/target/release/bundle/`.

Stable local install path:

```bash
npm run mac:install
```

This builds and signs the `.app` with the local ad-hoc identity, copies it to `~/Applications/Grok Desktop.app`, verifies the signature, and opens that installed app. Use this command for day-to-day upgrades so macOS sees a stable bundle identifier and install path. DMG packaging is available separately with `npm run mac:build:dmg`.

Useful checks:

```bash
npm run doctor
npm run build
npm run check
```

## Python Tool Layer

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

Copy the example env file if you want a local reference:

```bash
cp .env.example .env
```

Tauri dev does not automatically load `.env`; export values in your shell before starting the app.

## Mode Switching

Use the mode switch in the left sidebar:

- **Grok Chat** keeps its own task draft.
- **Grok Code** keeps a separate engineering task draft.
- The selected mode is persisted in browser storage.
- Grok calls receive mode-specific context before the user task.
- Keyboard shortcuts: `Cmd+1` for Grok Chat, `Cmd+2` for Grok Code.

## Grok Code Workflow

Coding Mode is designed for professional programmers:

- Grok Build CLI is the primary runner.
- Task presets cover Analyze, Implement, Review, Debug, Tests, and Refactor.
- Action policies control the expected behavior: Review only, Patch ready, or Autopilot.
- Project Path sets the subprocess working directory for Grok and local terminal commands.
- Output streams in real time and keeps a compact run history.
- The Terminal card runs local `zsh -lc` commands in the same project path for manual verification.

## Supported Backends

### Grok Build CLI

Primary coding backend and headless subprocess runner. Coding Mode uses a streaming wrapper (`callGrokCLI(prompt, options)`) so stdout/stderr appears in the desktop output panel while the command is running.

Default command:

```bash
grok --no-alt-screen --model <selected-model> --effort <agent-effort> \
  [--reasoning-effort <reasoning-effort>] [--best-of-n <n>] \
  [--experimental-memory] [--disable-web-search] [--no-subagents] \
  [--permission-mode <mode>] [--check] \
  --max-turns 12 -p "<mode context + user task>" --output-format plain
```

Optional overrides:

```bash
export GROK_DESKTOP_GROK_CMD="grok"
export GROK_DESKTOP_GROK_ARGS="--no-alt-screen --model grok-build --effort high -p {prompt} --output-format plain"
export GROK_DESKTOP_GROK_CHECK=true
```

Coding Mode also accepts a project path in the UI. That path is passed as the subprocess working directory, so Grok can read files and reason from the selected repository.

Grok Desktop wraps the user task with an engineering prompt contract before calling Grok. The contract includes the selected workflow, action policy, model engine, Grok effort, reasoning effort, permission mode, Best-of-N, memory, web search, subagents, self-check setting, project path, and discovered Grok ecosystem counts. It asks Grok to read relevant files, keep changes focused, avoid destructive commands, include evidence and file paths, and provide exact verification commands.

The Context panel uses:

```bash
grok models
grok inspect
grok mcp list
grok mcp doctor
grok plugin list
grok sessions list
```

to show the selected model, discovered skills, MCP servers, agents, plugins, hooks, permissions, managed MCP/plugin state, sessions, and project trust.

Login and auth:

- The Coding Mode panel checks whether `grok` is installed and whether Grok Desktop can see a cached login or `XAI_API_KEY`.
- Click **Use Grok Login** to open Terminal and run the official `grok login` flow.
- Click **Device Login** to run `grok login --device-auth` when browser-based login is inconvenient.
- After finishing login, return to Grok Desktop and click **Refresh**.

Alternative API-key auth:

```bash
export XAI_API_KEY="..."
```

### browser-use

Browser automation runner through `scripts/browser_automation.py`.

```bash
export BROWSER_USE_API_KEY="..."
python3 scripts/browser_automation.py \
  --task "Open https://example.com and report the heading" \
  --max-steps 10
```

### Chrome Extension

The `chrome-extension/` directory contains an unpacked Manifest V3 companion.

Install:

```text
chrome://extensions -> Developer mode -> Load unpacked -> chrome-extension/
```

Optional native bridge:

```bash
python3 scripts/install_chrome_native_host.py --extension-id <chrome-extension-id>
```

You can also paste the extension ID into the Grok Desktop Chrome Agent panel and click **Install Host**.

It supports multi-tab monitoring, a visible GROK_DESKTOP badge on watched tabs, lightweight page snapshots, a non-interactive agent cursor overlay, and a native state bridge that the Mac app can read. See `docs/chrome-extension.md`.

Responsible automation notes are in `docs/responsible-automation.md`.

### Repository Absorption

Local repo:

```bash
python3 scripts/absorb_repo.py /path/to/repo --copy-text
```

Remote repo:

```bash
python3 scripts/absorb_repo.py https://github.com/owner/repo.git --copy-text --depth 1
```

The script writes:

- `absorbed/<repo>/manifest.json`
- `absorbed/<repo>/summary.md`
- `absorbed/<repo>/files/` when `--copy-text` is enabled

### Phone Control

The app detects:

```bash
scrcpy --version
scrcpy-mcp --version
```

Task execution for phone control is reserved for the next integration pass.

## Environment Variables

```bash
GROK_DESKTOP_PYTHON=python3
GROK_DESKTOP_GROK_CMD=grok
GROK_DESKTOP_GROK_ARGS="--no-alt-screen --model grok-build --effort high -p {prompt} --output-format plain"
GROK_DESKTOP_GROK_CHECK=false
GROK_DESKTOP_COMMAND_TIMEOUT_SECS=240
GROK_DESKTOP_GROK_STARTUP_TIMEOUT_SECS=240
GROK_DESKTOP_GROK_SILENT_ANSWER_TIMEOUT_SECS=180
GROK_DESKTOP_GROK_MAX_TURNS=12
XAI_API_KEY=
BROWSER_USE_API_KEY=
```

`{prompt}` receives the mode context plus the current task. `{mode}` is also available in argument templates. Grok Desktop also emits heartbeat progress while headless Grok is silent, supports Stop from the UI, applies a bounded default turn limit, and cleans up the spawned process tree when a run is stopped or times out.

## Current Features

- Tauri desktop window launches.
- macOS dev, app bundle, optional DMG, and stable local install scripts are available through `npm run mac:dev`, `npm run mac:build`, `npm run mac:build:dmg`, and `npm run mac:install`.
- Grok Chat/Grok Code mode switch is persisted and keeps separate drafts.
- Grok Code starts as the default professional workflow.
- The primary UI is a Claude Desktop/Codex-style developer workbench: spaces, projects, history, task conversation, Grok context inspector, approvals, and terminal dock.
- The visual direction now follows a Grok/xAI-style command surface with a dark left rail and top command bar, bright work area, and a right capability inspector.
- Coding workflows include Analyze, Implement, Review, Debug, Tests, and Refactor.
- Action policies include Review only, Patch ready, and Autopilot.
- Grok run controls include selectable effort, permission mode, optional `--check` self-verification, and a Stop action for long-running headless jobs.
- Grok and browser-use subprocess calls are wrapped with timeouts and clear errors.
- Grok Build CLI defaults to `grok-build` with Medium effort, but the UI can select `grok-build-0.1`, Grok 4.x aliases, fast reasoning/non-reasoning presets, or a custom model ID accepted by the installed Grok CLI. Effort, reasoning effort, Best-of-N, memory, web search, subagents, permission mode, and Grok's headless `--check` self-verification are all exposed in the UI. Web search and subagents default off for local code tasks so ordinary repo analysis does not automatically fan out into unrelated remote or MCP work.
- Grok Build CLI supports project working directories and realtime stdout/stderr streaming in Coding Mode.
- Grok Capability inspector exposes tabs for Context, Skills, MCP, Agents, Plugins, Hooks, and Permissions. It combines `grok inspect` discovery with managed `grok mcp`, `grok plugin`, and `grok sessions` commands.
- Local Terminal commands can run through `zsh -lc` from the selected project path.
- Desktop sessions restore the selected mode, drafts, project path, Chrome extension ID, and recent run history after app restart.
- Tool health checks Grok, browser-use, scrcpy, and scrcpy-mcp.
- Doctor check can be run from the UI or with `npm run doctor`.
- Chrome companion extension with GROK_DESKTOP tab badge, multi-tab list, page snapshots, and non-intrusive agent cursor overlay.
- Optional Chrome Native Messaging bridge writes monitored tab state to macOS Application Support for the Tauri app.
- Browser automation runs through a Python bridge.
- Absorb Repo can inspect local repositories or clone remote git URLs.
- Absorb Repo writes a manifest, language stats, important-file list, command hints, and summary.
- Output panel shows command, cwd, duration, exit code, timeout state, stdout/stderr, and run history.
- UIUX concept art generated with `imagegen` is saved at `docs/design/grok-desktop-uiux-concept.png`, `docs/design/grok-desktop-grok-style-uiux-v2.png`, the restrained dark/light direction at `docs/design/grok-desktop-restrained-dark-light-uiux.png`, and the latest power-clean 10-point direction at `docs/design/grok-desktop-10pt-power-clean-ui.png`.

## Known Limits

- Grok must be installed and logged in. browser-use, scrcpy, and scrcpy-mcp are optional external tools and must be installed separately.
- The current macOS bundle uses local ad-hoc signing but is not notarized. Developer ID signing and notarization are required for the smoothest public distribution and fewer macOS trust prompts.
- browser-use requires a configured `BROWSER_USE_API_KEY` unless you modify the bridge to use another supported LLM.
- The Chrome extension is currently an unpacked local companion. The first bridge is extension-to-app state sync; direct app-to-extension command dispatch is still a later hardening task.
- Chrome Native Messaging requires installing the local manifest with the current unpacked extension ID.
- Phone-control execution is not implemented yet; Grok Desktop currently only detects scrcpy/scrcpy-mcp.
- `.env` is a reference file only; export variables in the shell before launching Tauri.

## Open Source and License Compliance

Grok Desktop currently calls optional external tools by subprocess or package import. It does not vendor or copy their protected source code.

Key third-party projects:

- browser-use: MIT, https://github.com/browser-use/browser-use
- scrcpy: Apache-2.0, https://github.com/Genymobile/scrcpy
- scrcpy-mcp: MIT, https://github.com/JuanCF/scrcpy-mcp
- Tauri: MIT or Apache-2.0, https://github.com/tauri-apps/tauri
- React: MIT, https://github.com/facebook/react
- lucide-react: ISC/MIT notices, https://github.com/lucide-icons/lucide

See `THIRD_PARTY_NOTICES.md` for attribution and packaging notes. The Grok Desktop prototype source itself is currently `UNLICENSED`; add an explicit OSS license before public redistribution if you decide to open source it.
