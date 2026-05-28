# E — Telegram Remote Control

**Status:** Design + plan combined (autonomous mode, condensed)
**Date:** 2026-05-28
**Branch:** `feature/E-telegram-remote` (off main)
**Builds on:** F's RunQueue + streaming-json pipeline (commit d2f586d on `feature/F-non-blocking-ui`)
**Effort:** ~1 day

## Problem

User wants to drive Grok runs from a phone via Telegram. Bot accepts `/grok <prompt>` and streams the answer back into Telegram by **editing** a single message as text accumulates (the same pattern Claude Code uses in its CLI).

## Scope

- Single user (the owner). Per-chat-id allowlist via `.env`.
- Long-polling (no public URL, no webhook, no DNS). The desktop app runs the bot daemon as part of its tokio runtime.
- Streaming via incremental Telegram message-edits (1 Hz edit cadence to stay under Telegram's flood limits).
- Uses the existing `RunQueue` + `streaming-json` pipeline from F. **No new Rust streaming code.**

## Non-goals

- Webhook / public ingress.
- Multi-tenant. (Allowlist enforces single-tenant.)
- File upload / paste images.
- Voice messages.
- Cross-device session sync.
- Browser/Chrome control from Telegram (out of scope; that's project A/G).

## Architecture

```
Telegram (long-poll) ──> teloxide handler ──> RunQueue.enqueue
                                                  │
RunQueue worker ──┐                               │
                  ├──> broadcast::Sender<QueueMessage>
                  │              │
                  │              ├──> mpsc forwarder ──> Tauri events (desktop UI)
                  │              │
                  │              └──> Telegram subscriber ──> edit_message_text
                  ▼
              grok CLI process
```

**Key change to F's design:** Replace the `mpsc::UnboundedSender` in `RunQueue` with `tokio::sync::broadcast::Sender<QueueMessage>` (capacity 1024). Both the Tauri event forwarder (existing) and the Telegram subscriber (new) become independent consumers. Slow consumers get `RecvError::Lagged` instead of blocking the queue.

## Components

### `src-tauri/src/telegram/mod.rs` (new)
- `pub fn spawn_daemon(...)` — boots the bot if `TELEGRAM_BOT_TOKEN` is set, otherwise no-op.
- Owns the `Arc<RunQueue>` and a map `runId → (ChatId, MessageId, last_edit_at)` for tracking which Telegram message to edit for each run started via the bot.

### `src-tauri/src/telegram/config.rs` (new)
- `Config { bot_token: String, allowed_chat_ids: HashSet<i64>, default_cwd: Option<PathBuf> }`
- Loaded from env via `dotenvy::dotenv()`:
  - `TELEGRAM_BOT_TOKEN` — required, daemon doesn't start without
  - `TELEGRAM_ALLOWED_CHAT_IDS` — comma-separated i64; required (refuse to start with empty allowlist)
  - `TELEGRAM_DEFAULT_CWD` — optional, falls back to `session_state.coding_cwd` then `$HOME`

### `src-tauri/src/telegram/commands.rs` (new)
Command set (teloxide BotCommands derive):
- `/grok <prompt>` — enqueue, send initial "🤖 Running…" message, subscribe to run events, edit message as text streams
- `/q` (or `/queue`) — show queue snapshot
- `/cancel` — cancel active run
- `/cancel <id-prefix>` — cancel specific by UUID prefix
- `/status` — bot + queue + last run state
- `/help` — list commands

### `src-tauri/src/telegram/stream.rs` (new)
- `MessageStreamer` — per-run state: chat_id, message_id, accumulated text, last_edit_ts, final_state
- `on_event(QueueMessage)` — append to accumulated text; if ≥1 second since last edit and text grew by ≥20 chars, call `edit_message_text`; on `End`, force final edit regardless of timer
- Telegram message length cap 4096: if accumulated exceeds, send a continuation message and switch tracking to the new message_id

### Modified: `src-tauri/src/runs/queue.rs`
- Switch `tx: mpsc::UnboundedSender<QueueMessage>` → `tx: broadcast::Sender<QueueMessage>`
- `RunQueue::new` returns `(Self, broadcast::Receiver<QueueMessage>)` instead of mpsc Receiver
- Add `pub fn subscribe(&self) -> broadcast::Receiver<QueueMessage>` so additional consumers (Telegram daemon) can attach

### Modified: `src-tauri/src/lib.rs`
- The forwarder task switches from `while let Some(...) = rx.recv()` to `loop { match rx.recv().await { Ok(msg) => ..., Err(Lagged(n)) => warn!("forwarder lagged {n}"), Err(Closed) => break } }`
- After `queue.spawn_worker()`, call `telegram::spawn_daemon(app_handle.clone(), queue.clone(), queue.subscribe())` (no-op if env not set)

## Rust deps to add

```toml
teloxide = { version = "0.13", default-features = false, features = ["macros", "ctrlc_handler", "rustls"] }
dotenvy = "0.15"
```

Optional dep already present after F: `tokio` full.

## Telegram-edit rate strategy

Rate limit per chat: Telegram allows ~30 messages/sec total, but **edits** to the same message are softer (~1/sec advised). Strategy:

| Trigger | Action |
|---|---|
| `text` event arrives and `>= 1.0s` since last edit and `>= 20 chars` added | Edit immediately |
| `text` event arrives but rate-limit window not elapsed | Append to buffer, do nothing |
| `thought` event | Update status icon only (`🤔 thinking…` → unchanged) |
| `state_changed: Done` | Force final edit (full text + `✓ done · {stop_reason}`) |
| `state_changed: Failed` | Force final edit (last 2000 chars + `✗ failed: {error}`) |
| Hit 4096 char cap | Force send a new message, continue editing the new one |

## Auth flow

On any `/`-command, check `msg.chat.id ∈ allowed_chat_ids`. If not, reply `🚫 Not authorized.` and log warning. Allowlist is mandatory — daemon refuses to start with empty list.

`TELEGRAM_BOT_TOKEN` and chat IDs both stay in `.env` (gitignored). `.env.example` lists the required keys.

## Run args used

Bot calls `RunQueue::enqueue` with:
- `prompt` = user message after `/grok `
- `cwd` = `config.default_cwd` (env override or fallback to `session_state.coding_cwd` if it exists, else `$HOME`)
- `args` = `buildGrokArgs`-equivalent built in Rust:
  ```rust
  vec![
      "--no-alt-screen", "--output-format", "streaming-json",
      "--model", "grok-build",
      "--effort", "medium",
      "--no-subagents",
      "--disable-web-search",
      "--max-turns", "12",
  ]
  ```
- Bot doesn't expose effort/model overrides initially; future work.

## Failure modes

| Condition | Handling |
|---|---|
| `TELEGRAM_BOT_TOKEN` missing | Daemon doesn't spawn (log info, app still runs). |
| Allowlist empty | Daemon panics on start (refuses to operate publicly). |
| Telegram API down / network flaky | teloxide built-in retry + exponential backoff; log warning |
| Bot can't edit message (e.g. deleted by user) | Catch `RequestError::Api`, log, drop the streamer for that run |
| Edit rate hit (`429 Too Many Requests`) | teloxide respects `retry-after` header; buffer continues to accumulate |
| Run takes longer than 60s with no `text` event (only thoughts) | Send a single "still thinking, X seconds elapsed…" notification at 30s mark |
| Daemon panics | Tauri task crashes — the desktop app still works; log error |

## Smoke / test plan

- Unit: `Config::from_env` — accepts/rejects edge cases (empty list, malformed chat id, missing token).
- Unit: `MessageStreamer::should_edit` — rate-limit logic for various time/char combos.
- Manual: send `/grok say hello in 3 sentences` from owner phone — expect 1 message that grows from "🤖 Running…" → 3 sentences → "✓ done · EndTurn".
- Manual: send `/grok …` while another run is active — expect `🕒 Queued at position N` reply.
- Manual: send `/cancel` mid-stream — expect "⛔ Cancelled" and message stops updating.
- Manual: send from a chat NOT in allowlist — expect `🚫 Not authorized.`

## Acceptance

E is done when:
1. `npm run check && npm run build && npm test && cd src-tauri && cargo test` all pass.
2. With `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_CHAT_IDS` set in `.env`, launching the desktop app starts the bot.
3. A live `/grok` exchange from the owner's phone displays a streaming edit that finalizes within 60s for a 3-sentence prompt.
4. `/cancel` mid-stream stops the run within 2s.
5. Unauthorized chat is rejected with no side effects.

## Out of scope / deferred

- Voice-to-prompt (speech-to-text → /grok).
- Bot setting custom effort/model per run.
- Image generation via bot.
- Multi-recipient broadcast.
- Persistent edit history (Telegram already keeps message history).

## Step-by-step plan (6 commits on `feature/E-telegram-remote`)

Each step ends with `npm run check && cargo test` green + a single commit.

### Step 1: Deps
- Add `teloxide` + `dotenvy` to `src-tauri/Cargo.toml`
- Verify `cargo check`
- Commit: `E task 1: add teloxide + dotenvy deps`

### Step 2: Broadcast migration in RunQueue
- Change `tx: mpsc::UnboundedSender<QueueMessage>` → `tx: broadcast::Sender<QueueMessage>` (capacity 1024)
- `RunQueue::new` returns `(Self, broadcast::Receiver<QueueMessage>)`
- Add `pub fn subscribe(&self) -> broadcast::Receiver<QueueMessage>`
- Update `lib.rs` event forwarder to handle `RecvError::Lagged`/`Closed`
- Run existing `queue_test` to confirm no regression
- Commit: `E task 2: RunQueue tx → broadcast for multi-consumer fanout`

### Step 3: telegram module skeleton + Config
- Create `src-tauri/src/telegram/{mod.rs,config.rs}`
- `Config::from_env` loads token + allowlist + optional cwd
- `Config::from_env` returns `Result<Option<Config>, ConfigError>` — `Ok(None)` when no token, `Err` when token set but allowlist missing
- Unit tests for config edge cases
- Commit: `E task 3: telegram::config — env loader with allowlist enforcement`

### Step 4: MessageStreamer + commands
- `telegram/stream.rs`: per-run state, `should_edit` decision, `apply_event(QueueMessage)`
- `telegram/commands.rs`: teloxide BotCommands enum + dispatcher
- Unit test `should_edit` rate logic
- Commit: `E task 4: streamer + command dispatcher`

### Step 5: Daemon spawn + wire into Tauri setup
- `telegram/mod.rs`: `pub async fn spawn_daemon(handle, queue, rx)` runs the bot dispatcher and subscribes to broadcast
- In `lib.rs` `setup()`, after `queue.clone().spawn_worker()`, call `telegram::spawn_daemon(...)` — no-op if config missing
- Manual smoke: launch app with valid env, send `/help` from allowed chat, expect command list
- Commit: `E task 5: spawn telegram daemon from Tauri setup`

### Step 6: Docs + smoke + PR
- Update README with Telegram section (env vars, /help)
- Add `.env.example` with TELEGRAM_* keys + docstring
- Add smoke guards (telegram module imports, `dotenvy` dep present, command enum has /grok)
- Open PR
- Commit: `E task 6: README + .env.example + smoke guards`
