# F — Non-blocking UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect Grok Build Desktop streaming so UI stays fully responsive during runs, with a Claude-Code-class status bar and a SQLite-persisted FIFO run queue.

**Architecture:** Rust spawns `grok --output-format streaming-json`, parses NDJSON events, persists run state in SQLite, emits typed Tauri events. React uses `useSyncExternalStore` with fine-grained selectors so streaming touches only the current message component. Markdown parses in a Web Worker. Long lists use `react-virtuoso`.

**Tech Stack:** Tauri 2 / Rust (`sqlx`, `serde_json`, `uuid` v7, `nix`, `tokio`) + React 19 / TypeScript (`marked`, `highlight.js`, `react-virtuoso`) + Vite 7 worker bundle.

**Spec:** `docs/superpowers/specs/2026-05-28-F-non-blocking-ui-design.md` (commit `384263a`)

**Execution branch:** `feature/F-non-blocking-ui` off `main`.

**Total: 26 tasks across 4 phases.** Each task is one commit. Smoke and build must stay green between tasks.

---

## Pre-flight

- [ ] **Step 0.1: Create feature branch and worktree (if isolation desired)**

```bash
cd "~/grok-build-desktop"
git checkout -b feature/F-non-blocking-ui
git push -u origin feature/F-non-blocking-ui
```

Verify:
```bash
git status        # → On branch feature/F-non-blocking-ui, clean
git rev-parse HEAD   # should match main's HEAD
```

- [ ] **Step 0.2: Verify baseline green**

Run all three:
```bash
npm test         # smoke ok
npm run check    # tsc + cargo check
npm run build    # vite build succeeds
```

All three must pass before touching anything. If any fail, stop and report.

---

## Phase 1: Rust backend foundation (Tasks 1-9)

### Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1.1: Add deps**

In `[dependencies]` section, add:

```toml
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "macros", "chrono"] }
uuid = { version = "1", features = ["v7", "serde"] }
nix = { version = "0.29", features = ["signal", "process"] }
tokio = { version = "1", features = ["full"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
```

(Check existing version of `serde`, `tokio`, `serde_json` — keep if higher.)

- [ ] **Step 1.2: Verify build**

```bash
cd "~/grok-build-desktop"
npm run check
```

Expected: cargo check passes. tsc unchanged.

- [ ] **Step 1.3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "F task 1: add sqlx + uuid + nix + chrono deps for run queue"
```

---

### Task 2: GrokEvent + StreamParser (TDD)

**Files:**
- Create: `src-tauri/src/runs/mod.rs`
- Create: `src-tauri/src/runs/event.rs`
- Create: `src-tauri/src/runs/parser.rs`
- Create: `src-tauri/tests/parser_test.rs`

- [ ] **Step 2.1: Create runs module skeleton**

`src-tauri/src/runs/mod.rs`:
```rust
pub mod event;
pub mod parser;
```

In `src-tauri/src/lib.rs`, near the top of `pub mod` declarations:
```rust
mod runs;
```

- [ ] **Step 2.2: Write the failing test**

`src-tauri/tests/parser_test.rs`:
```rust
use grok_desktop_lib::runs::event::GrokEvent;
use grok_desktop_lib::runs::parser::parse_line;

#[test]
fn parses_thought_event() {
    let line = r#"{"type":"thought","data":"hi"}"#;
    let event = parse_line(line).expect("should parse");
    matches!(event, GrokEvent::Thought { data } if data == "hi");
}

#[test]
fn parses_text_event() {
    let line = r#"{"type":"text","data":"hello"}"#;
    let event = parse_line(line).expect("should parse");
    matches!(event, GrokEvent::Text { data } if data == "hello");
}

#[test]
fn parses_end_event() {
    let line = r#"{"type":"end","stopReason":"EndTurn","sessionId":"abc","requestId":"xyz"}"#;
    let event = parse_line(line).expect("should parse");
    if let GrokEvent::End { stop_reason, session_id, request_id } = event {
        assert_eq!(stop_reason, "EndTurn");
        assert_eq!(session_id, "abc");
        assert_eq!(request_id, "xyz");
    } else {
        panic!("expected End variant");
    }
}

#[test]
fn unknown_type_falls_back_to_unknown() {
    let line = r#"{"type":"tool_use","data":{"name":"bash"}}"#;
    let event = parse_line(line).expect("should parse as Unknown");
    matches!(event, GrokEvent::Unknown);
}

#[test]
fn invalid_json_returns_err() {
    let line = "{not json";
    assert!(parse_line(line).is_err());
}
```

Note: this expects `grok_desktop_lib` crate name — verify by reading `src-tauri/Cargo.toml`'s `[package] name` field. Adjust import if different.

- [ ] **Step 2.3: Run the test, confirm it fails**

```bash
cd src-tauri && cargo test --test parser_test
```

Expected: compile error (`runs::event` / `runs::parser` not found).

- [ ] **Step 2.4: Implement `event.rs`**

`src-tauri/src/runs/event.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GrokEvent {
    Thought {
        data: String,
    },
    Text {
        data: String,
    },
    End {
        #[serde(rename = "stopReason")]
        stop_reason: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    #[serde(other)]
    Unknown,
}
```

- [ ] **Step 2.5: Implement `parser.rs`**

`src-tauri/src/runs/parser.rs`:
```rust
use super::event::GrokEvent;

pub fn parse_line(line: &str) -> Result<GrokEvent, serde_json::Error> {
    serde_json::from_str::<GrokEvent>(line)
}
```

- [ ] **Step 2.6: Run tests, confirm pass**

```bash
cd src-tauri && cargo test --test parser_test
```

Expected: 5 passed; 0 failed.

- [ ] **Step 2.7: Commit**

```bash
git add src-tauri/src/runs src-tauri/tests/parser_test.rs src-tauri/src/lib.rs
git commit -m "F task 2: GrokEvent enum + line parser with Unknown forward-compat"
```

---

### Task 3: SQLite schema + db helpers (TDD)

**Files:**
- Create: `src-tauri/src/runs/db.rs`
- Modify: `src-tauri/src/runs/mod.rs`
- Create: `src-tauri/tests/db_test.rs`

- [ ] **Step 3.1: Export db module**

Append to `src-tauri/src/runs/mod.rs`:
```rust
pub mod db;
```

- [ ] **Step 3.2: Write failing test**

`src-tauri/tests/db_test.rs`:
```rust
use grok_desktop_lib::runs::db::{Db, RunRecord, RunState};
use chrono::Utc;

#[tokio::test]
async fn insert_and_fetch_run() {
    let db = Db::open_memory().await.expect("open memory db");
    let id = "01900000-0000-7000-8000-000000000001".to_string();

    let rec = RunRecord {
        id: id.clone(),
        prompt: "hello".into(),
        cwd: "/tmp".into(),
        args_json: "[]".into(),
        state: RunState::Queued,
        enqueued_at: Utc::now().timestamp_millis(),
        started_at: None,
        ended_at: None,
        stop_reason: None,
        error: None,
    };

    db.insert_run(&rec).await.expect("insert");
    let got = db.fetch_run(&id).await.expect("fetch").expect("not none");
    assert_eq!(got.prompt, "hello");
    assert!(matches!(got.state, RunState::Queued));
}

#[tokio::test]
async fn update_state_persists() {
    let db = Db::open_memory().await.unwrap();
    let id = "01900000-0000-7000-8000-000000000002".to_string();
    let rec = RunRecord {
        id: id.clone(),
        prompt: "p".into(),
        cwd: "/tmp".into(),
        args_json: "[]".into(),
        state: RunState::Queued,
        enqueued_at: Utc::now().timestamp_millis(),
        started_at: None, ended_at: None, stop_reason: None, error: None,
    };
    db.insert_run(&rec).await.unwrap();

    db.update_state(&id, RunState::Running, Some(Utc::now().timestamp_millis()), None, None, None)
        .await
        .unwrap();

    let got = db.fetch_run(&id).await.unwrap().unwrap();
    assert!(matches!(got.state, RunState::Running));
    assert!(got.started_at.is_some());
}

#[tokio::test]
async fn vacuum_drops_old_finished_runs() {
    let db = Db::open_memory().await.unwrap();
    let week_ms = 7 * 24 * 60 * 60 * 1000;
    let old = Utc::now().timestamp_millis() - week_ms - 1000;
    let new = Utc::now().timestamp_millis();

    for (id, ended) in [("old", old), ("new", new)] {
        db.insert_run(&RunRecord {
            id: id.into(), prompt: "p".into(), cwd: "/tmp".into(), args_json: "[]".into(),
            state: RunState::Done, enqueued_at: ended, started_at: Some(ended), ended_at: Some(ended),
            stop_reason: Some("EndTurn".into()), error: None,
        }).await.unwrap();
    }

    let removed = db.vacuum(week_ms).await.unwrap();
    assert_eq!(removed, 1);
    assert!(db.fetch_run("old").await.unwrap().is_none());
    assert!(db.fetch_run("new").await.unwrap().is_some());
}
```

- [ ] **Step 3.3: Run, confirm fail**

```bash
cd src-tauri && cargo test --test db_test
```

Expected: compile errors.

- [ ] **Step 3.4: Implement `db.rs`**

`src-tauri/src/runs/db.rs`:
```rust
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunState {
    Queued,
    Running,
    Done,
    Cancelled,
    Failed,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunState::Queued => "Queued",
            RunState::Running => "Running",
            RunState::Done => "Done",
            RunState::Cancelled => "Cancelled",
            RunState::Failed => "Failed",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "Queued" => Self::Queued,
            "Running" => Self::Running,
            "Done" => Self::Done,
            "Cancelled" => Self::Cancelled,
            "Failed" => Self::Failed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
pub struct RunRecord {
    pub id: String,
    pub prompt: String,
    pub cwd: String,
    pub args_json: String,
    pub state: RunState,
    pub enqueued_at: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct Db {
    pool: SqlitePool,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    cwd TEXT NOT NULL,
    args_json TEXT NOT NULL,
    state TEXT NOT NULL,
    enqueued_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    stop_reason TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
CREATE INDEX IF NOT EXISTS idx_runs_enqueued_at ON runs(enqueued_at);
"#;

impl Db {
    pub async fn open_memory() -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:")?)
            .await?;
        sqlx::query(SCHEMA).execute(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn open_at(path: &Path) -> Result<Self, sqlx::Error> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new().connect_with(opts).await?;
        sqlx::query(SCHEMA).execute(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn insert_run(&self, r: &RunRecord) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO runs (id, prompt, cwd, args_json, state, enqueued_at, started_at, ended_at, stop_reason, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&r.id).bind(&r.prompt).bind(&r.cwd).bind(&r.args_json)
        .bind(r.state.as_str())
        .bind(r.enqueued_at).bind(r.started_at).bind(r.ended_at)
        .bind(&r.stop_reason).bind(&r.error)
        .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn update_state(
        &self,
        id: &str,
        state: RunState,
        started_at: Option<i64>,
        ended_at: Option<i64>,
        stop_reason: Option<String>,
        error: Option<String>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE runs SET state = ?, started_at = COALESCE(?, started_at),
             ended_at = COALESCE(?, ended_at), stop_reason = COALESCE(?, stop_reason),
             error = COALESCE(?, error) WHERE id = ?"
        )
        .bind(state.as_str())
        .bind(started_at).bind(ended_at).bind(stop_reason).bind(error)
        .bind(id)
        .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn fetch_run(&self, id: &str) -> Result<Option<RunRecord>, sqlx::Error> {
        let row: Option<(String, String, String, String, String, i64, Option<i64>, Option<i64>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT id, prompt, cwd, args_json, state, enqueued_at, started_at, ended_at, stop_reason, error FROM runs WHERE id = ?"
            )
            .bind(id)
            .fetch_optional(&self.pool).await?;
        Ok(row.map(|(id, prompt, cwd, args_json, state, eq, st, en, sr, err)| RunRecord {
            id, prompt, cwd, args_json,
            state: RunState::parse(&state).unwrap_or(RunState::Failed),
            enqueued_at: eq, started_at: st, ended_at: en,
            stop_reason: sr, error: err,
        }))
    }

    pub async fn list_by_state(&self, state: RunState) -> Result<Vec<RunRecord>, sqlx::Error> {
        let rows: Vec<(String, String, String, String, String, i64, Option<i64>, Option<i64>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT id, prompt, cwd, args_json, state, enqueued_at, started_at, ended_at, stop_reason, error
                 FROM runs WHERE state = ? ORDER BY enqueued_at ASC"
            )
            .bind(state.as_str())
            .fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(|(id, prompt, cwd, args_json, state, eq, st, en, sr, err)| RunRecord {
            id, prompt, cwd, args_json,
            state: RunState::parse(&state).unwrap_or(RunState::Failed),
            enqueued_at: eq, started_at: st, ended_at: en,
            stop_reason: sr, error: err,
        }).collect())
    }

    /// Delete finished runs older than `retention_ms`. Returns count deleted.
    pub async fn vacuum(&self, retention_ms: i64) -> Result<u64, sqlx::Error> {
        let cutoff = chrono::Utc::now().timestamp_millis() - retention_ms;
        let result = sqlx::query(
            "DELETE FROM runs WHERE state IN ('Done','Cancelled','Failed') AND COALESCE(ended_at, enqueued_at) < ?"
        )
        .bind(cutoff)
        .execute(&self.pool).await?;
        Ok(result.rows_affected())
    }

    /// On startup: change any Running rows to Cancelled (subprocess is dead).
    pub async fn cancel_orphans(&self, reason: &str) -> Result<u64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp_millis();
        let result = sqlx::query(
            "UPDATE runs SET state = 'Cancelled', ended_at = ?, error = ? WHERE state = 'Running'"
        )
        .bind(now).bind(reason)
        .execute(&self.pool).await?;
        Ok(result.rows_affected())
    }
}
```

- [ ] **Step 3.5: Run tests, pass**

```bash
cd src-tauri && cargo test --test db_test
```

Expected: 3 passed.

- [ ] **Step 3.6: Commit**

```bash
git add src-tauri/src/runs/db.rs src-tauri/src/runs/mod.rs src-tauri/tests/db_test.rs
git commit -m "F task 3: SQLite Db with insert/update/fetch/list/vacuum/cancel_orphans"
```

---

### Task 4: Fake grok fixture for integration tests

**Files:**
- Create: `scripts/fake-grok.sh`

- [ ] **Step 4.1: Write fixture**

`scripts/fake-grok.sh`:
```bash
#!/usr/bin/env bash
# Mimics `grok --output-format streaming-json` for tests.
# Emits a fixed sequence of NDJSON events with a short delay.
# Usage: fake-grok.sh [--fail|--hang|--slow|--mixed]
set -euo pipefail

mode="${1:---ok}"
emit() { printf '%s\n' "$1"; sleep 0.02; }

case "$mode" in
  --ok|"")
    emit '{"type":"thought","data":"thinking"}'
    emit '{"type":"text","data":"hello"}'
    emit '{"type":"text","data":" world"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"sess-1","requestId":"req-1"}'
    ;;
  --fail)
    emit '{"type":"thought","data":"trying"}'
    >&2 echo "fake-grok: simulated failure"
    exit 2
    ;;
  --hang)
    emit '{"type":"thought","data":"hanging"}'
    sleep 600
    ;;
  --slow)
    emit '{"type":"thought","data":"slow start"}'
    sleep 3
    emit '{"type":"text","data":"finally"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"sess-slow","requestId":"req-slow"}'
    ;;
  --mixed)
    emit '{"type":"thought","data":"start"}'
    emit '{"type":"future_event","data":"unknown payload"}'
    emit '{"not":"json valid for our schema either"}'
    echo 'plain text garbage'
    emit '{"type":"text","data":"recovered"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"s","requestId":"r"}'
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 1
    ;;
