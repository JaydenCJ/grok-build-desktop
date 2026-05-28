# G2 / G3 — OS-level screen border + agent cursor

**Status:** Design only (implementation deferred — multi-day project)
**Date:** 2026-05-28
**Branch:** TBD (`feature/G2-os-overlay` when scheduled)
**Builds on:** F (run queue), G1 (Chrome-side action UI)
**Estimated effort:** 5–10 days

## User intent

> "操作电脑的时候也是,需要一个屏幕外框有颜色知道范围,还要有自己的鼠标,然后操作的时候不可以影响到使用者正在用电脑。可以参考 codex 和 claude。"

Decomposed:

- **G2 — Screen border overlay.** When Grok is controlling the tab/browser/app, a colored frame around the entire screen makes it impossible for the user to mistake what's happening.
- **G3 — Agent cursor.** A second mouse cursor (visually distinct from the user's) shows where Grok is about to click or has just clicked.
- **Non-interference constraint.** The user's real mouse/keyboard input must keep working normally. Grok's actions must not steal focus or move the user's cursor.

## Reality check on "operating the computer"

Important distinctions before diving into design:

| Comparison | Surface | Mouse/keyboard control |
|---|---|---|
| **Claude in Chrome** | Browser tab only (Chrome extension) | DOM events, never OS-level input |
| **Codex (`computer-use`)** | Sandboxed VM/container | Sends synthetic OS events inside the sandbox; doesn't touch the host |
| **Anthropic computer-use API** | Same as Codex — sandboxed VM | Sandbox events |
| **What the user is asking** | The host macOS desktop, while the user keeps using it | True OS-level synthetic input |

This last row is **fundamentally different** from the other three. Real Claude and Codex don't touch the user's actual desktop — they work in sandboxes or browser DOMs. There is no production agent that controls the host desktop while the user is also using it, because:

1. **Input race.** Two input streams (human + agent) on one cursor cause unpredictable conflicts. Even synthetic events that "don't move the cursor" still race with the user on focus/keyboard.
2. **Security.** macOS treats programmatic clicks as a sensitive capability behind explicit Accessibility + Screen Recording permissions, with multiple confirmation dialogs.
3. **UX collapse.** If the user moves the mouse while the agent is mid-click, both lose.

**Conclusion:** the part that *can* be built without compromise is the **visual layer** — colored screen border + a visible agent cursor that follows where Grok would click. The actual input synthesis stays scoped to the **Chrome extension's DOM events** (which already work today). G2/G3 ship the **affordance** that Codex/Claude offer (you see what the agent is doing) without taking over the host input system.

This document scopes G2/G3 to that visual-only contract. A future G4 could add OS-level input synthesis via Accessibility + permission prompts, but it should be a separate decision because it crosses a clear security boundary.

## Goal (scoped)

When the desktop app is driving a Chrome-extension controlling session (G1):

- A **screen-edge border** appears across all displays, visible regardless of which app is in front.
- An **agent cursor** sprite tracks the position the Chrome extension last reported its action at (or a predicted next-click position).
- Both surfaces are click-through (`pointer-events: none` equivalent at the OS level) so they never block the user's real input.
- Both surfaces dismiss within 300 ms when controlling mode ends.

## Architecture options

### Option A — Tauri transparent always-on-top window (recommended)

A new full-screen, click-through, transparent Tauri window per display. React component inside renders the border + cursor sprite.

```
┌──────────────────────────────────────────────┐
│ Tauri main window (Grok Desktop UI)          │
└──────────────────────────────────────────────┘

  ⬇ when controlling mode starts ⬇

┌──────────────────────────────────────────────┐  ← new overlay window
│                                              │     - tauri::WebviewWindow
│   ┌────────────────────────────────────┐     │     - decorations: false
│   │                                    │     │     - transparent: true
│   │        (user's desktop here,       │     │     - always_on_top: true
│   │         click-through overlay)     │     │     - fullscreen per display
│   │                                    │     │
│   └────────────────────────────────────┘     │
│                                              │
└──────────────────────────────────────────────┘
```

**Tauri 2 supports this directly** via `WebviewWindowBuilder`:

```rust
WebviewWindowBuilder::new(app, "agent-overlay", WebviewUrl::App("overlay.html".into()))
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focusable(false)
    .visible(false)
    .build()?;
```

For click-through on macOS, we need to call `window.set_ignore_cursor_events(true)` (Tauri 2 exposes this via `window.set_ignore_cursor_events`). For multi-display, iterate `tauri::WebviewWindow::available_monitors()`.

**Pros:**
- Pure Rust + Tauri, no Swift sidecar
- Same React/CSS skills already used for the main UI
- Reuses streamStore — overlay window subscribes to the same Tauri events

**Cons:**
- Per-display overlay windows mean managing N windows; display hot-plug requires `WindowEvent` handling
- On macOS, fullscreen-transparent windows behind the menu bar require a small fudge (start at y=24 or use `setFrame` after creation)
- The animated cursor needs RAF-driven position updates over IPC — okay for 30 fps, finicky for 60

### Option B — Swift sidecar (NSWindow + NSCursor)

A separate `Overlay.app` written in SwiftUI that the Tauri app launches as a child process. Uses native AppKit `NSWindow` with `level = .statusBar`, `ignoresMouseEvents = true`, and a `CALayer` for the cursor.

**Pros:**
- True native macOS — best fidelity for the border (proper menu-bar handling, perfect transparency)
- Cursor sprite renders at full 60 fps with negligible CPU
- Native multi-display support

**Cons:**
- Adds a Swift codebase + signing + bundling pipeline (Tauri's bundler doesn't natively embed Swift binaries — needs custom resource step)
- IPC between Rust and Swift child = another protocol layer (probably JSON over stdin/stdout)
- Locks G2/G3 to macOS; Tauri Linux/Windows users get nothing
- Notarization story doubles

### Option C — Browser-only (already shipped in G1)

Keep the screen border and cursor **inside the Chrome viewport**, not the OS screen. This is what G1 ships today. The user knows the agent is controlling Chrome but not "the computer."

**Pros:** zero new work, no permissions.
**Cons:** doesn't satisfy the user's literal ask of a screen-edge border.

### Recommendation: A (Tauri transparent windows)

Lowest cost path to satisfy the visual ask without crossing into OS input synthesis. Defer Option B until/unless 60 fps cursor motion becomes a real complaint.

## Detailed plan for Option A (when scheduled)

### Phase 1 — Overlay window scaffold (1–2 days)

- Add `overlay.html` + `src/overlay.tsx` (separate Vite entry).
- New Tauri command `open_agent_overlay()` / `close_agent_overlay()`.
- Iterate displays via `available_monitors()`, create one borderless transparent window per display, position with `set_position` + `set_size` to cover the full monitor.
- Call `set_ignore_cursor_events(true)`.
- Render a CSS-only orange border identical in spirit to G1's `.gd-frame.controlling` (4 px solid + inset glow + pulse animation).
- Wire to `streamStore`: when `useActiveRun()` is `running` AND the Chrome bridge reports a controlling tab, show the overlay; otherwise hide.

### Phase 2 — Agent cursor sprite (1–2 days)

- In `overlay.tsx`, render a positioned `<div class="agent-cursor">` with the same SVG/clip-path as G1's badge cursor.
- Subscribe to a new Tauri event `grok-desktop://agent-cursor` with `{x, y, label, duration}`.
- Position is in screen coordinates. Chrome extension sends viewport coordinates; the Rust bridge needs to translate via `chrome.windows.get` (browser window position) + browser chrome offset (top of viewport relative to OS window).
- Smooth motion with the same bezier easing used in G1's `animateCursorTo`.

### Phase 3 — Multi-display + hotplug (1 day)

- Listen to `WindowEvent::ScaleFactorChanged` and a custom display-changed watcher to refresh overlay windows.
- Use macOS `NSScreen.didChangeNotification` via objc bridge if the Tauri API doesn't cover it.

### Phase 4 — Permission setup (0.5 day)

- For visual-only G2/G3, no permissions needed (Tauri windows don't need Accessibility unless they synthesize input).
- README addition: mention that the overlay is always-on-top and click-through; if user reports a "stuck on screen" bug, the global toggle is the desktop UI's "Stop" button.

### Phase 5 — Smoke + manual test (0.5 day)

- Smoke guard: `overlay.html` exists, `open_agent_overlay` command registered.
- Manual: confirm border appears on each display, cursor follows scripted moves, both vanish when controlling ends, click-through works (`pointer-events: none` semantics — user can click apps "behind" the overlay).

## Out-of-scope decisions to surface later

- **OS input synthesis (G4).** If we later want Grok to actually click/type at the OS level, that's macOS Accessibility (`CGEventPost`) territory and a separate spec with its own consent and threat model.
- **Recording / screenshots.** If we want the overlay to also surface "Grok is reading this part of the screen", that needs Screen Recording permission. Defer.

## Acceptance (when implemented)

1. With a Chrome controlling tab active, both displays show the orange border.
2. User can interact with any window underneath the overlay; clicks pass through.
3. Closing the controlling state removes both overlays within 300 ms.
4. Hot-plugging a display creates/removes an overlay on it without restart.
5. Agent cursor moves smoothly (≥ 30 fps) and is visually distinct from the system cursor.
6. No new permission prompts vs the baseline app (we don't touch Accessibility for G2/G3).
