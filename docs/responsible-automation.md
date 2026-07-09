# Responsible Automation

Grok Build Desktop treats automation as an assistive, visible user experience —
not a stealth or bypass system.

## What Ships Today

- Browser automation runs a real, visible browser through the `browser-use`
  package (`scripts/browser_automation.py`). No fingerprint masking or
  automation-flag hiding is configured.
- The macOS desktop bridge (`src-tauri/src/desktop.rs`) is read-only:
  allowlisted apps only, hard-coded AppleScript with no interpolated input,
  and every call is audited to `~/.grok-desktop/audit/`.
- Grok runs are plain subprocesses of the user's own logged-in `grok` CLI,
  with permission behavior surfaced in the UI (action policy and permission
  mode map to real CLI flags).

There is no browser extension, Native Messaging bridge, or screen-overlay
window in this codebase (an earlier click-through agent-overlay experiment
was removed). The rules below bind any future reintroduction of such
surfaces.

## What We Do Not Implement

- Browser fingerprint masking.
- WebDriver or automation flag hiding.
- Canvas, WebGL, Audio, TLS, proxy, or network identity manipulation.
- CAPTCHA bypass.
- Typo simulation or deceptive keystroke behavior.
- Hidden OS mouse or keyboard control.
- Automation intended to violate a website's terms or security controls.

## Product Rule

Agent behavior must be visible, user-authorized, focus-safe, and reversible.
If a site or workflow requires human confirmation, Grok Build Desktop should
hand control back to the user instead of trying to disguise automation.