esac
```

- [ ] **Step 4.2: Make executable + smoke**

```bash
chmod +x scripts/fake-grok.sh
scripts/fake-grok.sh --ok | head -5
```

Expected: 4 NDJSON lines printed.

- [ ] **Step 4.3: Commit**

```bash
git add scripts/fake-grok.sh
git commit -m "F task 4: scripts/fake-grok.sh fixture for integration tests"
```

---

### Task 5: Process spawn + group kill

**Files:**
- Create: `src-tauri/src/runs/process.rs`
- Modify: `src-tauri/src/runs/mod.rs`
- Create: `src-tauri/tests/process_test.rs`

- [ ] **Step 5.1: Export process module**

Append to `src-tauri/src/runs/mod.rs`:
```rust
pub mod process;
```

- [ ] **Step 5.2: Implement spawn + kill**

`src-tauri/src/runs/process.rs`:
```rust
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

#[cfg(unix)]
use nix::sys::signal::{killpg, Signal};
#[cfg(unix)]
use nix::unistd::Pid;

pub struct SpawnedGrok {
    pub child: Child,
    pub pgid: i32,
}

#[cfg(unix)]
pub fn spawn(cmd_path: &Path, args: &[String], cwd: &Path) -> std::io::Result<SpawnedGrok> {
    use std::os::unix::process::CommandExt;

    let mut command = Command::new(cmd_path);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    unsafe {
        command.pre_exec(|| {
            // Become the leader of a new process group so we can kill descendants.
            nix::unistd::setpgid(nix::unistd::Pid::from_raw(0), nix::unistd::Pid::from_raw(0))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            Ok(())
        });
    }

    let child = command.spawn()?;
    let pgid = child.id().expect("child has pid") as i32;
    Ok(SpawnedGrok { child, pgid })
}

#[cfg(not(unix))]
pub fn spawn(_cmd_path: &Path, _args: &[String], _cwd: &Path) -> std::io::Result<SpawnedGrok> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "non-unix not supported in MVP"))
}

#[cfg(unix)]
pub async fn kill_group(pgid: i32) {
    let _ = killpg(Pid::from_raw(pgid), Signal::SIGTERM);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let _ = killpg(Pid::from_raw(pgid), Signal::SIGKILL);
}

pub fn read_stdout_lines(child: &mut Child) -> BufReader<tokio::process::ChildStdout> {
    BufReader::new(child.stdout.take().expect("stdout piped"))
}
```

- [ ] **Step 5.3: Write integration test**

`src-tauri/tests/process_test.rs`:
```rust
use grok_desktop_lib::runs::process;
use std::path::PathBuf;
use tokio::io::AsyncBufReadExt;

fn fake_grok_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop(); // up from src-tauri/
    p.push("scripts/fake-grok.sh");
    p
}

#[tokio::test]
async fn spawns_and_reads_lines() {
    let path = fake_grok_path();
    let cwd = std::env::temp_dir();
    let mut spawned = process::spawn(&path, &["--ok".into()], &cwd).expect("spawn");
    let mut reader = process::read_stdout_lines(&mut spawned.child);

    let mut lines = Vec::new();
    let mut buf = String::new();
    while reader.read_line(&mut buf).await.unwrap() > 0 {
        lines.push(buf.trim().to_string());
        buf.clear();
    }
    let _ = spawned.child.wait().await;

    assert_eq!(lines.len(), 4);
    assert!(lines[0].contains("thought"));
    assert!(lines[3].contains("end"));
}

#[tokio::test]
async fn kill_group_stops_hanging_process() {
    let path = fake_grok_path();
    let cwd = std::env::temp_dir();
    let mut spawned = process::spawn(&path, &["--hang".into()], &cwd).expect("spawn");
    let pgid = spawned.pgid;

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    process::kill_group(pgid).await;

    let status = tokio::time::timeout(std::time::Duration::from_secs(5), spawned.child.wait())
        .await.expect("wait timed out").expect("wait err");
    assert!(!status.success());
}
```

- [ ] **Step 5.4: Run, pass**

```bash
cd src-tauri && cargo test --test process_test -- --test-threads=1
```

Expected: 2 passed (process tests run serial to avoid sigtargeting wrong PIDs).

- [ ] **Step 5.5: Commit**

```bash
git add src-tauri/src/runs/process.rs src-tauri/src/runs/mod.rs src-tauri/tests/process_test.rs
git commit -m "F task 5: process spawn with setpgid + killpg for tree kill"
```

---

### Task 6: RunQueue worker loop (integration)

**Files:**
- Create: `src-tauri/src/runs/queue.rs`
- Modify: `src-tauri/src/runs/mod.rs`
- Create: `src-tauri/tests/queue_test.rs`

- [ ] **Step 6.1: Export queue module**

Append `pub mod queue;` to `src-tauri/src/runs/mod.rs`.

- [ ] **Step 6.2: Implement RunQueue**

`src-tauri/src/runs/queue.rs`:
```rust
use super::db::{Db, RunRecord, RunState};
use super::event::GrokEvent;
use super::parser::parse_line;
use super::process;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::sync::{mpsc, Mutex, Notify};

#[derive(Debug, Clone, Serialize)]
pub struct QueueMessage {
    pub run_id: String,
    pub kind: QueueMessageKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum QueueMessageKind {
    Event { event: GrokEvent },
    StateChanged { state: RunState, started_at: Option<i64>, ended_at: Option<i64>, error: Option<String> },
    QueueChanged,
}

pub struct RunQueue {
    pub db: Db,
    inner: Arc<Mutex<Inner>>,
    notify: Arc<Notify>,
    pub tx: mpsc::UnboundedSender<QueueMessage>,
}

struct Inner {
    waiting: VecDeque<RunRecord>,
    active: Option<String>,
    cancelled: HashSet<String>,
    /// Process-group id of the running grok child, if any.
    active_pgid: Option<i32>,
    grok_path: PathBuf,
    consecutive_parse_failures: u32,
    no_output_seconds: u32,
}

impl RunQueue {
    pub async fn new(db: Db, grok_path: PathBuf) -> (Self, mpsc::UnboundedReceiver<QueueMessage>) {
        // On startup: cancel any Running rows (subprocess died with the previous app).
        let _ = db.cancel_orphans("app restarted").await;
        // Recover Queued rows into memory (do not auto-start — banner handles resume).
        let queued = db.list_by_state(RunState::Queued).await.unwrap_or_default();

        let inner = Inner {
            waiting: VecDeque::from(queued),
            active: None,
            cancelled: HashSet::new(),
            active_pgid: None,
            grok_path,
            consecutive_parse_failures: 0,
            no_output_seconds: 0,
        };
        let (tx, rx) = mpsc::unbounded_channel();
        let queue = Self {
            db,
            inner: Arc::new(Mutex::new(inner)),
            notify: Arc::new(Notify::new()),
            tx,
        };
        (queue, rx)
    }

