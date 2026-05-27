# Chrome Extension

The Chrome extension is a Manifest V3 companion for Grok Desktop.

## Install Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `chrome-extension/` from this project.

## Current Behavior

- Tracks multiple tabs at the same time.
- Shows a polished `GROK_DESKTOP` badge on tabs watched or controlled by the agent.
- Collects lightweight page snapshots across monitored tabs: title, URL, headings, links, form hints, selected text, and a text sample.
- Shows a separate visual agent cursor with smooth visible motion that never captures pointer events.
- Uses extension messages and DOM-level operations instead of the system mouse and keyboard.
- Keeps user tabs usable while agent overlays remain non-interactive.
- Optionally syncs tab state to the Mac app through Chrome Native Messaging.
- Exposes safety toggles for focus guarding, visible cursor motion, and controlled-tab gating.

## Native Bridge

Copy the extension ID from `chrome://extensions`, then either use the Grok Desktop Chrome Agent panel or run:

```bash
python3 scripts/install_chrome_native_host.py --extension-id <chrome-extension-id>
```

The bridge installs:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.grok.desktop.native.json
```

The native host writes extension state to:

```text
~/Library/Application Support/Grok Desktop/chrome_state.json
```

The Mac app reads that file through the `get_chrome_bridge_state` Tauri command.

## Non-Intrusive Control Model

The extension is designed around background-safe operations:

- No OS mouse movement.
- No global keyboard events.
- No forced tab switching for monitored tabs.
- Page overlays use `pointer-events: none`.
- Input operations should target explicit selectors and dispatch DOM `input` / `change` events.
- DOM input/click commands refuse to run by default while the user is focused in an editable field.
- DOM-changing commands are restricted to tabs marked `controlling` by default.
- Grok Desktop does not implement fingerprint changes, CAPTCHA bypass, typo simulation, or stealth automation.

## Limits

- Chrome security pages such as `chrome://` cannot be injected.
- Some sites with strict CSP, iframes, or extension restrictions may block automation.
- Native Messaging requires the local host manifest to match the current unpacked extension ID.
- The first bridge syncs extension state into the Mac app; direct Mac-app initiated tab control is still intentionally narrow.
