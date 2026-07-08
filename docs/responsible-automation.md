# Responsible Automation

Grok Build Desktop treats automation as an assistive, visible user experience —
not a stealth or bypass system.

## What Ships Today

- Visible Agent presence: the agent overlay (`overlay.tsx`,
  `set_agent_overlay`/`set_agent_cursor`) draws a click-through screen border
  and an animated cursor sprite while Grok is acting. It is strictly visual —
  no OS mouse or keyboard synthesis.
- Browser automation runs a real, visible browser through the `browser-use`
  package (`scripts/browser_automation.py`). No fingerprint masking or
  automation-flag hiding is configured.
- The macOS desktop bridge (`src-tauri/src/desktop.rs`) is read-only:
  allowlisted apps only, hard-coded AppleScript with no interpolated input,
  and every call is audited to `~/.grok-desktop/audit/`.
- Grok runs are plain subprocesses of the user's own logged-in `grok` CLI,
  with permission behavior surfaced in the UI (action policy and permission
  mode map to real CLI flags).

A previous iteration shipped a Chrome companion extension with a Native
Messaging bridge; it has been removed from this codebase. The rules below
still bind any future reintroduction.

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