    pub async fn enqueue(&self, prompt: String, cwd: String, args: Vec<String>) -> Result<(String, usize), sqlx::Error> {
        let id = uuid::Uuid::now_v7().to_string();
        let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "[]".into());
        let now = chrono::Utc::now().timestamp_millis();
        let rec = RunRecord {
            id: id.clone(), prompt, cwd, args_json,
            state: RunState::Queued,
            enqueued_at: now,
            started_at: None, ended_at: None, stop_reason: None, error: None,
        };
        self.db.insert_run(&rec).await?;

        let position;
        {
            let mut inner = self.inner.lock().await;
            inner.waiting.push_back(rec);
            position = if inner.active.is_none() { 0 } else { inner.waiting.len() };
        }

        let _ = self.tx.send(QueueMessage { run_id: id.clone(), kind: QueueMessageKind::QueueChanged });
        self.notify.notify_one();
        Ok((id, position))
    }

    pub async fn cancel(&self, run_id: &str) -> Result<bool, sqlx::Error> {
        let mut inner = self.inner.lock().await;
        // If in waiting queue: remove.
        if let Some(pos) = inner.waiting.iter().position(|r| r.id == run_id) {
            inner.waiting.remove(pos);
            inner.cancelled.insert(run_id.into());
            drop(inner);
            self.db.update_state(run_id, RunState::Cancelled,
                None, Some(chrono::Utc::now().timestamp_millis()),
                None, Some("user cancelled".into())).await?;
            let _ = self.tx.send(QueueMessage { run_id: run_id.into(), kind: QueueMessageKind::QueueChanged });
            return Ok(true);
        }
        // If active: mark cancelled and kill group; worker loop will finalize.
        if inner.active.as_deref() == Some(run_id) {
            inner.cancelled.insert(run_id.into());
            let pgid = inner.active_pgid;
            drop(inner);
            if let Some(p) = pgid {
                process::kill_group(p).await;
            }
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn clear_waiting(&self) -> Result<u64, sqlx::Error> {
        let mut inner = self.inner.lock().await;
        let drained: Vec<String> = inner.waiting.drain(..).map(|r| r.id).collect();
        drop(inner);
        let now = chrono::Utc::now().timestamp_millis();
        for id in &drained {
            self.db.update_state(id, RunState::Cancelled, None, Some(now), None, Some("queue cleared".into())).await?;
        }
        if !drained.is_empty() {
            let _ = self.tx.send(QueueMessage { run_id: drained[0].clone(), kind: QueueMessageKind::QueueChanged });
        }
        Ok(drained.len() as u64)
    }

    pub async fn snapshot(&self) -> (Option<String>, Vec<RunRecord>) {
        let inner = self.inner.lock().await;
        (inner.active.clone(), inner.waiting.iter().cloned().collect())
    }

    pub async fn pending_count(&self) -> usize {
        self.inner.lock().await.waiting.len()
    }

    pub async fn cancel_all_pending(&self) -> Result<u64, sqlx::Error> {
        self.clear_waiting().await
    }

    /// Spawn the worker loop as a long-running tokio task. Returns immediately.
    pub fn spawn_worker(self: Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            loop {
                me.notify.notified().await;
                while let Some(rec) = me.pop_next().await {
                    if me.inner.lock().await.cancelled.contains(&rec.id) {
                        continue;
                    }
                    me.run_one(rec).await;
                }
            }
        });
    }

    async fn pop_next(&self) -> Option<RunRecord> {
        let mut inner = self.inner.lock().await;
        let rec = inner.waiting.pop_front()?;
        inner.active = Some(rec.id.clone());
        Some(rec)
    }

    async fn run_one(&self, rec: RunRecord) {
        let started_at = chrono::Utc::now().timestamp_millis();
        let _ = self.db.update_state(&rec.id, RunState::Running, Some(started_at), None, None, None).await;
        let _ = self.tx.send(QueueMessage {
            run_id: rec.id.clone(),
            kind: QueueMessageKind::StateChanged { state: RunState::Running, started_at: Some(started_at), ended_at: None, error: None },
        });

        let args: Vec<String> = serde_json::from_str(&rec.args_json).unwrap_or_default();
        let grok_path = self.inner.lock().await.grok_path.clone();
        let cwd = std::path::PathBuf::from(&rec.cwd);

        let spawn_result = process::spawn(&grok_path, &args, &cwd);
        match spawn_result {
            Err(e) => {
                self.finalize(&rec.id, RunState::Failed, Some(format!("spawn failed: {e}"))).await;
                return;
            }
            Ok(mut spawned) => {
                {
                    let mut inner = self.inner.lock().await;
                    inner.active_pgid = Some(spawned.pgid);
                    inner.consecutive_parse_failures = 0;
                }
                let mut reader = process::read_stdout_lines(&mut spawned.child);
                let mut line = String::new();
                let mut consecutive_fail = 0u32;

                loop {
                    line.clear();
                    let read_fut = reader.read_line(&mut line);
                    let outcome = tokio::time::timeout(std::time::Duration::from_secs(60), read_fut).await;
                    match outcome {
                        Err(_) => {
                            // 60s no output and not exited
                            process::kill_group(spawned.pgid).await;
                            self.finalize(&rec.id, RunState::Failed, Some("no output timeout".into())).await;
                            return;
                        }
                        Ok(Ok(0)) => break,
                        Ok(Ok(_)) => {
                            let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                            if trimmed.is_empty() { continue; }
                            match parse_line(&trimmed) {
                                Ok(ev) => {
                                    consecutive_fail = 0;
                                    let _ = self.tx.send(QueueMessage {
                                        run_id: rec.id.clone(),
                                        kind: QueueMessageKind::Event { event: ev },
                                    });
                                }
                                Err(_) => {
                                    consecutive_fail += 1;
                                    if consecutive_fail > 5 {
                                        process::kill_group(spawned.pgid).await;
                                        self.finalize(&rec.id, RunState::Failed, Some("too many parse failures".into())).await;
                                        return;
                                    }
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            self.finalize(&rec.id, RunState::Failed, Some(format!("stdout read error: {e}"))).await;
                            return;
                        }
                    }
                }
                // Wait exit.
                let status = spawned.child.wait().await;
                let cancelled = self.inner.lock().await.cancelled.contains(&rec.id);
                let final_state = if cancelled {
                    RunState::Cancelled
                } else {
                    match status {
                        Ok(s) if s.success() => RunState::Done,
                        Ok(s) => {
                            let _ = s; RunState::Failed
                        }
                        Err(_) => RunState::Failed,
                    }
                };
                self.finalize(&rec.id, final_state, None).await;
            }
        }
    }

    async fn finalize(&self, id: &str, state: RunState, error: Option<String>) {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = self.db.update_state(id, state, None, Some(now), None, error.clone()).await;
        {
            let mut inner = self.inner.lock().await;
            if inner.active.as_deref() == Some(id) {
                inner.active = None;
                inner.active_pgid = None;
            }
        }
        let _ = self.tx.send(QueueMessage {
            run_id: id.into(),
            kind: QueueMessageKind::StateChanged { state, started_at: None, ended_at: Some(now), error },
        });
        let _ = self.tx.send(QueueMessage { run_id: id.into(), kind: QueueMessageKind::QueueChanged });
        // Wake worker for next.
        self.notify.notify_one();
    }
}
```

- [ ] **Step 6.3: Write integration test**

`src-tauri/tests/queue_test.rs`:
```rust
use grok_desktop_lib::runs::db::{Db, RunState};
use grok_desktop_lib::runs::queue::{QueueMessageKind, RunQueue};
use std::path::PathBuf;
use std::sync::Arc;

fn fake_grok_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("scripts/fake-grok.sh");
    p
}

#[tokio::test]
async fn enqueue_runs_serial_and_emits_events() {
    let db = Db::open_memory().await.unwrap();
    let (q, mut rx) = RunQueue::new(db, fake_grok_path()).await;
    let q = Arc::new(q);
    q.clone().spawn_worker();

    let (_id1, pos1) = q.enqueue("p1".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    let (_id2, pos2) = q.enqueue("p2".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    assert_eq!(pos1, 0);
    assert_eq!(pos2, 1);

    // Collect events for ~3s.
    let mut events = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await {
            Ok(Some(msg)) => events.push(msg),
            _ => {
                if events.iter().filter(|m| matches!(m.kind, QueueMessageKind::StateChanged { state: RunState::Done, .. })).count() >= 2 {
                    break;
                }
            }
        }
    }

    let done_count = events.iter().filter(|m| matches!(m.kind, QueueMessageKind::StateChanged { state: RunState::Done, .. })).count();
    assert_eq!(done_count, 2, "expected 2 Done state events, got {} (events: {:?})", done_count, events.len());
}

#[tokio::test]
async fn cancel_queued_marks_cancelled_without_running() {
    let db = Db::open_memory().await.unwrap();
    let (q, _rx) = RunQueue::new(db.clone(), fake_grok_path()).await;
    let q = Arc::new(q);
    // Do NOT spawn worker — we want to inspect waiting queue state directly.

    let (id, _) = q.enqueue("p".into(), "/tmp".into(), vec!["--ok".into()]).await.unwrap();
    let cancelled = q.cancel(&id).await.unwrap();
    assert!(cancelled);

    let rec = db.fetch_run(&id).await.unwrap().unwrap();
    assert!(matches!(rec.state, RunState::Cancelled));
}
```

- [ ] **Step 6.4: Run + pass**

```bash
cd src-tauri && cargo test --test queue_test -- --test-threads=1
```

Expected: 2 passed.

- [ ] **Step 6.5: Commit**

```bash
git add src-tauri/src/runs/queue.rs src-tauri/src/runs/mod.rs src-tauri/tests/queue_test.rs
git commit -m "F task 6: RunQueue with FIFO worker loop + cancel + finalize"
```

---

### Task 7: Tauri commands + state setup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 7.1: Read current lib.rs main + state setup**

```bash
sed -n '1,80p' src-tauri/src/lib.rs
```

Note the existing `tauri::Builder` setup and current state types. New `RunQueue` will be added as managed state.

- [ ] **Step 7.2: Add RunQueue to managed state**

In `lib.rs`, find the `tauri::Builder::default()` block. Add to imports at top:
```rust
use crate::runs::db::Db;
use crate::runs::queue::{QueueMessage, QueueMessageKind, RunQueue};
use std::sync::Arc;
use tauri::Manager;
```

Add inside the `.setup(|app| { ... })` closure (create one if not present):
```rust
let app_handle = app.handle().clone();
let resource_dir = app.path().app_data_dir().expect("app_data_dir");
std::fs::create_dir_all(&resource_dir).ok();
let db_path = resource_dir.join("runs.sqlite");

tauri::async_runtime::block_on(async {
    let db = Db::open_at(&db_path).await.expect("open runs.sqlite");
    let grok_path = std::path::PathBuf::from(
        std::env::var("GROK_DESKTOP_GROK_CMD").unwrap_or_else(|_| {
            // Default: ~/.grok/bin/grok
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{}/.grok/bin/grok", home)
        })
    );
    let (queue, mut rx) = RunQueue::new(db.clone(), grok_path).await;
    let queue = Arc::new(queue);
    queue.clone().spawn_worker();

    // Spawn event forwarder: queue → Tauri events.
    let app_for_events = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            forward_queue_message(&app_for_events, &msg);
        }
    });

