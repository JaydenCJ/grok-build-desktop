# Grok Build Desktop — Engineering Handoff

A complete technical handoff: architecture, the grok-CLI integration (the heart of
the app), data model, every feature and where it lives, build/test/release flow,
gotchas, and roadmap. Read this end-to-end before changing the streaming pipeline
or the grok argument builder.

> Paths in this doc are written generically. `<root>` = the repo root. macOS app
> data lives under `~/Library/Application Support/`. No machine-specific paths.

---

## 1. TL;DR

- **What:** a native desktop app for xAI's official `grok` CLI. Claude-Desktop-style
  coding UI: non-blocking streaming, a conversations sidebar, an MCP + Skills hub,
  prompt library, capability inspector, light/dark.
- **Status:** public at `github.com/JaydenCJ/grok-build-desktop`, release `v0.4.0`
  (macOS Apple-Silicon `.dmg`). All tests green; git history scrubbed of private data.
- **It never talks to a model directly.** Every run shells out to the user's
  installed `grok` CLI (`grok -p …`), so it inherits the user's `grok login`.
- **Model path is grok-only.** The model picker shows exactly what `grok models`
  reports (currently just `grok-build`); unknown ids are filtered out.

## 2. Stack & layout

Tauri 2 (Rust) + React 19 + TypeScript + Vite 7.

```
<root>/
  src/                      # React frontend
    App.tsx                 # the app: state, grok arg builder, history, render (~3k lines)
    App.css                 # all styles + design tokens (v0.4.0 "mono graphite")
    main.tsx                # entry + AppErrorBoundary
    components/             # MessageList, MessageItem, StatusBar, QueueDock, Composer,
                            #   CommandPalette, ContextMenu, SettingsPage, ToolsPage,
                            #   DesktopPanel, TraceTimeline, FilePicker
    hooks/                  # useActiveRun, useQueue, useRunSnapshot, useElapsed,
                            #   useSmoothText, usePendingSubmit
    lib/                    # streamStore.ts, markdown.worker.ts, grok.ts, mcp.ts,
                            #   skills.ts, prompts.ts, tabs.ts, desktop.ts
  src-tauri/                # Rust backend
    src/lib.rs              # Tauri commands, grok arg/prompt builders, session state,
                            #   skills, MCP, inspect, folder picker (~2k lines)
    src/runs/               # db.rs, event.rs, parser.rs, process.rs, queue.rs (the run engine)
    src/prompts/mod.rs      # prompt-library SQLite store
    tauri.conf.json         # bundle config, icons, window
    Cargo.toml
  scripts/smoke_test.mjs    # structural regression guards (npm test)
  docs/                     # architecture.md, setup.md, mac.md, screenshots/, this file
```

## 3. Run / build / test

```bash
npm install
npm run tauri:dev          # dev (Tauri window) — also `npm run dev` for the Vite UI in a browser
npm run check              # tsc --noEmit && cargo check     (the fast gate)
npm test                   # node scripts/smoke_test.mjs     (structural guards)
npm run test:unit          # vitest (streamStore, sanitize, traces, files …)
cargo test --manifest-path src-tauri/Cargo.toml              # Rust unit tests
npm run tauri build        # production .app + .dmg under src-tauri/target/release/bundle/
```

**Browser preview is the reliable way to verify UI.** The React app runs in a plain
browser on `:1420` (`npm run dev`). In a browser, Tauri `invoke` fails gracefully
(features that need the backend show "native unavailable"), but all layout, CSS,
menus, theming, and footer options render and are clickable. Driving the _real_
Tauri window with cliclick is fragile on HiDPI/multi-monitor — prefer the browser
for UI checks; use the real app only for grok runs (which need the CLI).

## 4. The run engine (streaming pipeline)

End-to-end, a send flows:

```
Composer.onSubmit
  → args = buildGrokArgs(); args.push('-p', wrapped)      (src/components/Composer.tsx)
  → invoke('enqueue_run', { prompt, cwd, args })          (src/lib/grok.ts)
  → RunQueue.enqueue (Rust)                                (src-tauri/src/runs/queue.rs)
      → spawns `grok … --output-format streaming-json -p …` in a process group
      → reads stdout line-by-line, parse_line → GrokEvent  (runs/parser.rs)
      → broadcasts on a tokio broadcast channel
  → forward_queue_message emits Tauri events:              (src-tauri/src/lib.rs)
      grok-desktop://run-event       { runId, event, raw }
      grok-desktop://run-state-changed
      grok-desktop://queue-changed
  → streamStore.applyRunEvent accumulates a RunSnapshot    (src/lib/streamStore.ts)
  → useSyncExternalStore hooks (useActiveRun/useRunSnapshot/useQueue) re-render
  → MessageItem renders the snapshot; useSmoothText paces the reveal
  → text is parsed to HTML off-thread by the markdown Web Worker
```

