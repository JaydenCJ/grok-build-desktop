# Grok Build Desktop Setup

## Prerequisites

- **Node.js** 18+ and **npm**.
- **Rust** (stable) plus the Tauri prerequisites for your OS —
  <https://tauri.app/start/prerequisites/>. macOS is the primary target; on
  Linux you additionally need the Tauri system libraries (`webkit2gtk-4.1`,
  GTK 3, etc.).
- **Grok Build CLI** installed and logged in (`grok login`) — the primary
  runner. The app can also open Terminal and walk you through installing it.

## Desktop

```bash
npm install
npm run tauri:dev
```

Copy `.env.example` to `.env` if you want a local reference for environment
variables. Tauri dev does **not** auto-load `.env` — export the values in your
shell before launching.

## Python Tools (optional)

Only needed for the browser-use bridge, repository absorption, and the
environment doctor:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## External CLIs and packages

- `grok`: the primary runner. Streaming chat/coding runs shell out to it with
  `--output-format streaming-json`.
- `browser-use` (Python package): used by the Browser tool through
  `scripts/browser_automation.py`; requires `BROWSER_USE_API_KEY`.
- `scrcpy` and `scrcpy-mcp`: optional. They are only _detected_ by the
  environment doctor (`npm run doctor`); the app does not drive them.

## Checks and tests

```bash
npm run check        # tsc --noEmit && cargo check
npm test             # smoke test (scripts/smoke_test.mjs; needs a prior `npm run build`)
npm run test:unit    # vitest (unit + component tests)
npm run test:e2e     # headless-Chromium end-to-end test (needs a prior `npm run build`)
npm run coverage     # vitest with V8 coverage report
npm run lint         # eslint (CI gate; warnings fail)
npm run format:check # prettier check (`npm run format` rewrites)
cargo test --manifest-path src-tauri/Cargo.toml
npm run doctor      # JSON health report for grok, auth, and optional tools
```

Every check above is headless and platform-independent. CI runs the frontend
checks (lint, format, build, vitest, smoke) and the headless-Chromium e2e
test on ubuntu, and the Rust suite on macOS (fmt, check, clippy, test) and
Windows (check, test). Integration testing of the actual Tauri binary — the
real app window and webview — is only possible at runtime on macOS or
Windows, the two supported targets.

## Repository Absorption

Local:

```bash
python3 scripts/absorb_repo.py /path/to/repo --copy-text
```

Remote:

```bash
python3 scripts/absorb_repo.py https://github.com/owner/repo.git --copy-text --depth 1
```

Outputs land under `absorbed/<repo>/`.
