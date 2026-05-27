# Grok Desktop Setup

## Desktop

```bash
npm install
npm run tauri:dev
```

## Python Tools

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

## External CLIs

- `goose`: used by the primary Agent button.
- `grok`: used by the Grok button in headless subprocess mode.
- `browser-use`: used by the Browser tool through `scripts/browser_automation.py`.
- `scrcpy` and `scrcpy-mcp`: detected in tool health for phone-control expansion.

Copy `.env.example` to `.env` if you want a local reference for environment variables.

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
