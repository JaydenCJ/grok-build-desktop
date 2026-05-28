# F — Non-blocking UI + Real-time Status + Run Queue

**Status:** Design approved (brainstorming phase complete)
**Author:** Claude (Opus 4.7) + user (JaydenCJ)
**Date:** 2026-05-28
**Sub-project of:** Grok Build Desktop — 6-direction roadmap
**Sequence:** F → C → A → E → B → D
**Estimated effort:** 2 weeks

## Problem

Current Grok Build Desktop UI freezes while a Grok run streams output. All
controls — Composer typing, sidebar/tabs/theme switching, Stop button, message
scrolling — degrade or block while the assistant is generating. The user wants
Claude-Desktop-class behavior:

1. UI stays fully interactive during streaming (typing, panel switching, button presses).
2. A real-time status bar comparable to Claude Code (`37.6s · 2.1k tokens · thinking...`).
3. Queue submission: while one run streams, the user can send the next prompt and it executes after the current one finishes.

The root cause is architectural: every streamed chunk currently triggers a
React `useState` mutation at the App root, ReactMarkdown re-parses the full
accumulated text per chunk on the main thread, and all UI state (Composer,
Sidebar, Tabs, Settings, Message list) lives in one component tree. Prior
mitigations (`useDeferredValue`, uncontrolled textarea ref, streaming `<pre>`
fallback) softened the symptom but did not remove the coupling.

## Goal

Re-architect the streaming pipeline so streamed events only touch the
component rendering the active message. All other UI surfaces are decoupled
from the streaming path and remain interactive.

## Non-goals

- Multiple concurrent conversation tabs in parallel (single queue is enough).
- Customizable status-bar styling.
- Cross-device queue sync.
- Auto-retry on failed runs.
- Queue priority reordering (FIFO only).
- Telemetry / analytics upload of performance numbers.
- Streaming protocols other than `grok --output-format streaming-json`.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    React Frontend                            │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │Composer │  │QueueDock │  │MessageList│  │  StatusBar  │ │
│  └─────────┘  └──────────┘  │(virtuoso) │  └──────────────┘ │
│                              └─────┬─────┘                   │
│                                    │ useSyncExternalStore    │
│                              ┌─────▼─────┐                   │
│                              │streamStore│ (singleton,       │
│                              └─────┬─────┘  selector-based)  │
│       ┌──────────────────┐         │                         │
│       │MarkdownWorker    │◀────────┤                         │
│       │(Web Worker)      │         │                         │
│       └──────────────────┘         │                         │
└────────────────────────────────────┼─────────────────────────┘
                                     │ Tauri events
                ┌────────────────────▼─────────────────────────┐
                │ Tauri/Rust Backend                           │
                │                                              │
                │  ┌──────────┐    ┌──────────────┐           │
                │  │ RunQueue │───▶│ StreamParser │           │
                │  │ (FIFO+   │    │ (serde)      │           │
                │  │  SQLite) │    └──────┬───────┘           │
                │  └─────┬────┘           │                    │
                │        │ spawn          │ run-event          │
                │        ▼                │ queue-changed      │
                │  ┌─────────────┐        │ run-state-changed  │
                │  │ grok CLI    │────────┘                    │
                │  │ --streaming-│  stdout NDJSON              │
                │  │   json      │                             │
                │  └─────────────┘                             │
                └──────────────────────────────────────────────┘
```

### Key invariants

- Streamed events touch only `streamStore`; Composer / Sidebar / Tabs / Settings do not subscribe to any streaming field and therefore do not re-render during a run.
- Markdown parsing runs in a Web Worker. The main thread never invokes `marked` or `highlight.js` directly except as fallback when the worker fails.
- The Rust queue is the source of truth. The frontend mirrors it via `queue-changed` events and an initial `get_queue` fetch on mount.
- Streaming-json is the only protocol path. The legacy raw-chunk pipeline is removed.

## Rust backend

### New modules in `src-tauri/src/lib.rs`

**`RunQueue`** — FIFO task queue, persisted in SQLite.

```rust
struct QueuedRun {
    id: String,                  // UUID v7 (sortable)
    prompt: String,
    cwd: PathBuf,
    args: Vec<String>,           // model, effort, permission-mode, etc.
    enqueued_at: SystemTime,
    started_at: Option<SystemTime>,
    ended_at: Option<SystemTime>,
    state: RunState,
    stop_reason: Option<String>,
    error: Option<String>,
}