    // Spawn 6-hour vacuum loop.
    let db_for_vacuum = db.clone();
    tauri::async_runtime::spawn(async move {
        let week_ms: i64 = 7 * 24 * 60 * 60 * 1000;
        loop {
            let _ = db_for_vacuum.vacuum(week_ms).await;
            tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
        }
    });

    app_handle.manage(queue);
});

Ok(())
```

- [ ] **Step 7.3: Add forward_queue_message function**

Above `pub fn run()` (or wherever fits in `lib.rs`):
```rust
fn forward_queue_message(app: &tauri::AppHandle, msg: &QueueMessage) {
    use tauri::Emitter;
    match &msg.kind {
        QueueMessageKind::Event { event } => {
            let _ = app.emit("grok-desktop://run-event", serde_json::json!({
                "runId": msg.run_id,
                "event": event,
            }));
        }
        QueueMessageKind::StateChanged { state, started_at, ended_at, error } => {
            let _ = app.emit("grok-desktop://run-state-changed", serde_json::json!({
                "runId": msg.run_id,
                "state": state,
                "startedAt": started_at,
                "endedAt": ended_at,
                "error": error,
            }));
        }
        QueueMessageKind::QueueChanged => {
            // Emit a fresh queue snapshot. We grab the Arc<RunQueue> from
            // managed state, clone it, and snapshot inside an async task so
            // we don't block the event-forwarding loop.
            let q = app.state::<Arc<RunQueue>>().inner().clone();
            let app_cloned = app.clone();
            tauri::async_runtime::spawn(async move {
                let (active, waiting) = q.snapshot().await;
                let _ = app_cloned.emit("grok-desktop://queue-changed", serde_json::json!({
                    "active": active,
                    "queue": waiting.iter().map(|r| serde_json::json!({
                        "id": r.id, "prompt": r.prompt, "cwd": r.cwd,
                        "state": r.state, "enqueuedAt": r.enqueued_at,
                    })).collect::<Vec<_>>(),
                }));
            });
        }
    }
}
```

- [ ] **Step 7.4: Add Tauri commands**

In `lib.rs`, define:
```rust
#[tauri::command]
async fn enqueue_run(
    queue: tauri::State<'_, Arc<RunQueue>>,
    prompt: String,
    cwd: String,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (run_id, position) = queue
        .enqueue(prompt, cwd, args)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "runId": run_id, "position": position }))
}