**grok streaming-json events (verified against grok 0.2.11):** in `-p` single-turn
mode grok emits ONLY three event types, even for tool-using tasks:
`{"type":"thought","data":…}`, `{"type":"text","data":…}`,
`{"type":"end","stopReason","sessionId","requestId"}`. There are **no** separate
tool/subagent events to parse in this mode, so the parser is complete.

`RunSnapshot` (streamStore): `{ state, lastEventType, text, thoughtChars, textChars,
htmlVersion, startedAt, endedAt, stopReason, error, queue[] }`. `state` ∈
`queued|running|done|failed|cancelled`.

### 4a. No-output watchdog (src-tauri/src/runs/queue.rs)

The reader loop times out **between stdout lines**. The timer resets on every line,
so a grok that's actively thinking (thoughts stream ~20/sec) never trips it; it only
fires when grok is genuinely silent (e.g. blocked on a macOS permission prompt).

```rust
let no_output_secs: u64 = std::env::var("GROK_DESKTOP_NO_OUTPUT_TIMEOUT_SECS")
    .ok().and_then(|v| v.parse().ok()).unwrap_or(420);   // was 240; bumped for Max+plan
// on timeout → kill_group + finalize Failed with:
//   "no output for {n}s — grok went silent. Check for a macOS permission prompt,
//    or lower Effort/Reasoning."
```

This was the root cause of the recurring **"clicked Plan, no reply"** report: a
Max-effort + plan run went silent past 240s (sometimes compounded by a macOS
Apple-Music/media TCC prompt blocking grok) and the watchdog killed it. grok itself
was fine. stderr is drained in a background task (`stderr_tail`) so a full stderr
pipe can't stall stdout, and a non-zero exit surfaces grok's real `error:` line.

### 4b. Typewriter pacing (src/hooks/useSmoothText.ts)

A single rAF loop advances a "shown" cursor toward the full text. Two cadences:

```ts
const step = endedRef.current
  ? Math.min(Math.max(4, Math.ceil(remaining / 20)), 120) // ended: drain tail in ~0.3-0.5s
  : Math.min(Math.max(1, Math.ceil(remaining / 60)), 3); // live: calm ~60-180 cps, never "dumps"
```

Live: caps at 3 chars/frame so a burst (best-of-n, fast model) trails the caret
instead of dumping a wall of text. Ended: drains the remainder quickly but still
types it out rather than snapping. `caretVisible = shown < full.length`.

## 5. The grok integration (the heart) — `buildGrokArgs` / `buildGrokRules` in App.tsx

The user turn is **exactly what the user typed** — no preamble is prepended.
Durable guidance goes to grok's system prompt via `--rules`, not a preamble.
Operational settings ride as real flags, never echoed as prose.

```ts
// buildGrokArgs() — abridged, see App.tsx
["--no-alt-screen", "--output-format", "streaming-json"]
--model <activeModel>                 // only ids from `grok models`
--effort <low|medium|high|xhigh|max>
--reasoning-effort <…>                // "max" → "xhigh" (grok has NO reasoning "max")
--always-approve                      // only when actionPolicy === "autopilot"
--permission-mode <mode>              // only from Settings (advanced); footer "Perm" removed
--best-of-n <2..5>                    // when > 1
--rules "<senior-engineer rules>"     // coding mode; review policy adds a read-only line
--experimental-memory                 // when enabled
--disable-web-search                  // when web search off
--no-subagents                        // ONLY when subagents off AND best-of-n unset (they conflict)
--max-turns 12
-c                                    // continue: when messages.length > 0
--cwd <project>                       // coding mode when a project is selected
-p "<raw user prompt>"                // appended by Composer
```

### grok arg constraints (learned empirically — DO NOT regress)

- `--effort`: `low|medium|high|xhigh|max` (max IS valid here).
- `--reasoning-effort`: NO `max` — its real max is `xhigh`. Sending `max` → exit 2,
  no reply. We map UI "Max" → `xhigh`.
- `--best-of-n` **cannot be combined with `--no-subagents`** ("cannot be used with").
  Only emit `--no-subagents` when best-of-n is unset.
- **Models:** only what `grok models` reports is valid. For this login that's only
  `grok-build`. Hardcoded presets (grok-4.3, grok-build-0.1, …) → "unknown model id"
  exit. The model picker is CLI-driven; presets are a fallback only when the CLI is
  silent. Power users type an exact id via "Custom…".
- `--rules` appends to grok-build's system prompt and the model honours it (verified).
  `--system-prompt-override` replaces the prompt entirely — avoid.