enum RunState { Queued, Running, Done, Cancelled, Failed }

struct RunQueue {
    runs: VecDeque<QueuedRun>,
    active: Option<String>,
    cancelled: HashSet<String>,
    worker_handle: JoinHandle<()>,
    db: SqlitePool,
}
```

Worker loop: `pop_front → mark Running → spawn grok process → parse NDJSON stdout → emit events → wait exit → mark Done/Failed → loop`. Single worker for serial execution.

**`StreamParser`** — `serde_json` parser for grok NDJSON events.

```rust
#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum GrokEvent {
    Thought { data: String },
    Text { data: String },
    End { stop_reason: String, session_id: String, request_id: String },
    #[serde(other)]
    Unknown,
}
```

`#[serde(other)]` allows graceful skip of future event types (e.g., `tool_use`, `usage`) without breaking the parser.

### SQLite schema

```sql
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,            -- UUID v7
    prompt TEXT NOT NULL,
    cwd TEXT NOT NULL,
    args_json TEXT NOT NULL,        -- JSON array
    state TEXT NOT NULL,            -- 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed'
    enqueued_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    stop_reason TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
CREATE INDEX IF NOT EXISTS idx_runs_enqueued_at ON runs(enqueued_at);
```

Stored at `~/Library/Application Support/Grok Desktop/runs.sqlite`.

A background vacuum task runs on app start and every 6 hours: deletes `runs` where `state IN ('Done','Cancelled','Failed') AND ended_at < now() - 7 days`.

### New Tauri commands

| Command | Args | Returns | Behavior |
|---|---|---|---|
| `enqueue_run` | `{prompt, cwd, args}` | `{runId, position}` | Inserts into SQLite + VecDeque + emits `queue-changed`. If queue is idle, signals worker. `position` is 0 if it starts immediately, else the 1-indexed slot in the wait queue. |
| `cancel_run` | `{runId}` | `{ok}` | Cancel a queued or active run. Active runs: kill process tree (SIGTERM → SIGKILL after 2s). |
| `get_queue` | — | `{active, queue: [QueuedRun]}` | Initial fetch on mount. |
| `clear_queue` | — | `{ok}` | Cancels all `Queued` runs, leaves `active` untouched. |
| `resume_pending_runs` | — | `{started: number}` | After restart banner, user clicks "Resume all" → mark queued runs ready to run, signal worker. |
| `cancel_pending_runs` | — | `{cancelled: number}` | After restart banner, user clicks "Cancel all" → mark all queued runs as Cancelled. |

### New Tauri events

| Event | Payload | Frequency | Consumers |
|---|---|---|---|
| `grok-desktop://run-event` | `{runId, event: GrokEvent}` | High (≈ per token) | streamStore → MessageItem |
| `grok-desktop://run-state-changed` | `{runId, state, startedAt?, endedAt?, error?}` | Low (per run, ~3 times: Running → Done/Cancelled/Failed) | StatusBar / QueueDock |
| `grok-desktop://queue-changed` | `{active, queue}` | Medium (per enqueue / pop / cancel) | QueueDock |

### Removed code

- The current `run_grok_streaming_task` Rust function and its raw-chunk emit path.
- The current `cancel_grok_run` (no run-id concept) — replaced by `cancel_run(runId)`.
- The `--output-format plain` default in default args — replaced by `streaming-json`.

### Process tree kill

When spawning `grok`, set its process group via `Command::process_group(0)` (or `pre_exec` calling `setpgid(0, 0)`) so all sub-processes inherit a known group. On cancel, send `nix::sys::signal::killpg(Pid::from_raw(pgid), Signal::SIGTERM)`; if the process is still alive after 2 seconds, follow up with `SIGKILL`. `grok` may spawn MCP / tool sub-processes, so killing the leader PID alone leaves orphans.

## React frontend

### File layout

