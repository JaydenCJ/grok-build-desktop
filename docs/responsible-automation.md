# Responsible Automation

Grok Desktop treats browser control as an assistive user experience, not a stealth or bypass system.

## What We Adopted

- Visible Agent presence: monitored tabs show a GROK_DESKTOP badge and an Agent cursor.
- Calm motion: cursor movement uses a smooth visual path so users can follow what the Agent is doing.
- Focus guard: page changes are blocked by default while the user is typing in an editable field.
- Control gating: DOM-changing actions are limited to tabs explicitly marked as controlled.
- Multi-tab clarity: watched and controlled tabs stay visible in the extension popup and Mac app bridge panel.
- Explicit state sync: Chrome Native Messaging writes tab state to macOS Application Support for the desktop UI.

## What We Do Not Implement

- Browser fingerprint masking.
- WebDriver or automation flag hiding.
- Canvas, WebGL, Audio, TLS, proxy, or network identity manipulation.
- CAPTCHA bypass.
- Typo simulation or deceptive keystroke behavior.
- Hidden OS mouse or keyboard control.
- Automation intended to violate a website's terms or security controls.

## Product Rule

Agent behavior must be visible, user-authorized, focus-safe, and reversible. If a site or workflow requires human confirmation, Grok Desktop should hand control back to the user instead of trying to disguise automation.