- Defaults (App.tsx state): mode `coding`, model `grok-build`, workflow `analyze`,
  action policy `patch`, effort `medium`, reasoning `off`/auto, best-of-N `1`.
- Diagnose failed runs from `~/Library/Application Support/com.grok.desktop/runs.sqlite`
  (table `runs`: state, error, args_json). Reproduce by running args_json through the
  CLI directly.

The Rust side (`grok_args`/`grok_prompt` in lib.rs) is legacy — used only by the
`run_grok_task` command (not called by the frontend) and tests. The desktop path is
100% the frontend builder above.

## 6. Data model

### Conversations = sessions = tabs (`src/lib/tabs.ts`)

The HISTORY sidebar lists **conversations**, not messages. Each conversation is a
`Tab { id, name, cwd, messages[], createdAt }`. The active tab's `messages`/`cwd`
mirror to flat React state; a `useEffect` writes them back into the active tab.
Tabs persist to localStorage.

`recentPrompts` (App.tsx) derives one row per tab: title = first user prompt (or a
custom label), detail = message count, `lastTs` (newest first), `active` flag.
`switchToSession(id)` persists the current tab then loads the target's
messages/cwd. `deleteSession(id)` removes the tab entirely (and falls back to the
newest remaining, or a fresh empty session) — this fixed "some conversations can't
be deleted" (the old delete only hid a message preview). Archived conversations stay
in `recentPrompts` so they remain searchable via the ⌘K palette.

### Storage

- **localStorage** (WKWebView): conversations/tabs, drafts, mode, theme, effort/
  reasoning/best-of-N, history pin/label/group/archive sets, etc. Keys under
  `storageKeys` in App.tsx (prefix `grok-desktop-…`).
- **`~/Library/Application Support/Grok Desktop/session_state.json`** — round-tripped
  by `load_session_state`/`save_session_state` (mode, drafts, cwd, policy, workflow,
  theme, lastRun, history, messages).
- **`~/Library/Application Support/com.grok.desktop/runs.sqlite`** — the run queue
  (FIFO, survives restart). `prompts.sqlite` — the prompt library.

## 7. Features & where they live

| Feature                                                        | Where                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Conversations sidebar (switch/rename/pin/group/archive/delete) | App.tsx: `recentPrompts`, `switchToSession`, `deleteSession`, `openHistoryMenu`, `renderHistoryRow` |
| Non-blocking streaming + queue                                 | `runs/queue.rs`, `streamStore.ts`, `MessageList/MessageItem`, `StatusBar`, `QueueDock`              |
| Typewriter pacing                                              | `hooks/useSmoothText.ts`                                                                            |
| Live status (thinking…/writing…/working…)                      | `components/StatusBar.tsx` (`stateSuffix`)                                                          |
| Theme toggle (sun/moon)                                        | App.tsx titlebar (`titlebar-icon-btn theme-toggle`) + CSS; ⌘⇧L                                      |
| Connection pill ("● Grok"/Offline)                             | App.tsx `.conn-pill` + CSS                                                                          |
| Panels menu (Preview/Context/Terminal)                         | App.tsx `openPanelMenu`                                                                             |
| Tools & Skills hub                                             | `components/ToolsPage.tsx` + `lib/mcp.ts` + `lib/skills.ts`                                         |
| Prompt library                                                 | App.tsx (`savePromptToLibrary`, inline UI) + `lib/prompts.ts` + `prompts/mod.rs`                    |
| Command palette (⌘K) + search                                  | `components/CommandPalette.tsx` (history rows searchable, IME-safe)                                 |
| Capability inspector                                           | App.tsx context panel + `grok inspect` parsing                                                      |
| macOS desktop bridge                                           | `lib/desktop.ts` + `desktop_*` Tauri commands + `DesktopPanel`                                      |

### Skills hub (new) — `lib/skills.ts` + ToolsPage `[MCP servers][Skills]` tabs

A skill is a folder with a `SKILL.md` (frontmatter `name`/`description` + body).
grok-build discovers skills from `~/.grok/skills` and `~/.claude/skills`. The
catalog (`SKILL_CATALOG`) ships 6 self-contained coding skills (code-review,
write-tests, explain-codebase, debug-rootcause, commit-message, pr-description).
Install writes the `SKILL.md` and grok picks it up next run. Backed by three Tauri
commands in lib.rs:

```rust
list_grok_skills() -> Vec<String>          // dirs containing SKILL.md in ~/.grok/skills + ~/.claude/skills
install_grok_skill(slug, body) -> Result   // writes ~/.grok/skills/<slug>/SKILL.md (slug sanitized)
remove_grok_skill(slug) -> Result          // removes the dir if it has a SKILL.md
```

## 8. Design system (App.css)

