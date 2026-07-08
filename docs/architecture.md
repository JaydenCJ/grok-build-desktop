# Grok Desktop Architecture

Grok Desktop is a Tauri 2 desktop shell with a React workbench and Rust command bridge.

## Runtime Layers

- React renders the mode switch, task runner, Grok command bar, capability inspector, tool health, and script entry points.
- The React shell is organized as a Grok/xAI-style developer workbench: dark left workspace navigation, top model/effort/permission controls, center Grok task conversation, right capability inspector, terminal dock, and toolbelt.
- Tauri commands in `src-tauri/src/lib.rs` call local subprocesses.
- Grok Build runs through `grok -p` (`GROK_DESKTOP_GROK_CMD` overrides the executable).
- Coding Mode calls Grok through `src/lib/grok.ts::callGrokCLI(prompt, options)`, which listens to Tauri `grok-desktop://grok-stream` events while the Rust bridge owns the subprocess.
- The Grok runner forwards selected model, effort, reasoning effort, Best-of-N, memory, web search, subagents, permission mode, and self-check settings.
- Grok auth status is detected without reading secrets: Grok Desktop checks installation, `XAI_API_KEY`, and whether `~/.grok/auth` contains cached login data.
- Grok login starts in Terminal through `start_grok_login`, keeping the official CLI authorization flow outside the app.
- Grok ecosystem discovery runs through `grok inspect`, while managed capability commands use `grok mcp list`, `grok mcp doctor`, `grok plugin list`, and `grok sessions list`.
- The right inspector separates Context, Skills, MCP, Agents, Plugins, Hooks, and Permissions so discovered Claude-compatible skills/plugins and active Grok-managed resources are both visible.
- Browser automation runs through `scripts/browser_automation.py` and the `browser-use` Python package.
- Repository absorption starts with `scripts/absorb_repo.py` and writes manifests under `absorbed/`.
- The Absorb Repo panel calls the same script through the Rust bridge, so terminal and desktop behavior stay aligned.
- The Mac app persists session state through `load_session_state` and `save_session_state` at `~/Library/Application Support/Grok Desktop/session_state.json`.
- External commands are wrapped with a timeout so missing or stuck CLIs do not permanently block the app.
- Grok streaming uses a selected working directory so future ACP, Plan Mode, or sub-agent backends can preserve the same prompt/cwd contract.
- The current visual direction is captured in `docs/design/grok-desktop-uiux-concept.png`, the Grok/xAI iteration in `docs/design/grok-desktop-grok-style-uiux-v2.png`, the restrained pure dark/light system in `docs/design/grok-desktop-restrained-dark-light-uiux.png`, and the latest power-clean 10-point direction in `docs/design/grok-desktop-10pt-power-clean-ui.png`.

## Platform Adapter Shape

- `AgentBackend`: subprocess or API caller such as Grok Build or browser-use.
- `DeviceAdapter`: reserved for scrcpy/scrcpy-mcp now, with iOS/Android app bridges planned as separate adapters.

## Environment Overrides

- `GROK_DESKTOP_PYTHON`: Python executable for scripts and package checks.
- `GROK_DESKTOP_GROK_CMD`: Grok CLI executable.
- `GROK_DESKTOP_GROK_STARTUP_TIMEOUT_SECS`: startup watchdog for streaming Grok runs with no stdout/stderr activity. Defaults to 240 seconds.
- `GROK_DESKTOP_GROK_SILENT_ANSWER_TIMEOUT_SECS`: watchdog for Grok runs that keep logging internally but produce no user-visible answer. Defaults to 180 seconds.
- `XAI_API_KEY`: optional Grok API key auth visible to the spawned CLI process.

## Next Integration Targets

- Promote the session JSON store into a local SQLite conversation store with searchable transcripts.
- Promote Grok MCP add/remove, plugin install/update, and sessions search into safe UI flows.
- Package `scripts/` as Tauri resources for release builds.
- Add direct app-to-extension command routing with explicit user approval controls.
- Add scrcpy and scrcpy-mcp task controls beyond status detection.