```
src/lib/
├── streamStore.ts          ← useSyncExternalStore singleton, Tauri event entry
├── markdownWorker.ts       ← Main-thread interface to the worker
└── markdown.worker.ts      ← Worker implementation (marked + highlight.js)

src/hooks/
├── useRunSnapshot.ts       ← selector hook (one run)
├── useQueue.ts             ← selector hook (queue)
└── useActiveRun.ts         ← selector hook (currently running run)

src/components/
├── MessageList.tsx         ← react-virtuoso wrapper
├── MessageItem.tsx         ← memo + worker HTML rendering
├── StatusBar.tsx           ← three-segment status
├── QueueDock.tsx           ← dock above composer
└── Composer.tsx            ← uncontrolled ref + Enter enqueues
```

### `streamStore` shape

```typescript
interface RunSnapshot {
  id: string
  state: 'queued' | 'running' | 'done' | 'cancelled' | 'failed'
  startedAt: number | null
  endedAt: number | null
  thoughtChars: number      // cumulative thinking char count
  textChars: number          // cumulative text char count
  lastEventType: 'thought' | 'text' | 'end' | null
  text: string               // concatenated text data (fed to worker)
  htmlVersion: number        // bumped each time worker posts new HTML
  stopReason: string | null
  error: string | null
}

interface StoreState {
  runs: Map<string, RunSnapshot>
  htmlByRun: Map<string, string>   // async-filled by worker
  queue: { active: string | null; items: QueuedRun[] }
}
```

`useSyncExternalStoreWithSelector` is used in every hook to ensure fine-grained re-renders. For example, `StatusBar` selects only `activeRun.elapsedMs` + `activeRun.lastEventType` and re-renders only when those change.

### Worker pipeline

For each `text` event:

1. `streamStore` appends to `runSnapshot.text`. `htmlVersion` is **not** bumped here — only when the worker returns HTML (step 6).
2. `scheduleWorkerParse(runId, text, isStreaming)` is called.
3. Internal `Map<runId, latestText>` keeps only the most recent text per run (older entries dropped).
4. When the worker becomes idle, it picks the latest text per run and posts it.
5. Worker runs `marked.parse(text)` + `highlight.js` for code fences.
6. Worker posts `{runId, html}` back; the store updates `htmlByRun.set(runId, html)` and bumps `runSnapshot.htmlVersion`.
7. `MessageItem` subscribing to that run's `htmlVersion` re-renders.

Streaming and post-stream use the same rendering path — no `<pre>` fallback, no end-of-stream flash.

### `StatusBar` three-segment rule

```
{elapsed}s · ≈{tokens} tokens · {stateText}
```

| Segment | Source |
|---|---|
| `elapsed` | `Date.now() - startedAt`, 200 ms tick (wall clock — sleep counts) |
| `tokens` | `Math.round((thoughtChars + textChars) / 4)`, prefixed `≈` (grok 0.2.3 emits no `usage` events) |
| `stateText` | Mapped from `lastEventType`: `thought → thinking...`, `text → writing...`, `end → done · {stopReason}`, `queued → waiting...` |

The `≈` prefix honestly marks the token count as an estimate. When grok adds a `usage` event, the parser picks it up and the bar drops the prefix.

### `QueueDock`

Collapsed (single line):
```
▶ Running 37.6s · ≈2.1k · writing...  · + 2 queued    [⤓ expand]
```

Expanded:
```
▶ Running    "build the auth module..."    37.6s   ✕
⏸ Queued     "now add tests for it"        wait    ✕
⏸ Queued     "deploy to staging"           wait    ✕
```

`get_queue` is called once on mount; subsequent updates come from `queue-changed`. The expand/collapse state is not persisted (defaults to collapsed on each mount).

### `Composer`

- Uncontrolled `textarea` ref (preserves current typing optimizations).
- IME composition guard preserved.
- On Enter:
  - If queue is empty and no active run → `enqueue_run` (Rust immediately spawns).
  - Otherwise → `enqueue_run` (Rust queues it); UI shows toast "queued (#{position})".

### Library choices

| Purpose | Choice | Notes |
|---|---|---|
| Markdown parser | `marked` | Fast, small, CommonMark complete, runs cleanly in a Worker. |
| Code highlighting | `highlight.js` | Worker-friendly, stylesheet-based, smaller than Shiki. |
| Virtual scroll | `react-virtuoso` | Handles dynamic message height; follow-bottom behavior is mature. |

Bundle delta: marked ~30 KB + highlight.js core ~40 KB + virtuoso ~50 KB ≈ **+120 KB gzip**, taking the bundle from 131 KB → ~250 KB gzip. Under the 260 KB budget.