v0.4.0 "mono graphite": no chromatic accent, hierarchy from weight/opacity. Tokens in
`:root` (dark) overridden under `[data-theme="light"]`. Key tokens: `--bg-0..5`,
`--text-1..4`, `--border(/-2/-strong)`, `--accent` (off-white), semantic
`--success/--warn/--error/--info`, and motion: `--ease-out`
`cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out`, `--press`.

Polish conventions applied (impeccable + emil): custom ease-out on interactions; a
global `@media (prefers-reduced-motion: reduce)` block that collapses animations;
context menus scale from their origin (`ctx-menu-in`); press feedback is the house
`translateY(1px)` idiom. **Gotcha:** header controls need `flex-shrink: 0` and the
titlebar icon `svg` is pinned to `17×17` — without it the wider conn-pill squished
the theme toggle to a 2px sliver (looked like a "dot").

## 9. Tests / guards

- `scripts/smoke_test.mjs` — structural regression guards (string presence) over
  App.tsx / lib.rs / CSS. Update guards when you rename things (they're matched
  literally). Recent guards cover: conversations (`switchToSession`/`deleteSession`),
  streaming status, Best-of-N default, `--rules` usage, no-preamble, Skills hub,
  theme toggle (`titlebar-icon-btn theme-toggle` + `<Moon size`).
- `vitest` — streamStore, sanitization, trace/file parsing, hooks.
- `cargo test` — runs/queue/parser + prompts.
- Always run `npm run check && npm test` before committing; CI
  (`.github/workflows/ci.yml`) runs build + vitest + smoke on ubuntu and
  `cargo check`/`cargo test` on macOS for every push/PR.

## 10. Privacy / security (this is a public repo)

- **Absolute rule:** never commit private data. Banned in tree AND history: the
  owner's personal email addresses, any bot token / chat id, and machine-specific
  absolute paths. The only public contact is `gijirokuman@gmail.com`.
- History was scrubbed with `git filter-repo --mailmap` (all authors →
  `JaydenCJ <gijirokuman@gmail.com>`) + `--replace-message` (co-author trailers).
  Because force-pushing `main` does NOT purge commits GitHub still references via
  merged-PR refs, the repo was **deleted and recreated** from the clean local
  history (verified old commit SHAs return 404), then made public.
- `.gitignore` covers `.env*`. `.env.example` documents only `GROK_DESKTOP_*` +
  optional API keys. No `.env` is tracked.
- Telegram remote daemon and the Chrome companion extension were **removed** earlier
  (deps `teloxide`/`dotenvy` dropped). Don't reintroduce secrets if you re-add them.

## 11. Release process

```bash
npm run tauri build                                  # builds .app + .dmg (aarch64)
gh release create vX.Y.Z "<clean-named>.dmg" \
  --repo JaydenCJ/grok-build-desktop \
  --title "Grok Build Desktop vX.Y.Z" --notes-file notes.md --latest
```

The `.dmg` is **ad-hoc signed, not Apple-notarized** → Gatekeeper blocks first
launch. Release notes MUST include the workaround:
`xattr -dr com.apple.quarantine "/Applications/Grok Build Desktop.app"` (or
right-click → Open). The build is **Apple Silicon only**; Windows/Intel = build from
source. README header has a "Download for macOS" button → `/releases/latest`.

> Admin/delete GitHub operations (e.g. recreating the repo) need the `delete_repo`
> scope on a `gh` account with admin rights: `gh auth refresh -h github.com -s delete_repo`.

## 12. Known issues / gotchas

- **Un-notarized macOS app** → Gatekeeper friction (see §11). Notarization needs an
  Apple Developer cert (Team ID on file) — a future paid step.
- **No-project state:** with no project selected, grok runs in a fallback cwd and may
  answer about the wrong directory / trigger a media-library TCC prompt. Pick a
  project (`--cwd`) to scope it. Consider prompting to pick a project on first run.
- **`-c` (continue)** is added whenever the UI conversation has messages. Since the
  UI is effectively single-conversation, this is fine, but a precise multi-session
  model would capture the `sessionId` from the `end` event and resume with
  `-r <sessionId>` instead.
- **cliclick verification is fragile** on HiDPI/multi-monitor — use the Vite browser
  preview (`preview_*` tools) for UI checks.
- **smoke guards are literal string matches** — rename a symbol, update the guard.

## 13. Roadmap / next steps

- Plan Mode view (separate plan from apply; the raw `--permission-mode plan` is the
  primitive, exposed in Settings).
- Sub-agent visualization for best-of-n / fan-out runs.
- `@path` file references in the composer + an inline diff viewer.
- Session pinning via `-r <sessionId>` (see §12).
- A larger, community-driven Skills catalog.
- Notarization for a friction-free macOS download; a Linux build target.