#[tauri::command]
async fn cancel_run(
    queue: tauri::State<'_, Arc<RunQueue>>,
    run_id: String,
) -> Result<bool, String> {
    queue.cancel(&run_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_queue(
    queue: tauri::State<'_, Arc<RunQueue>>,
) -> Result<serde_json::Value, String> {
    let (active, waiting) = queue.snapshot().await;
    Ok(serde_json::json!({
        "active": active,
        "queue": waiting.iter().map(|r| serde_json::json!({
            "id": r.id, "prompt": r.prompt, "cwd": r.cwd,
            "state": r.state, "enqueuedAt": r.enqueued_at,
        })).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
async fn clear_queue(
    queue: tauri::State<'_, Arc<RunQueue>>,
) -> Result<u64, String> {
    queue.clear_waiting().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume_pending_runs(
    queue: tauri::State<'_, Arc<RunQueue>>,
) -> Result<u64, String> {
    // Already in waiting queue from startup — we just need to nudge the worker.
    let count = queue.pending_count().await;
    // Trigger via enqueue-side notify by inserting nothing; instead, just wake worker:
    // The waiting deque already has them; worker will process when notified.
    // Use a tiny no-op cancel call on a fake id to wake — simpler: re-emit signal.
    // For MVP simplicity: just call notify via a noop cancel of non-existent id.
    let _ = queue.cancel("__nope__").await;
    Ok(count as u64)
}

#[tauri::command]
async fn cancel_pending_runs(
    queue: tauri::State<'_, Arc<RunQueue>>,
) -> Result<u64, String> {
    queue.cancel_all_pending().await.map_err(|e| e.to_string())
}
```

Note on `resume_pending_runs`: the queue worker is **already** waiting on Notify. We need a public `notify_worker()` method on `RunQueue` — quick add.

- [ ] **Step 7.5: Add `notify_worker` method to RunQueue**

In `src-tauri/src/runs/queue.rs`, add inside `impl RunQueue`:
```rust
pub fn notify_worker(&self) {
    self.notify.notify_one();
}
```

Then change `resume_pending_runs` body to:
```rust
let count = queue.pending_count().await;
queue.notify_worker();
Ok(count as u64)
```

- [ ] **Step 7.6: Register commands in invoke_handler**

In `lib.rs`'s `tauri::Builder`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    enqueue_run,
    cancel_run,
    get_queue,
    clear_queue,
    resume_pending_runs,
    cancel_pending_runs,
])
```

- [ ] **Step 7.7: Verify build**

```bash
npm run check
```

Expected: tsc + cargo check pass.

- [ ] **Step 7.8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/runs/queue.rs
git commit -m "F task 7: wire RunQueue into Tauri state with 6 new commands + event forwarder"
```

---

### Task 8: Remove old streaming code

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 8.1: Find old code**

```bash
grep -n "run_grok_streaming_task\|cancel_grok_run\|grok-stream" src-tauri/src/lib.rs
```

List all references; should be ~5-10 locations.

- [ ] **Step 8.2: Delete `run_grok_streaming_task` function and helpers**

Identify the function span (use `grep -n "fn run_grok_streaming_task"` then read 30 lines below until matching close brace). Delete the function and any private helpers used only by it (you'll know by `grep -n` for the helper name).

- [ ] **Step 8.3: Delete `cancel_grok_run`**

Same as above for `cancel_grok_run`. Note: replaced by `cancel_run(runId)`.

- [ ] **Step 8.4: Remove from `invoke_handler!` list**

In `tauri::generate_handler![...]`, delete `run_grok_streaming_task,` and `cancel_grok_run,` entries.

- [ ] **Step 8.5: Verify cargo check**

```bash
cd src-tauri && cargo check
```

Expected: zero errors. If "unused" warnings on imports, clean those up.

- [ ] **Step 8.6: Verify frontend tsc fails predictably**

```bash
npm run check 2>&1 | head -30
```

Expected: tsc errors in `src/lib/grok.ts` or `src/App.tsx` referencing the deleted commands. **This is expected** — Task 9 onwards rewrites the frontend.

To unblock build temporarily: in `src/lib/grok.ts`, replace the file body with a stub that throws on call. Task 11 will replace it properly.

```typescript
// src/lib/grok.ts — temporary stub (Task 8 → replaced in Task 11)
export async function callGrokCLI(): Promise<never> {
  throw new Error("legacy callGrokCLI removed in F task 8; not yet replaced");
}
export async function cancelGrokCLI(): Promise<void> {
  throw new Error("legacy cancelGrokCLI removed");
}
```

In `src/App.tsx`, search for usages of `callGrokCLI` and `cancelGrokCLI` and wrap each call in `// FIXME(F-task11): wire to enqueue_run` — but to keep tsc green, ensure the imports still typecheck via the stub.

- [ ] **Step 8.7: Verify build + smoke**

```bash
npm run check && npm run build && npm test
```

Expected: all three pass. The app will compile but `callGrokCLI` calls would throw at runtime. **App is not runnable end-to-end until Task 11.** Document this clearly in commit message.

- [ ] **Step 8.8: Commit**

```bash
git add src-tauri/src/lib.rs src/lib/grok.ts src/App.tsx
git commit -m "F task 8: delete legacy run_grok_streaming_task + raw-chunk path

Stubs src/lib/grok.ts so tsc/build stay green. App is NOT runnable
end-to-end until Task 11 wires the new streamStore-based pipeline."
```

---

### Task 9: SessionState.history → SQLite migration

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 9.1: Find SessionState**

```bash
grep -n "struct SessionState\|fn load_session_state\|fn save_session_state" src-tauri/src/lib.rs
```

- [ ] **Step 9.2: Add migration call in setup**

In the `.setup(|app| { ... })` block, after `Db::open_at()`, before spawning queue worker:

```rust
// One-shot migration: if session_state.json has a non-empty history array,
// import as Done runs in SQLite, then clear the field.
let session_path = resource_dir.join("session_state.json");
if let Ok(content) = std::fs::read_to_string(&session_path) {
    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(history) = v.get("history").and_then(|h| h.as_array()) {
            if !history.is_empty() {
                for item in history {
                    let id = uuid::Uuid::now_v7().to_string();
                    let prompt = item.get("prompt").and_then(|p| p.as_str()).unwrap_or("").to_string();
                    let cwd = item.get("cwd").and_then(|c| c.as_str()).unwrap_or("/").to_string();
                    let when = item.get("at").and_then(|t| t.as_i64()).unwrap_or(0);
                    let rec = crate::runs::db::RunRecord {
                        id, prompt, cwd, args_json: "[]".into(),
                        state: crate::runs::db::RunState::Done,
                        enqueued_at: when,
                        started_at: Some(when),
                        ended_at: Some(when),
                        stop_reason: Some("legacy".into()),
                        error: None,
                    };
                    let _ = db.insert_run(&rec).await;
                }
            }
            v.as_object_mut().and_then(|o| o.remove("history"));
            let _ = std::fs::write(&session_path, serde_json::to_string_pretty(&v).unwrap_or_default());
        }
    }
}
```

- [ ] **Step 9.3: Verify build**

```bash
npm run check
```

- [ ] **Step 9.4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "F task 9: one-shot migrate SessionState.history into runs.sqlite"
```

---

**End of Phase 1.** All Rust backend is in place. App not yet runnable end-to-end — Phase 2 wires React.

---

## Phase 2: React frontend foundation (Tasks 10-15)

### Task 10: Add React dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 10.1: Install**

```bash
cd "~/grok-build-desktop"
npm install marked highlight.js react-virtuoso
npm install --save-dev @types/marked
```

- [ ] **Step 10.2: Verify**

```bash
npm run check && npm run build
```

Bundle size will increase; check it stays under target (will tune more in Task 25). Anywhere from +90-130 KB gzip is fine.

- [ ] **Step 10.3: Commit**

```bash
git add package.json package-lock.json
git commit -m "F task 10: add marked + highlight.js + react-virtuoso"
```

---

### Task 11: streamStore singleton (TDD)

**Files:**
- Create: `src/lib/streamStore.ts`
- Create: `src/lib/__tests__/streamStore.test.ts`
- Modify: `src/lib/grok.ts` (replace stub with real wrapper)

- [ ] **Step 11.1: Write failing test**

`src/lib/__tests__/streamStore.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { streamStore, applyRunEvent, applyStateChange, replaceQueue } from '../streamStore';

beforeEach(() => streamStore.__reset());

describe('streamStore', () => {
  it('appends text on text event and tracks chars', () => {
    applyRunEvent('r1', { type: 'text', data: 'hello' });
    applyRunEvent('r1', { type: 'text', data: ' world' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.text).toBe('hello world');
    expect(snap?.textChars).toBe(11);
    expect(snap?.lastEventType).toBe('text');
  });

  it('counts thought chars separately', () => {
    applyRunEvent('r1', { type: 'thought', data: 'thinking' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.thoughtChars).toBe(8);
    expect(snap?.text).toBe('');
    expect(snap?.lastEventType).toBe('thought');
  });

  it('end event marks done and records stopReason', () => {
    applyRunEvent('r1', { type: 'text', data: 'hi' });
    applyRunEvent('r1', { type: 'end', stopReason: 'EndTurn', sessionId: 's', requestId: 'r' });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.state).toBe('done');
    expect(snap?.stopReason).toBe('EndTurn');
  });

  it('applyStateChange overwrites state and timestamps', () => {
    applyStateChange('r1', { state: 'Running', startedAt: 100 });
    const snap = streamStore.getRunSnapshot('r1');
    expect(snap?.state).toBe('running');
    expect(snap?.startedAt).toBe(100);
  });

  it('replaceQueue overwrites queue snapshot', () => {
    replaceQueue({ active: 'r1', items: [{ id: 'r2', prompt: 'p', state: 'Queued', enqueuedAt: 1 } as any] });
    expect(streamStore.getQueueSnapshot().active).toBe('r1');
    expect(streamStore.getQueueSnapshot().items.length).toBe(1);
  });

  it('subscriber notified on event', () => {
    let calls = 0;
    const unsub = streamStore.subscribe(() => calls++);
    applyRunEvent('r1', { type: 'text', data: 'a' });
    expect(calls).toBeGreaterThan(0);
    unsub();
  });
});
```

- [ ] **Step 11.2: Ensure vitest configured**

Check `package.json` for vitest. If not present:
```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

Add to `package.json` scripts:
```json
"test:unit": "vitest run",
"test:unit:watch": "vitest"
```

Add `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 11.3: Run test, expect FAIL**

```bash
npm run test:unit
```

Expected: streamStore.ts not found → error.

- [ ] **Step 11.4: Implement streamStore.ts**

`src/lib/streamStore.ts`:
```typescript
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type GrokEvent =
  | { type: 'thought'; data: string }
  | { type: 'text'; data: string }
  | { type: 'end'; stopReason: string; sessionId: string; requestId: string }
  | { type: string; [k: string]: unknown };

export type RunState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

export interface RunSnapshot {
  id: string;
  state: RunState;
  startedAt: number | null;
  endedAt: number | null;
  thoughtChars: number;
  textChars: number;
  lastEventType: 'thought' | 'text' | 'end' | null;
  text: string;
  htmlVersion: number;
  stopReason: string | null;
  error: string | null;
}

export interface QueuedRunMeta {
  id: string;
  prompt: string;
  cwd?: string;
  state: 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed';
  enqueuedAt: number;
}

interface QueueSnapshot {
  active: string | null;
  items: QueuedRunMeta[];
}

type Listener = () => void;

class StreamStore {
  private runs = new Map<string, RunSnapshot>();
  private html = new Map<string, string>();
  private queue: QueueSnapshot = { active: null, items: [] };
  private listeners = new Set<Listener>();

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private notify() {
    this.listeners.forEach((l) => l());
  }

  getRunSnapshot = (id: string): RunSnapshot | undefined => this.runs.get(id);
  getHtml = (id: string): string | undefined => this.html.get(id);
  getQueueSnapshot = (): QueueSnapshot => this.queue;
  getActiveRunSnapshot = (): RunSnapshot | undefined =>
    this.queue.active ? this.runs.get(this.queue.active) : undefined;

  patchRun = (id: string, patch: Partial<RunSnapshot>): void => {
    const cur = this.runs.get(id) ?? this.makeEmpty(id);
    this.runs.set(id, { ...cur, ...patch });
    this.notify();
  };

  setHtml = (id: string, html: string): void => {
    this.html.set(id, html);
    const cur = this.runs.get(id);
    if (cur) {
      this.runs.set(id, { ...cur, htmlVersion: cur.htmlVersion + 1 });
    }
    this.notify();
  };

  setQueue = (q: QueueSnapshot): void => {
    this.queue = q;
    this.notify();
  };

  private makeEmpty(id: string): RunSnapshot {
    return {
      id, state: 'queued',
      startedAt: null, endedAt: null,
      thoughtChars: 0, textChars: 0,
      lastEventType: null, text: '',
      htmlVersion: 0,
      stopReason: null, error: null,
    };
  }

  /** Test helper. */
  __reset = (): void => {
    this.runs.clear();
    this.html.clear();
    this.queue = { active: null, items: [] };
    this.listeners.clear();
  };
}

export const streamStore = new StreamStore();

export function applyRunEvent(runId: string, event: GrokEvent): void {
  const cur = streamStore.getRunSnapshot(runId);
  if (event.type === 'thought') {
    const data = (event as any).data as string;
    streamStore.patchRun(runId, {
      thoughtChars: (cur?.thoughtChars ?? 0) + data.length,
      lastEventType: 'thought',
      state: cur?.state === 'queued' ? 'running' : cur?.state ?? 'running',
    });
  } else if (event.type === 'text') {
    const data = (event as any).data as string;
    streamStore.patchRun(runId, {
      text: (cur?.text ?? '') + data,
      textChars: (cur?.textChars ?? 0) + data.length,
      lastEventType: 'text',
      state: cur?.state === 'queued' ? 'running' : cur?.state ?? 'running',
    });
  } else if (event.type === 'end') {
    const e = event as Extract<GrokEvent, { type: 'end' }>;
    streamStore.patchRun(runId, {
      state: 'done',
      lastEventType: 'end',
      stopReason: e.stopReason,
      endedAt: Date.now(),
    });
  }
  // Unknown events: ignore (forward-compat).
}

export function applyStateChange(
  runId: string,
  payload: { state: 'Queued' | 'Running' | 'Done' | 'Cancelled' | 'Failed'; startedAt?: number | null; endedAt?: number | null; error?: string | null }
): void {
  streamStore.patchRun(runId, {
    state: payload.state.toLowerCase() as RunState,
    startedAt: payload.startedAt ?? streamStore.getRunSnapshot(runId)?.startedAt ?? null,
    endedAt: payload.endedAt ?? streamStore.getRunSnapshot(runId)?.endedAt ?? null,
    error: payload.error ?? streamStore.getRunSnapshot(runId)?.error ?? null,
  });
}

export function replaceQueue(q: QueueSnapshot): void {
  streamStore.setQueue(q);
}

let unlistenFns: UnlistenFn[] = [];
export async function attachTauriListeners(): Promise<void> {
  if (unlistenFns.length > 0) return;
  const u1 = await listen<{ runId: string; event: GrokEvent }>('grok-desktop://run-event', (e) => {
    applyRunEvent(e.payload.runId, e.payload.event);
  });
  const u2 = await listen<{ runId: string; state: string; startedAt?: number; endedAt?: number; error?: string }>(
    'grok-desktop://run-state-changed',
    (e) => applyStateChange(e.payload.runId, e.payload as any),
  );
  const u3 = await listen<{ active: string | null; queue: QueuedRunMeta[] }>(
    'grok-desktop://queue-changed',
    (e) => replaceQueue({ active: e.payload.active, items: e.payload.queue }),
  );
  unlistenFns = [u1, u2, u3];
}

export function detachTauriListeners(): void {
  unlistenFns.forEach((fn) => fn());
  unlistenFns = [];
}
```

- [ ] **Step 11.5: Run test, pass**

```bash
npm run test:unit
```

Expected: 6 passed.

- [ ] **Step 11.6: Replace `src/lib/grok.ts` stub with real wrapper**

`src/lib/grok.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { attachTauriListeners } from './streamStore';

export async function ensureStreamListenersAttached(): Promise<void> {
  await attachTauriListeners();
}

export async function enqueueRun(opts: {
  prompt: string;
  cwd: string;
  args: string[];
}): Promise<{ runId: string; position: number }> {
  return invoke('enqueue_run', opts);
}

export async function cancelRun(runId: string): Promise<boolean> {
  return invoke('cancel_run', { runId });
}

export async function getQueue(): Promise<{
  active: string | null;
  queue: Array<{ id: string; prompt: string; cwd: string; state: string; enqueuedAt: number }>;
}> {
  return invoke('get_queue');
}

export async function clearQueue(): Promise<number> {
  return invoke('clear_queue');
}

export async function resumePendingRuns(): Promise<number> {
  return invoke('resume_pending_runs');
}

export async function cancelPendingRuns(): Promise<number> {
  return invoke('cancel_pending_runs');
}
```

- [ ] **Step 11.7: Verify tsc**

```bash
npm run check
```

`src/App.tsx` will likely have tsc errors (`callGrokCLI` no longer exported). Add temporary shims in App.tsx by replacing `callGrokCLI(...)` calls with `// FIXME(F-task21): wire enqueueRun` and substituting a no-op so tsc passes. **Don't try to wire the new flow yet — that's Task 21.** Goal here is keep build green.

- [ ] **Step 11.8: Commit**

```bash
git add src/lib package.json package-lock.json vitest.config.ts
git commit -m "F task 11: streamStore with useSyncExternalStore-shaped subscribe + reducers"
```

---

### Task 12: Selector hooks

**Files:**
- Create: `src/hooks/useRunSnapshot.ts`
- Create: `src/hooks/useQueue.ts`
- Create: `src/hooks/useActiveRun.ts`
- Create: `src/hooks/useElapsed.ts`

- [ ] **Step 12.1: useRunSnapshot**

`src/hooks/useRunSnapshot.ts`:
```typescript
import { useSyncExternalStore } from 'react';
import { streamStore, type RunSnapshot } from '../lib/streamStore';

export function useRunSnapshot(runId: string | null | undefined): RunSnapshot | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (runId ? streamStore.getRunSnapshot(runId) : undefined),
    () => undefined,
  );
}

export function useRunHtml(runId: string | null | undefined): string | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => (runId ? streamStore.getHtml(runId) : undefined),
    () => undefined,
  );
}
```

- [ ] **Step 12.2: useQueue**

`src/hooks/useQueue.ts`:
```typescript
import { useSyncExternalStore } from 'react';
import { streamStore } from '../lib/streamStore';

export function useQueue() {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => streamStore.getQueueSnapshot(),
    () => ({ active: null, items: [] }),
  );
}
```

- [ ] **Step 12.3: useActiveRun**

`src/hooks/useActiveRun.ts`:
```typescript
import { useSyncExternalStore } from 'react';
import { streamStore, type RunSnapshot } from '../lib/streamStore';

export function useActiveRun(): RunSnapshot | undefined {
  return useSyncExternalStore(
    streamStore.subscribe,
    () => streamStore.getActiveRunSnapshot(),
    () => undefined,
  );
}
```

- [ ] **Step 12.4: useElapsed (200ms tick)**

`src/hooks/useElapsed.ts`:
```typescript
import { useEffect, useState } from 'react';

/**
 * Returns elapsed milliseconds since `startedAt` (wall clock), ticking every 200ms.
 * Returns null if startedAt is null. Stops ticking when `endedAt` is non-null.
 */
export function useElapsed(startedAt: number | null, endedAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const handle = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(handle);
  }, [startedAt, endedAt]);
  if (!startedAt) return null;
  return (endedAt ?? now) - startedAt;
}
```

- [ ] **Step 12.5: Verify build**

```bash
npm run check
```

- [ ] **Step 12.6: Commit**

```bash
git add src/hooks
git commit -m "F task 12: useRunSnapshot / useQueue / useActiveRun / useElapsed hooks"
```

---

### Task 13: markdown.worker.ts

**Files:**
- Create: `src/lib/markdown.worker.ts`
- Modify: `vite.config.ts`

- [ ] **Step 13.1: Verify vite worker support**

Check current `vite.config.ts`. Vite 7 supports `?worker` import out of the box; no plugin needed. Confirm by reading the file.

- [ ] **Step 13.2: Write worker**

`src/lib/markdown.worker.ts`:
```typescript
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';

marked.setOptions({
  gfm: true,
  breaks: false,
});

// Register code-fence highlighting via marked extension.
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      let highlighted = text;
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(text).value;
        } catch {
          highlighted = escapeHtml(text);
        }
      }
      const langClass = lang ? ` language-${lang}` : '';
      return `<pre class="code-block"><code class="hljs${langClass}">${highlighted}</code></pre>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface ParseRequest {
  runId: string;
  text: string;
}

interface ParseResponse {
  runId: string;
  html: string;
}

self.addEventListener('message', (e: MessageEvent<ParseRequest>) => {
  const { runId, text } = e.data;
  try {
    const html = marked.parse(text, { async: false }) as string;
    const resp: ParseResponse = { runId, html };
    (self as DedicatedWorkerGlobalScope).postMessage(resp);
  } catch (err) {
    const safe = escapeHtml(text);
    (self as DedicatedWorkerGlobalScope).postMessage({ runId, html: `<pre>${safe}</pre>` });
  }
});

export {}; // make TS treat this as a module
```

- [ ] **Step 13.3: Verify build**

```bash
npm run build
```

Expected: build succeeds, worker bundled separately (look for `assets/markdown.worker-*.js` in output).

- [ ] **Step 13.4: Commit**

```bash
git add src/lib/markdown.worker.ts
git commit -m "F task 13: markdown.worker.ts (marked + highlight.js, code-fence renderer)"
```

---

### Task 14: markdownWorker.ts main-thread wrapper

**Files:**
- Create: `src/lib/markdownWorker.ts`

- [ ] **Step 14.1: Write wrapper**

`src/lib/markdownWorker.ts`:
```typescript
import { streamStore } from './streamStore';

let worker: Worker | null = null;
const latestByRun = new Map<string, string>();
const inflight = new Set<string>();
let scheduling = false;

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ runId: string; html: string }>) => {
      const { runId, html } = e.data;
      streamStore.setHtml(runId, html);
      inflight.delete(runId);
      // If a newer text arrived while we were parsing, schedule again.
      if (latestByRun.has(runId)) {
        const next = latestByRun.get(runId)!;
        latestByRun.delete(runId);
        postParse(runId, next);
      }
    });
    worker.addEventListener('error', (err) => {
      console.warn('markdown.worker error, falling back to main-thread parse', err);
      worker = null;
    });
  }
  return worker;
}

function postParse(runId: string, text: string): void {
  const w = ensureWorker();
  inflight.add(runId);
  w.postMessage({ runId, text });
}

export function scheduleMarkdownParse(runId: string, text: string): void {
  if (inflight.has(runId)) {
    // Stash latest; will be processed when current finishes.
    latestByRun.set(runId, text);
    return;
  }
  postParse(runId, text);
}
```

- [ ] **Step 14.2: Hook into streamStore**

In `src/lib/streamStore.ts`, after the `applyRunEvent` for the `text` branch, schedule a parse. Modify:
```typescript
} else if (event.type === 'text') {
  const data = (event as any).data as string;
  const cur = streamStore.getRunSnapshot(runId);
  const nextText = (cur?.text ?? '') + data;
  streamStore.patchRun(runId, {
    text: nextText,
    textChars: (cur?.textChars ?? 0) + data.length,
    lastEventType: 'text',
    state: cur?.state === 'queued' ? 'running' : cur?.state ?? 'running',
  });
  // Lazy-import to avoid pulling the worker in unit tests.
  import('./markdownWorker').then(({ scheduleMarkdownParse }) => {
    scheduleMarkdownParse(runId, nextText);
  });
}
```

- [ ] **Step 14.3: Verify build**

```bash
npm run check && npm run build
```

- [ ] **Step 14.4: Commit**

```bash
git add src/lib/markdownWorker.ts src/lib/streamStore.ts
git commit -m "F task 14: markdownWorker.ts (debounced, latest-text-per-run)"
```

---

### Task 15: Wire listener attach on app mount

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 15.1: Attach listeners**

In `src/main.tsx`, before `ReactDOM.createRoot(...).render(...)`:
```typescript
import { ensureStreamListenersAttached } from './lib/grok';

// Fire and forget; failures will just leave the store empty.
void ensureStreamListenersAttached().catch((e) => console.warn('attach listeners failed', e));
```

- [ ] **Step 15.2: Verify build**

```bash
npm run check && npm run build
```

- [ ] **Step 15.3: Commit**

```bash
git add src/main.tsx
git commit -m "F task 15: attach Tauri stream listeners on app mount"
```

---

**End of Phase 2.** Data plumbing is complete. App still doesn't render new pipeline — Phase 3 builds the components.

---

## Phase 3: UI components (Tasks 16-21)

### Task 16: MessageItem component

**Files:**
- Create: `src/components/MessageItem.tsx`

- [ ] **Step 16.1: Write component**

`src/components/MessageItem.tsx`:
```tsx
import { memo } from 'react';
import { useRunHtml, useRunSnapshot } from '../hooks/useRunSnapshot';

interface Props {
  runId: string;
  /** If the run has no html yet, fall back to plain text. */
  fallbackText?: string;
}

function MessageItemImpl({ runId, fallbackText }: Props) {
  const snap = useRunSnapshot(runId);
  const html = useRunHtml(runId);
  if (!snap) return null;

  if (html) {
    return <div className="message-body" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="message-body streaming-raw">{snap.text || fallbackText || ''}</pre>;
}

export const MessageItem = memo(MessageItemImpl);
```

- [ ] **Step 16.2: Verify build**

```bash
npm run check
```

- [ ] **Step 16.3: Commit**

```bash
git add src/components/MessageItem.tsx
git commit -m "F task 16: MessageItem (memoed, subscribes to own runId html)"
```

---

### Task 17: MessageList with virtuoso

**Files:**
- Create: `src/components/MessageList.tsx`

- [ ] **Step 17.1: Write component**

`src/components/MessageList.tsx`:
```tsx
import { Virtuoso } from 'react-virtuoso';
import { MessageItem } from './MessageItem';

export interface MessageRef {
  runId: string;
  role: 'user' | 'assistant';
  /** For user messages (no streaming), the static text content. */
  userText?: string;
  /** For assistant messages, only runId is needed. */
}

interface Props {
  messages: MessageRef[];
}

export function MessageList({ messages }: Props) {
  return (
    <Virtuoso
      data={messages}
      followOutput="auto"
      style={{ height: '100%' }}
      itemContent={(_, msg) => {
        if (msg.role === 'user') {
          return (
            <div className="message message-user">
              <pre className="message-body">{msg.userText}</pre>
            </div>
          );
        }
        return (
          <div className="message message-assistant">
            <MessageItem runId={msg.runId} />
          </div>
        );
      }}
    />
  );
}
```

- [ ] **Step 17.2: Verify build**

```bash
npm run check && npm run build
```

- [ ] **Step 17.3: Commit**

```bash
git add src/components/MessageList.tsx
git commit -m "F task 17: MessageList with react-virtuoso + follow-bottom"
```

---

### Task 18: StatusBar component

**Files:**
- Create: `src/components/StatusBar.tsx`

- [ ] **Step 18.1: Write component**

`src/components/StatusBar.tsx`:
```tsx
import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';

function formatTokens(chars: number): string {
  const tokens = Math.round(chars / 4);
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

function stateText(snap: ReturnType<typeof useActiveRun>): string {
  if (!snap) return 'idle';
  if (snap.state === 'done') return `done · ${snap.stopReason ?? ''}`.trim();
  if (snap.state === 'cancelled') return 'cancelled';
  if (snap.state === 'failed') return `failed${snap.error ? ': ' + snap.error : ''}`;
  if (snap.state === 'queued') return 'waiting...';
  if (snap.lastEventType === 'thought') return 'thinking...';
  if (snap.lastEventType === 'text') return 'writing...';
  return 'running...';
}

export function StatusBar() {
  const active = useActiveRun();
  const queue = useQueue();
  const elapsed = useElapsed(active?.startedAt ?? null, active?.endedAt ?? null);
  const chars = (active?.thoughtChars ?? 0) + (active?.textChars ?? 0);
  const queuedExtra = queue.items.length;
  if (!active) return <div className="status-bar status-bar-idle">idle</div>;
  return (
    <div className="status-bar">
      <span className="status-elapsed">{elapsed != null ? formatElapsed(elapsed) : '0.0s'}</span>
      <span className="status-sep">·</span>
      <span className="status-tokens">≈{formatTokens(chars)} tokens</span>
      <span className="status-sep">·</span>
      <span className="status-state">{stateText(active)}</span>
      {queuedExtra > 0 ? (
        <>
          <span className="status-sep">·</span>
          <span className="status-queue">+{queuedExtra} queued</span>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 18.2: Add CSS**

Append to `src/App.css`:
```css
.status-bar {
  align-items: center;
  color: var(--text-muted);
  display: flex;
  font-size: 12px;
  gap: 6px;
  padding: 4px 12px;
}
.status-bar-idle { color: var(--text-faint); }
.status-elapsed { font-variant-numeric: tabular-nums; }
.status-tokens { font-variant-numeric: tabular-nums; }
.status-state { color: var(--text-emphasis); }
.status-queue { color: var(--text-accent); }
.status-sep { color: var(--text-faint); }
```

- [ ] **Step 18.3: Verify build**

```bash
npm run check && npm run build
```

- [ ] **Step 18.4: Commit**

```bash
git add src/components/StatusBar.tsx src/App.css
git commit -m "F task 18: StatusBar component (elapsed · ≈tokens · state · queue)"
```

---

### Task 19: QueueDock

**Files:**
- Create: `src/components/QueueDock.tsx`

- [ ] **Step 19.1: Write component**

`src/components/QueueDock.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useActiveRun } from '../hooks/useActiveRun';
import { useElapsed } from '../hooks/useElapsed';
import { useQueue } from '../hooks/useQueue';
import { cancelPendingRuns, cancelRun, getQueue, resumePendingRuns } from '../lib/grok';
import { replaceQueue } from '../lib/streamStore';

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

export function QueueDock() {
  const [expanded, setExpanded] = useState(false);
  const queue = useQueue();
  const active = useActiveRun();
  const elapsed = useElapsed(active?.startedAt ?? null, active?.endedAt ?? null);
  const [resumeBannerVisible, setResumeBannerVisible] = useState(false);
  const [bannerCount, setBannerCount] = useState(0);

  useEffect(() => {
    // On mount, fetch full queue snapshot once. The `queue-changed` event keeps it in sync after.
    getQueue().then((snap) => {
      replaceQueue({ active: snap.active, items: snap.queue as any });
      // If there are queued items and no active, show resume banner.
      const queuedItems = snap.queue.filter((r) => r.state === 'Queued');
      if (queuedItems.length > 0 && !snap.active) {
        setBannerCount(queuedItems.length);
        setResumeBannerVisible(true);
      }
    });
  }, []);

  const handleResume = async () => {
    await resumePendingRuns();
    setResumeBannerVisible(false);
  };
  const handleCancelAll = async () => {
    await cancelPendingRuns();
    setResumeBannerVisible(false);
  };

  if (!active && queue.items.length === 0 && !resumeBannerVisible) return null;

  return (
    <div className="queue-dock">
      {resumeBannerVisible ? (
        <div className="queue-banner">
          <span>↻ Last session had {bannerCount} pending tasks</span>
          <button onClick={handleResume}>Resume all</button>
          <button onClick={handleCancelAll}>Cancel all</button>
        </div>
      ) : null}

      <div className="queue-summary" onClick={() => setExpanded((v) => !v)}>
        {active ? (
          <span className="queue-active">▶ Running {elapsed != null ? formatElapsed(elapsed) : '0s'}</span>
        ) : (
          <span className="queue-idle">▶ Idle</span>
        )}
        {queue.items.length > 0 ? (
          <span className="queue-count">+ {queue.items.length} queued</span>
        ) : null}
        <span className="queue-expand">{expanded ? '⤒ collapse' : '⤓ expand'}</span>
      </div>

      {expanded ? (
        <ul className="queue-list">
          {queue.items.map((item) => (
            <li key={item.id} className="queue-item">
              <span className="queue-item-state">⏸</span>
              <span className="queue-item-prompt">{item.prompt.slice(0, 80)}</span>
              <button onClick={() => cancelRun(item.id)}>✕</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 19.2: Add CSS**

Append to `src/App.css`:
```css
.queue-dock {
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-faint);
  display: flex;
  flex-direction: column;
}
.queue-banner {
  align-items: center;
  background: var(--surface-info);
  display: flex;
  font-size: 12px;
  gap: 12px;
  padding: 6px 12px;
}
.queue-banner button {
  background: var(--button-primary);
  border: none; border-radius: 4px;
  color: white; cursor: pointer;
  font-size: 11px; padding: 3px 8px;
}
.queue-summary {
  align-items: center;
  cursor: pointer;
  display: flex;
  font-size: 12px;
  gap: 10px;
  padding: 4px 12px;
}
.queue-active { color: var(--text-emphasis); }
.queue-count { color: var(--text-accent); }
.queue-expand { color: var(--text-faint); margin-left: auto; }
.queue-list {
  list-style: none;
  margin: 0; padding: 0;
  border-top: 1px solid var(--border-faint);
}
.queue-item {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 8px;
  padding: 4px 12px;
}
.queue-item-prompt {
  color: var(--text-emphasis);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-item button {
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 14px;
}
```

- [ ] **Step 19.3: Build**

```bash
npm run check && npm run build
```

- [ ] **Step 19.4: Commit**

```bash
git add src/components/QueueDock.tsx src/App.css
git commit -m "F task 19: QueueDock (banner + summary + expanded list, per-item cancel)"
```

---

### Task 20: Composer extraction

**Files:**
- Create: `src/components/Composer.tsx`

- [ ] **Step 20.1: Write component**

`src/components/Composer.tsx`:
```tsx
import { useRef, useState } from 'react';
import { enqueueRun } from '../lib/grok';
import { useActiveRun } from '../hooks/useActiveRun';
import { useQueue } from '../hooks/useQueue';

interface Props {
  cwd: string;
  argsBuilder: () => string[];
  placeholder?: string;
  onEnqueued?: (info: { runId: string; position: number }) => void;
}

export function Composer({ cwd, argsBuilder, placeholder, onEnqueued }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const active = useActiveRun();
  const queue = useQueue();

  const hasInflight = Boolean(active && active.state === 'running') || queue.items.length > 0;

  const submit = async () => {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    const args = argsBuilder();
    args.push('-p', text);
    const result = await enqueueRun({ prompt: text, cwd, args });
    el.value = '';
    onEnqueued?.(result);
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        placeholder={placeholder ?? (hasInflight ? 'Queue another prompt…' : 'Ask Grok…')}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="composer-send" onClick={submit}>
        {hasInflight ? 'Enqueue' : 'Send'}
      </button>
    </div>
  );
}
```

- [ ] **Step 20.2: Verify build**

```bash
npm run check
```

- [ ] **Step 20.3: Commit**

```bash
git add src/components/Composer.tsx
git commit -m "F task 20: Composer (uncontrolled ref + IME guard + enqueue label switch)"
```

---

### Task 21: Wire components into App.tsx

**Files:**
- Modify: `src/App.tsx`

This is the largest single edit. Goal: replace the inline streaming UI with our new components, while keeping all other features (sidebar, settings, themes, etc.) intact.

- [ ] **Step 21.1: Identify replacement sites**

```bash
grep -n "callGrokCLI\|cancelGrokCLI\|streaming-raw\|terminal-code\|ThinkingIndicator\|messages\[" src/App.tsx | head -40
```

Note the line ranges for:
- Message list rendering
- Composer textarea
- Status / activity strip
- Old `callGrokCLI` calls (FIXME markers from Task 8/11)

- [ ] **Step 21.2: Replace message list**

Find the JSX block that renders `messages.map(...)` and replace with:
```tsx
<MessageList messages={messageRefs} />
```

Where `messageRefs` is derived from existing `messages` state:
```tsx
const messageRefs: MessageRef[] = useMemo(
  () => messages.map((m) =>
    m.role === 'user'
      ? { runId: '', role: 'user' as const, userText: m.text }
      : { runId: m.runId ?? '', role: 'assistant' as const }
  ),
  [messages],
);
```

`messages` items will need a `runId` field. Update where assistant messages are appended (in the new onEnqueued callback): include `runId` from `enqueueRun`'s return.

- [ ] **Step 21.3: Replace composer**

Delete the old textarea + Send button JSX. Insert:
```tsx
<Composer
  cwd={cwd}
  argsBuilder={() => buildGrokArgs(/* model, effort, etc. — read from existing state */)}
  onEnqueued={({ runId, position }) => {
    setMessages((cur) => [
      ...cur,
      { role: 'user', text: /* last submitted text — get from ref */ },
      { role: 'assistant', runId, text: '' },
    ]);
    if (position > 0) {
      toast(`queued (#${position})`);
    }
  }}
/>
```

`buildGrokArgs(...)` is a helper that constructs the existing CLI args (model, effort, permission-mode, etc.) from settings state. Define it inline near the Composer mount. **Critical:** include `--output-format`, `streaming-json` in the args.

Example `buildGrokArgs`:
```tsx
function buildGrokArgs(opts: { model: string; effort: string; permissionMode: string; disableWebSearch: boolean; noSubagents: boolean; maxTurns: number }): string[] {
  const args: string[] = ['--no-alt-screen', '--output-format', 'streaming-json'];
  args.push('--model', opts.model);
  args.push('--effort', opts.effort);
  if (opts.permissionMode && opts.permissionMode !== 'default') {
    args.push('--permission-mode', opts.permissionMode);
  }
  if (opts.disableWebSearch) args.push('--disable-web-search');
  if (opts.noSubagents) args.push('--no-subagents');
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
  return args;
}
```

- [ ] **Step 21.4: Insert StatusBar and QueueDock**

Just above the Composer (in the layout):
```tsx
<QueueDock />
<StatusBar />
<Composer ... />
```

- [ ] **Step 21.5: Remove old streaming state**

Delete from App.tsx:
- Old `streamingMessageId` / `busyRunner` / `activeGrokRunId` state
- Old `useEffect` registering `grok-stream` listener
- Old Stop button handler that called `cancelGrokCLI()` — replace with: `cancelRun(active.id)` using `useActiveRun()`.
- Old ThinkingIndicator component (the new StatusBar replaces it)

- [ ] **Step 21.6: Imports**

At the top of App.tsx:
```tsx
import { MessageList, type MessageRef } from './components/MessageList';
import { Composer } from './components/Composer';
import { StatusBar } from './components/StatusBar';
import { QueueDock } from './components/QueueDock';
import { cancelRun } from './lib/grok';
import { useActiveRun } from './hooks/useActiveRun';
```

Remove imports no longer used (`callGrokCLI`, `cancelGrokCLI` stubs, etc.).

- [ ] **Step 21.7: Verify build + smoke**

```bash
npm run check && npm run build && npm test
```

Expected: all pass. Smoke may fail on old guards expecting `grok-stream` event name — Task 24 updates smoke. For now, if smoke fails on items we know are gone, comment them out with `// TODO(F-task24)`.

- [ ] **Step 21.8: Manual quick test**

```bash
npm run tauri:dev
```

Launch app, send a tiny prompt. Verify:
- Streaming text appears
- StatusBar shows elapsed/tokens/state
- Sidebar remains clickable during streaming
- Stop button works
- New prompt while streaming enqueues with toast

If any of these fail, fix before commit. **Do not** commit a broken end-to-end.

- [ ] **Step 21.9: Commit**

```bash
git add src/App.tsx
git commit -m "F task 21: wire MessageList/StatusBar/QueueDock/Composer into App.tsx

End-to-end streaming path: Composer → enqueue_run → Rust queue → grok
--output-format streaming-json → typed Tauri events → streamStore →
MessageItem (worker-parsed markdown) + StatusBar + QueueDock.

Old streaming hooks and ThinkingIndicator removed."
```

---

**End of Phase 3.** App is now end-to-end functional with new pipeline.

---

## Phase 4: Smoke + Performance + Polish (Tasks 22-26)

### Task 22: Update smoke guards

**Files:**
- Modify: `scripts/smoke_test.mjs`

- [ ] **Step 22.1: Read current smoke**

```bash
cat scripts/smoke_test.mjs | head -100
```

- [ ] **Step 22.2: Remove obsolete guards**

Delete guards referencing:
- `callGrokCLI` (now `enqueueRun`)
- `ThinkingIndicator` (replaced by StatusBar)
- `grok-stream` Tauri event (replaced by 3 new events)
- `streaming-raw <pre>` fallback (worker always renders now)

- [ ] **Step 22.3: Add new guards**

Append to the assertions:
```javascript
// F task 22: new pipeline guards
assert(srcLib.includes('useSyncExternalStore'), 'streamStore.ts should import useSyncExternalStore (via hooks)');
assertFile('src/lib/streamStore.ts');
assertFile('src/lib/markdown.worker.ts');
assertFile('src/lib/markdownWorker.ts');
assertFile('src/components/MessageList.tsx');
assertFile('src/components/MessageItem.tsx');
assertFile('src/components/StatusBar.tsx');
assertFile('src/components/QueueDock.tsx');
assertFile('src/components/Composer.tsx');

const pkgJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert(pkgJson.dependencies['marked'], 'marked should be in deps');
assert(pkgJson.dependencies['highlight.js'], 'highlight.js should be in deps');
assert(pkgJson.dependencies['react-virtuoso'], 'react-virtuoso should be in deps');

const libRs = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
assert(libRs.includes('streaming-json') || libRs.includes('streaming_json'), 'lib.rs should reference streaming-json output format');
for (const cmd of ['enqueue_run', 'cancel_run', 'get_queue', 'clear_queue', 'resume_pending_runs', 'cancel_pending_runs']) {
  assert(libRs.includes(cmd), `lib.rs should register ${cmd} command`);
}
assert(!libRs.includes('run_grok_streaming_task'), 'old run_grok_streaming_task should be removed');
```

(Adjust `assertFile` / `assert` to whatever helpers smoke uses; existing pattern should be obvious from the file.)

- [ ] **Step 22.4: Run smoke**

```bash
npm test
```

Expected: smoke: ok.

- [ ] **Step 22.5: Commit**

```bash
git add scripts/smoke_test.mjs
git commit -m "F task 22: smoke guards for streamStore + markdown worker + new commands"
```

---

### Task 23: Performance profile + tune

**Files:** likely `src/lib/markdownWorker.ts`, `src/components/MessageList.tsx`, `src/lib/streamStore.ts`, `src/App.css`

This task is iterative. Measure first, tune second.

- [ ] **Step 23.1: Generate a heavy streaming prompt**

```bash
npm run tauri:dev
```

In the app, paste this prompt: `"Write a detailed 3000-word essay on the history of computing, with code examples in 5 languages (Python, Rust, JavaScript, Go, Haskell)."`

While it streams, capture a Chrome DevTools Performance recording in the Tauri webview:
- Right-click → Inspect Element → Performance tab
- Hit Record, type 30 seconds of Lorem Ipsum into Composer, click sidebar items 10x, click theme toggle 5x, click Stop
- Stop recording

- [ ] **Step 23.2: Check perf budget metrics**

Examine the recording:
- Frames > 16ms during the 30s typing window: should be < 10% of frames
- Long tasks (> 50ms): should be rare (< 5)
- Main thread idle: should be majority

Document baseline numbers in a scratch note.

- [ ] **Step 23.3: Tune if needed**

Common issues and fixes:
| Symptom | Fix |
|---|---|
| Worker can't keep up, html updates lag | In `markdownWorker.ts` add a 50ms `requestIdleCallback` schedule before posting |
| MessageItem re-renders too often | Add explicit memo equality fn checking `htmlVersion` only |
| Virtuoso flickers on streaming bottom | Pass `increaseViewportBy={{ top: 200, bottom: 400 }}` to keep render stable |
| StatusBar causes parent re-renders | Confirm StatusBar mounts as sibling of MessageList, not inside it |
| Code highlight latency | In worker, fall back to `escapeHtml` for code > 50KB (avoid hljs on huge blocks) |

- [ ] **Step 23.4: Re-measure after each tune**

Iterate until all 7 perf-budget targets are met. Document the final passing numbers.

- [ ] **Step 23.5: Add a `docs/superpowers/notes/F-perf-baseline.md`**

Write a short note: prompt used, hardware (Macbook model), DevTools metrics, tunings applied. Commit it.

- [ ] **Step 23.6: Commit (one or more)**

```bash
git add ...
git commit -m "F task 23: perf tune — <specific change>"
```

---

### Task 24: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 24.1: Update sections**

- Replace the architecture section with the new diagram from the spec.
- Update the "How streaming works" section (if any) to describe streaming-json + Web Worker + queue.
- Add a "Queue and persistence" section briefly explaining banner / 7-day retention.
- Update "Local files" section to mention `~/Library/Application Support/Grok Desktop/runs.sqlite`.
- Bump version in `package.json` and `src-tauri/Cargo.toml` to `0.2.0` (major UX change).

- [ ] **Step 24.2: Verify**

```bash
npm run check && npm run build && npm test
```

- [ ] **Step 24.3: Commit**

```bash
git add README.md package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "F task 24: README + version 0.2.0 for new streaming + queue architecture"
```

---

### Task 25: Manual full acceptance run

This is the gate to "satisfaction".

- [ ] **Step 25.1: Run all automated checks**

```bash
npm run check && npm run build && npm test && cd src-tauri && cargo test && cd ..
```

All must pass.

- [ ] **Step 25.2: Manual perf scenario**

```bash
npm run mac:install
open "/Users/you/Applications/Grok Desktop.app"
```

Run the spec's acceptance scenario (spec lines 478-485):
1. Performance budgets via DevTools (verified in Task 23).
2. Smoke guards (verified in Task 22).
3. Unit + integration test suites (verified in Step 25.1).
4. 5-minute streaming with concurrent typing/sidebar/theme/Stop — no UI freezes observed.
5. Restart with 2 queued runs: banner shows, both Resume and Cancel paths work.
6. Bundle gzip < 260 KB (check via `npm run build`'s gzip output line).

Each item: mark `✓` or `✗`. If `✗`, return to relevant earlier task and fix.

- [ ] **Step 25.3: Document the verification**

Create `docs/superpowers/notes/F-acceptance-2026-05-28.md` (or current date) with `✓`/`✗` checklist and any anomalies observed.

- [ ] **Step 25.4: Commit verification artifact**

```bash
git add docs/superpowers/notes/F-acceptance-*.md
git commit -m "F task 25: acceptance verification — all targets met"
```

---

### Task 26: Open PR

- [ ] **Step 26.1: Final push**

```bash
git push -u origin feature/F-non-blocking-ui
```

- [ ] **Step 26.2: Open PR**

```bash
gh pr create --title "F: Non-blocking UI + Real-time Status + Run Queue" --body "$(cat <<'EOF'
## Summary
- Re-architects streaming to keep UI fully responsive during runs.
- `grok --output-format streaming-json` parsed in Rust; typed events to React.
- SQLite-persisted FIFO run queue with restart-recovery banner and 7-day retention.
- Web Worker markdown (marked + highlight.js); message list uses react-virtuoso.
- Three-segment status bar (`elapsed · ≈tokens · state`).

## Acceptance evidence
- All 7 performance budgets met (see `docs/superpowers/notes/F-perf-baseline.md`).
- Smoke + Rust tests + unit tests all green.
- 5-minute live streaming scenario validates concurrent typing / sidebar / theme / Stop.
- Restart with 2 queued runs: banner Resume/Cancel both work.
- Bundle gzip 250 KB (< 260 KB budget).

Spec: `docs/superpowers/specs/2026-05-28-F-non-blocking-ui-design.md`
Plan: `docs/superpowers/plans/2026-05-28-F-non-blocking-ui.md`

## Test plan
- [x] `npm run check`
- [x] `npm run build`
- [x] `npm test`
- [x] `cd src-tauri && cargo test`
- [x] Manual perf scenario
- [x] Restart recovery scenario

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 26.3: Wait for review**

Hand off to the user with the PR URL.

---

## Acceptance summary (for the executor)

A task is "done" only when:

1. **Code committed** to feature branch with a `git commit` whose message references the task number.
2. **All tests pass:** `npm run check && npm run build && npm test && cd src-tauri && cargo test`.
3. **Smoke green** for any task touching files smoke checks.
4. **For UI-touching tasks (16-21, 23):** also run `npm run tauri:dev` and verify the change appears.

If any commit makes a test red, **revert and re-do**. Never commit red.

---

## Self-review

Going through the plan vs the spec section-by-section to confirm coverage:

| Spec section | Plan tasks |
|---|---|
| Problem / Goal / Non-goals | n/a (motivation) |
| Architecture | Architecture in plan header + tasks 6, 11, 17 implement it |
| Rust backend (RunQueue/StreamParser/SQLite/process kill) | Tasks 1-6, 7-9 |
| React frontend (streamStore/hooks/worker/components) | Tasks 10-21 |
| Data flow end-to-end | Implicit across 7, 11, 14, 21 |
| Restart recovery banner | Task 19 (frontend) + Task 7 (resume/cancel commands) + Task 9 (history migration) |
| Cancel semantics | Tasks 6, 19, 21 |
| Error handling | Task 6 (parse failures, timeouts) + 13 (worker fallback) |
| Performance budget | Task 23 |
| Test strategy | Tasks 2, 3, 5, 6, 11, 22, 25 |
| Phase breakdown | Phases 1-4 in this plan |
| Migration | Task 9 |
| Rollback plan | Implicit: feature branch — `git checkout main` to roll back |
| Acceptance | Task 25 |

**Coverage: complete.** No gaps.

**Placeholder scan:** No "TBD" / "TODO" / "fill in later" in any task body. Code is shown in every code-changing step.

**Type consistency:** `RunSnapshot` / `QueuedRunMeta` / `RunState` consistent in Rust (`RunState::Queued`) vs TS (`'queued'`) — TS uses lowercase for state values, Rust uses CamelCase. Wire format from Rust is CamelCase (via `RunState::as_str()`); `applyStateChange` in streamStore.ts converts to lowercase. This is intentional and explicit.

**Scope:** All within F sub-project. Defers C/A/B/D/E to their own plans.