## Data flow (end-to-end)

```
1. User keystrokes → uncontrolled ref (zero re-render)
2. Enter → invoke('enqueue_run', {prompt, cwd, args})
3. Rust:
   - INSERT runs (state=Queued)
   - VecDeque.push_back
   - emit 'queue-changed'
   - if no active → signal worker
4. Worker task:
   - pop_front
   - UPDATE state=Running
   - emit 'run-state-changed' {state: Running, startedAt}
   - spawn `grok --output-format streaming-json ...` (stdin closed)
   - for line in stdout:
     - parse → emit 'run-event' {runId, event}
5. streamStore:
   - thought → append to text, lastEventType='thought'
   - text → append to text, lastEventType='text', scheduleWorkerParse
   - end → state=Done, endedAt, stopReason
   - notify selectors → StatusBar / MessageItem / QueueDock
6. Worker parse (async):
   - marked + highlight.js → html
   - postMessage(html)
   - streamStore.htmlByRun.set(runId, html), bump htmlVersion
   - MessageItem subscribing re-renders
7. On exit:
   - UPDATE state=Done
   - emit 'run-state-changed' {state: Done}
   - pop next queued, signal worker
```

## Restart recovery semantics

On app start, Rust reads the SQLite `runs` table:

| Stored state | Behavior on startup |
|---|---|
| `Queued` | Keep in memory queue, **do not auto-start**. |
| `Running` (last session ended ungracefully) | Mark as `Cancelled` (reason: "app restarted"). |
| `Done` / `Cancelled` / `Failed` | Retained for 7 days (visible in history sidebar). |

QueueDock displays a top banner if any `Queued` runs exist:

```
↻ Last session had N pending tasks   [Resume all]  [Cancel all]
```

`Resume all` → `resume_pending_runs` command marks runs ready; worker starts processing.
`Cancel all` → `cancel_pending_runs` command marks them `Cancelled`.

This avoids overnight stale prompts auto-running with potentially obsolete context.

## Cancel semantics

| Current run state | `cancel_run(runId)` behavior |
|---|---|
| `Queued` | SQLite mark Cancelled + remove from VecDeque + emit `queue-changed` |
| `Running` | killpg SIGTERM → 2s → SIGKILL + mark Cancelled + clear active + immediately pop next queued + emit `run-state-changed` |
| `Done` / `Cancelled` / `Failed` | No-op (idempotent) |

## Error handling

| Condition | Handling |
|---|---|
| streaming-json single line fails to parse | log warning, skip line, continue |
| `>5` consecutive parse failures | mark run as `Failed`, kill process |
| grok process exits non-zero | mark `Failed`, store exit code + last 20 lines of stderr in `runs.error` |
| Process appears hung (no stdout for 60s, not exited) | mark `Failed` (reason: "no output timeout"), kill process tree |
| Worker throws on parse | fall back to main-thread `marked.parse`, log once, function preserved |
| SQLite write fails (disk full) | run continues in memory, toast warning, persistence degraded |
| System sleep / wake | elapsed uses wall clock (`Date.now()` diff), sleep duration counted — matches user perception |
| Tauri event lost (theoretical) | streamStore on mount calls `get_queue` to repair full snapshot |

## Performance budget

| Metric | Target |
|---|---|
| Composer keystroke lag during streaming | p95 < 16 ms (60 fps) |
| Sidebar / Tabs / Settings click response | p95 < 100 ms |
| Stop button response | p95 < 200 ms |
| Streaming-period median frame rate | ≥ 50 fps |
| Worker markdown parse for 5 KB text | p95 < 200 ms |
| App start → first interactive (window visible, last session loaded, Composer accepting keystrokes) | < 2 s |
| Bundle gzip size | < 260 KB |

## Test strategy

### Unit (automated)

- `StreamParser`: fixed list of JSON lines → expected `GrokEvent`s including `Unknown` fallback.
- `RunQueue`: state machine assertions for enqueue/cancel/pop transitions.
- `streamStore` reducers: event → snapshot transitions, idempotency.

### Integration (automated)

- Rust: spawn a fake `grok` process (shell script emitting fixed NDJSON) → assert emitted Tauri events match expected sequence.
- React + jsdom: mock streamStore + render MessageItem after worker HTML arrives.

