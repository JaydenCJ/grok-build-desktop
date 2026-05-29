# Grok Build Desktop — UI Design Handoff

**For:** Claude Design (or any designer / design agent)
**From:** Engineering implementation already at commit `869dd39` on branch `feature/v0.3.0-polish-and-features` ([PR #4](https://github.com/JaydenCJ/grok-build-desktop/pull/4))
**Date:** 2026-05-29
**Status:** App is functional end-to-end. Design pass requested to take it from "engineer-acceptable" to **premium desktop app** quality — Claude Desktop / Codex / Cursor tier.

---

## TL;DR for the designer

This is a **Tauri 2 desktop client for the `grok` CLI** (xAI's Grok Build / Code agent). Think Claude Desktop, but for Grok. It already works (streams answers, queues runs, integrates Chrome, supports Telegram remote control, has a prompt library). The current visuals are an engineer's first pass — functional, themed in Grok orange on dark, but lacking the polish that makes Claude Desktop / Codex feel premium.

**You design. We implement.** Deliver Figma frames, design tokens, or annotated PNGs — we'll translate to React + CSS.

---

## How to clone + run

```bash
git clone -b feature/v0.3.0-polish-and-features https://github.com/JaydenCJ/grok-build-desktop.git
cd grok-build-desktop
npm install
# Either:
npm run tauri:dev       # live dev with hot reload
# Or for the real packaged app:
npm run mac:install     # builds + installs to ~/Applications/Grok Desktop.app
open ~/Applications/Grok\ Desktop.app
```

Hardware target: macOS first (Apple Silicon + Intel). Windows / Linux are stretch — design should work on light backgrounds too.

---

## What the app does

| Surface | Function |
|---|---|
| **Composer** (bottom) | Type a prompt, hit Enter (or Shift+Enter for newline). Send / Enqueue button. |
| **MessageList** (center) | Streaming chat — user messages + Grok responses with markdown rendering. |
| **StatusBar** (under chat) | `✦ 7m 48s · ≈2.1k tokens · thinking…` (Claude-Code-style). |
| **QueueDock** (above status) | When run in progress: `▶ Running 1m 24s · +N queued`. Click to expand the queue with per-item cancel. |
| **Sidebar** (left) | New Session, Search, Tools, Settings + history of past prompts. |
| **Workspace toolbar** (top) | Repo picker, Grok model selector, panels (Preview/Context/Terminal/Tools), dock position, Dark/Light theme, Connected badge. |
| **Workspace statusbar** (bottom-bottom) | `/path · grok-build · Patch ready · Last run ok · N runs · Clear`. |
| **Empty state** | Starter card grid: "Review this repo / Explain this codebase / Add a failing test / Suggest the next change". |
| **Chrome extension overlay** | When extension is in "controlling" mode, browser tabs show a Grok badge + orange viewport frame. |
| **(Future) Plan Mode** | When run has `--permission-mode plan`, show plan steps + Accept/Reject buttons (not yet built). |
| **(Future) Sub-agent visualization** | DAG / timeline of sub-agents (not yet built — most "soul"-defining feature in the roadmap). |
| **(Future) File / editor integration** | @file mentions, Monaco editor, diff viewer (not yet built). |

---

## Design system already in place

These CSS variables drive every surface — please **respect / extend, don't replace**:

```css
:root {
  /* xAI dark base */
  --grok-bg-0: #0b0e13;          /* deepest, app background */
  --grok-bg-1: #11151c;          /* surface 1 */
  --grok-bg-2: #161b24;          /* surface 2 (panels) */
  --grok-bg-3: #1d2330;          /* surface 3 (cards) */
  --grok-bg-4: #252b3a;          /* hover */

  --grok-border-1: rgba(255, 255, 255, 0.06);
  --grok-border-2: rgba(255, 255, 255, 0.12);
  --grok-border-3: rgba(255, 255, 255, 0.20);

  --grok-text-1: #e8ecf4;        /* primary */
  --grok-text-2: #b6bdcc;        /* secondary */
  --grok-text-3: #828aa0;        /* tertiary */
  --grok-text-4: #525a72;        /* faint */

  /* Brand warm-orange (Grok / xAI vibe) */
  --grok-accent:    #ff7a45;     /* primary action / active state */
  --grok-accent-hi: #ff9466;     /* hover */
  --grok-accent-lo: #d65a2a;     /* pressed */

  /* Semantic */
  --grok-success: #4ade80;
  --grok-warning: #facc15;
  --grok-danger:  #f87171;
  --grok-info:    #60a5fa;
}
```

Light theme is `data-theme="light"` on `<body>`. Same token names, light values.

**Fonts:**
- UI: Inter (with `cv11 / cv05 / ss01` features for tabular nums + clean lowercase)
- Mono (code blocks, status bar timing): JetBrains Mono, SF Mono fallback
- Code highlighting: Catppuccin-inspired palette already wired into `highlight.js`

**Brand mark:** Currently using `✦` (six-pointed angular star) as the activity indicator. Open to replacement with a custom Grok-style logo if you have a better one.

---

## Brand direction — what Grok should FEEL like

| Feel like | Don't feel like |
|---|---|
| **xAI** — angular, technical, confident, fast | Claude — soft, conversational, lavender |
| **Codex** — power user, no-bullshit | GitHub Copilot — friendly assistant |
| **Cursor** — dense info, every pixel earns its place | ChatGPT — chatty, emoji-heavy |
| Burnt orange `#ff7a45` accent, sparingly used | Blue/teal everywhere |
| Dark by default; light is a serious mode, not an afterthought | Off-white "creamy" |

**One-liner for the brand:** "Grok Build is a senior engineer's pair programmer. Don't decorate, just deliver."

---

## What needs design love (prioritized)

### 🔴 P0 — first impression / daily friction

#### 1. **Empty state / starter cards** (`src/App.tsx` — search `starter-grid`)
- 4 cards in a 2×2 grid: "Review this repository / Explain this codebase / Add a failing test / Suggest the next change"
- Currently functional but generic. Need:
  - Distinctive iconography per card (not stock lucide icons — something Grok-specific)
  - Maybe a hover state that previews the actual prompt
  - Better "Grok-introduces-itself" heading copy

#### 2. **Sidebar nav** (`src/App.tsx` — `Primary navigation` region)
- New Session / Search / Tools / Settings stacked vertically
- "Grok Desktop" + "Grok desktop for engineers" header
- "Grok Developer · Local workspace" footer card
- HISTORY list with filter input
- Current: looks like a generic admin sidebar. Should feel like a code editor's gutter.

#### 3. **Top workspace toolbar** (`src/App.tsx` — search `workspace-statusbar` / header buttons)
- Current row: `Repo` picker · `grok-build` model dropdown · `Preview` · `Context` · `Terminal` · `Tools` · `Right` (dock pos) · `Dark` / `Light` · `Connected` · `Ask Grok` button (legacy, mostly removed)
- Too crowded. Designer should propose a **simplification** — maybe a unified left-section "where am I working" + right-section "system status", with overflow → menu.

#### 4. **Composer area** (`src/components/Composer.tsx` + composer footer dropdowns in App.tsx)
- Textarea + Send / Enqueue button on the right
- Footer row: `Grok Chat / Analyze / Patch ready` + helper text `↵ Send · ⇧↵ Newline · ⌘↵ Force`
- Current: textarea is fine, button is the orange gradient, but the **footer dropdowns look bolted on**. Could be more unified.

### 🟡 P1 — secondary surfaces

#### 5. **Message bubbles** (`src/components/MessageItem.tsx`, CSS in `src/App.css` near `.message.message-user`)
- Current: `YOU` / `GROK` labels in caps + body below
- Works but is **plain**. Designer could add:
  - Avatar for user (initial / photo) and Grok (logo mark)
  - Timestamp on hover
  - Copy / regenerate buttons per assistant message
  - Better diff between streaming vs done states

#### 6. **StatusBar + QueueDock detail**
- Already Claude-Code-style. Open to refinement — better proportions, animated states, queue-item expand animation.

#### 7. **Settings panel** (when user clicks Settings in sidebar — currently a placeholder)
- Where Grok options live: model / effort / reasoning / permission-mode / Best-of-N / memory / web search / subagents / self-check
- Should be a proper drawer or modal, not a buried form

#### 8. **Prompt Library** (`src/components/PromptLibrary.tsx`)
- SQLite-backed CRUD: list with search, edit modal with name/category/body
- Currently functional, basic styling. Designer to propose richer affordances — maybe a categorical color stripe per prompt.

### 🟢 P2 — feature surfaces still being built (design for them in parallel)

#### 9. **Plan Mode UX (`C`)** — when grok runs with `--permission-mode plan`, model proposes numbered steps. Need a panel with:
- Step list (numbered, can-collapse)
- Accept / Reject / Edit buttons
- Live "step N is running" indicator

#### 10. **Sub-agent visualization (`A`)** — most "soul" of the app. When grok spawns sub-agents (`--agents <JSON>`), we want:
- DAG or timeline view showing each sub-agent's lifecycle
- Per-sub-agent message panel (what each one was doing)
- Aggregate progress (X of N sub-agents done)
- This is **3-4 weeks of engineering**; designer can do mood boards / wireframes for now

#### 11. **File / editor integration (`B`)**
- `@file` mention in composer → autocompletes from repo
- Inline file preview / diff viewer
- Maybe a Monaco editor for quick edits without leaving the app

#### 12. **Light theme** — exists as a toggle but never properly designed. Needs its own pass with the same tokens but light-friendly values.

#### 13. **Chrome extension overlay** — currently a small G badge + animated agent cursor + orange viewport frame when controlling. Designer can propose a more refined "AI is here" indicator.

---

## Current screenshots (for context)

Designer should run the app locally to capture fresh screenshots, but for quick reference:

- Dark theme idle state: sidebar visible, "How can Grok help today?" heading, 4 starter cards, empty composer with placeholder.
- Dark theme active run: chat with user (orange YOU label) + assistant (grey GROK label) messages, ✦ status bar `7.5s · ≈0 tokens · thinking…`, Composer disabled / button says `Queuing…`.
- Dark theme done: chat history, ✦ idle status bar, run count in workspace footer.

(If you want me to attach actual PNGs to this doc, ping me — I can drop them in `docs/design/v0.3.0-handoff/`.)

---

## Constraints

1. **Tauri webview** — Safari WebKit on macOS. Avoid CSS that's Chrome-only. Stick to widely-supported features.
2. **No animations >60 fps cost** — streaming-json events fire fast; UI must stay smooth. Heavy CSS animations on the message list are out.
3. **Bundle size budget** — currently 167 KB gzip total. Soft cap 260 KB. Don't propose heavyweight icon sets / animation libraries without checking.
4. **Functional ≠ pretty** — engineering already shipped functionality. Design should NOT change behavior unless flagged. Visual + interaction polish only.
5. **Both themes equally important** — Grok has a serious "light mode" audience (managers, slide reviews). Don't punt light theme.
6. **macOS native feel** — title bar / window controls / chrome should look at home on macOS. Not Electron-y.

---

## Deliverables suggested

1. **Figma file** with frames for:
   - Sidebar (dark + light)
   - Empty state
   - Active conversation (with streaming)
   - Settings drawer
   - Prompt library (list + modal)
   - StatusBar in 4 states (idle / preparing / running / done / failed)
   - Plan Mode wireframe (P1)
   - Sub-agent visualization mood board (P2)

2. **Updated design token JSON** if you want to refine the palette / spacing / typography.

3. **Icon set proposal** — current is `lucide-react`. If a richer / brandier set helps, propose with bundle-size impact.

4. **Logo mark** if you want to replace the `✦` placeholder.

5. **Annotated handoff** in the Figma file — engineers need to know which CSS variable / Tailwind utility / px value maps to each design decision.

---

## Reference quality bar

- **Claude Desktop:** minimal, calm, breathable. Composer dominates.
- **Codex CLI / Codex app:** dense, technical, every glyph informative.
- **Cursor:** dark, sharp, code-first. Sidebar packed but readable.
- **Linear:** the gold standard for "premium desktop SaaS feel" — keyboard-first, fast, opinionated.
- **xAI website (x.ai):** brand-true source for color, typography, geometric vibe.

If Grok Build Desktop ends up halfway between **Cursor's density** and **Linear's polish**, with the **Grok orange** as the singular accent, we're at 10/10.

---

## Repo / branch / commit map (so the designer doesn't get lost)

| Path | What's there |
|---|---|
| `main` | Stable. F + E + G1 already merged (PR #1, #2, #3 squashed). |
| `feature/v0.3.0-polish-and-features` ✱ | All the latest polish: theme tokens, prompt library, StatusBar rewrite, IME / jam / stale-lock fixes. **Designer should look here.** |
| `src/App.tsx` | Main React tree. 3300+ lines, but the layout structure (sidebar / workspace / composer / status) is clear. |
| `src/components/*` | Composer, MessageList, MessageItem, StatusBar, QueueDock, PromptLibrary, AgentOverlay. |
| `src/App.css` | All styling — single file. New v0.3.0 section near the bottom (search `===== F: Non-blocking UI`). |
| `docs/architecture.md` | Architecture overview — useful background on how the pieces fit together. |
| `chrome-extension/` | Browser extension (separate concern from main app). |

✱ = active design target

---

## Open questions the designer should answer

1. **Logo / mark direction** — keep ✦ or design a custom Grok-Desktop mark?
2. **Default theme** — stay dark-first, or auto-detect macOS appearance preference?
3. **Density** — comfortable (Linear) or compact (Cursor)?
4. **History panel** — current vertical list, or grouped by date (Today / Yesterday / Last week)?
5. **Settings** — drawer (right side), modal, or full-page section?
6. **Onboarding** — none right now. Should we add a welcome flow when `grok login` isn't done?

---

## Engineering will be ready to implement

Once the designer delivers a Figma frame for a surface, engineering can land the visual change in ~hours (single CSS-only PR for most cases). The structure is in place; we just need the design intent.

Ping me with the Figma link or PNG drops in `docs/design/v0.3.0-handoff/` and I'll review + implement.

🤖 Generated for the designer hand-off by [Claude Code](https://claude.com/claude-code)