### Manual performance (per PR)

- Run dev server, fire a deliberately long streaming prompt — e.g. `"Write a detailed 3000-word essay on the history of computing, with code examples in 5 languages."` — and within the first 2 minutes:
  - Type 30 seconds of continuous keystrokes in Composer (a paragraph of Lorem Ipsum).
  - Click sidebar items 10 times.
  - Click theme toggle 5 times.
  - Click Stop once mid-stream, then a fresh Enqueue while the cancellation is finalizing.
- Capture Chrome DevTools Performance recording; assert main-thread frames > 16 ms stay under 10% of total frames during the 30-second typing window.

### Smoke (`scripts/smoke_test.mjs` additions)

- `streamStore.ts` imports `useSyncExternalStore`.
- `markdown.worker.ts` file exists at expected path.
- `react-virtuoso` is in `package.json` dependencies.
- `--output-format streaming-json` appears in `src-tauri/src/lib.rs`.
- New Tauri commands (`enqueue_run`, `cancel_run`, `get_queue`, `clear_queue`, `resume_pending_runs`, `cancel_pending_runs`) are registered in the invoke handler list.

## Phase breakdown (2-week calendar)

### Week 1 — Backend and data path

| Day | Work |
|---|---|
| 1-2 | Rust: RunQueue + StreamParser + SQLite schema + new Tauri commands |
| 3-4 | React: streamStore + selector hooks + Tauri event listeners |
| 5 | Web Worker (marked + highlight.js) + markdown render pipeline |
| 6-7 | Integration: MessageItem consumes worker HTML, basic StatusBar, Stop/Cancel paths |

### Week 2 — UX and edge cases

| Day | Work |
|---|---|
| 8-9 | QueueDock (collapse + expand) + Composer enqueue UX |
| 10 | Restart recovery banner + SQLite 7-day vacuum |
| 11 | react-virtuoso integration + long-conversation stress test |
| 12-13 | Performance profile + tune (worker debounce / virtuoso item size hint / selector granularity) |
| 14 | Smoke guards added + README updated + PR open |

## Migration

- **Full switch**, no environment-variable fallback. `streaming-json` is the only path.
- Old `run_grok_streaming_task` + raw-chunk Tauri event path deleted.
- Old `cancel_grok_run` replaced with `cancel_run(runId)`.
- `SessionState.messages` field retained — old messages load and render unchanged (they have no metrics metadata; that is acceptable).
- `SessionState.history` deprecated; on first start after upgrade, contents are migrated into the SQLite `runs` table as `Done` entries, then the field is cleared.

## Rollback plan

If F lands and a severe regression is found (streaming unusable, worker failure rate > 1 %, etc.):

- `git revert <merge commit>` — safe because the switch is complete and atomic.
- The `runs.sqlite` file is left in place (not deleted), so a future reattempt keeps the history.
- User can continue running `grok` directly in a terminal as a stopgap.

## Out of scope (deferred to later sub-projects)

- Plan Mode UI separation (Sub-project C builds on F's streaming-json parser).
- Sub-agent visualization (Sub-project A extends F's parser when grok emits sub-agent events).
- File / editor integration (Sub-project B).
- Local enhancements: prompt library, deeper git, xterm (Sub-project D).
- Telegram remote control (Sub-project E, fully independent).

## Open questions (resolved during brainstorming)

| Question | Decision |
|---|---|
| Status bar detail level | Claude-Code class: time · ≈tokens · stateText |
| Queue submission while running | Yes — single FIFO queue |
| Queue persistence across restart | Yes — SQLite, with restart banner (not auto-resume) |
| Inactive-run retention | 7 days |
| Token display format | `≈X tokens` with `≈` prefix (estimate) |
| Markdown library | marked + highlight.js (in Web Worker) |
| Legacy raw-chunk path | Deleted (no fallback) |

## Acceptance

F is considered done when:

1. All performance budgets above are met under the manual perf scenario.
2. Smoke guards in `scripts/smoke_test.mjs` all pass.
3. Both unit and integration test suites pass.
4. A 5-minute streaming run can complete while the user types in the Composer, switches sidebar items, toggles theme, and clicks Stop, with no UI freezes observed.
5. Restart with 2 queued runs shows the banner and resume/cancel both work correctly.
6. Bundle gzip stays under 260 KB.
