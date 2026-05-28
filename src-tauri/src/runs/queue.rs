use super::db::{Db, RunRecord, RunState};
use super::event::GrokEvent;
use super::parser::parse_line;
use super::process;
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::sync::{broadcast, Mutex, Notify};

/// Capacity of the broadcast channel that fans queue messages out to consumers
/// (Tauri event forwarder, optional Telegram daemon, future subscribers).
/// Large enough to absorb a burst of streaming-json events without lag for
/// the slowest realistic consumer (a Telegram bot bounded by Telegram's
/// 1 edit/sec recommendation).
const BROADCAST_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct QueueMessage {
    pub run_id: String,
    pub kind: QueueMessageKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum QueueMessageKind {
    Event {
        event: GrokEvent,
        /// Raw JSON line as emitted by `grok --output-format streaming-json`.
        /// Carried alongside the strongly-typed `event` so the frontend can
        /// recognize new event types (tool_use, subagent_*, etc.) without a
        /// Rust round-trip every time grok extends its protocol.
        raw: serde_json::Value,
    },
    StateChanged {
        state: RunState,
        started_at: Option<i64>,
        ended_at: Option<i64>,
        error: Option<String>,
    },
    QueueChanged,
}

pub struct RunQueue {
    pub db: Db,
    inner: Arc<Mutex<Inner>>,
    notify: Arc<Notify>,
    pub tx: broadcast::Sender<QueueMessage>,
}

struct Inner {
    waiting: VecDeque<RunRecord>,
    active: Option<String>,
    cancelled: HashSet<String>,
    /// Process-group id of the running grok child, if any.
    active_pgid: Option<i32>,
    grok_path: PathBuf,
}

impl RunQueue {
    pub async fn new(db: Db, grok_path: PathBuf) -> (Self, broadcast::Receiver<QueueMessage>) {
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
        };
        let (tx, rx) = broadcast::channel(BROADCAST_CAPACITY);
        let queue = Self {
            db,
            inner: Arc::new(Mutex::new(inner)),
            notify: Arc::new(Notify::new()),
            tx,
        };
        (queue, rx)
    }

    /// Subscribe a fresh receiver to the queue's broadcast channel.
    /// Used to attach additional consumers (e.g. Telegram daemon) after the
    /// queue is already running. Each receiver gets every event from the
    /// moment of subscription; previously emitted events are not replayed.
    pub fn subscribe(&self) -> broadcast::Receiver<QueueMessage> {
        self.tx.subscribe()
    }

    pub async fn enqueue(
        &self,
        prompt: String,
        cwd: String,
        args: Vec<String>,
    ) -> Result<(String, usize), sqlx::Error> {
        let id = uuid::Uuid::now_v7().to_string();
        let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "[]".into());
        let now = chrono::Utc::now().timestamp_millis();
        let rec = RunRecord {
            id: id.clone(),
            prompt,
            cwd,
            args_json,
            state: RunState::Queued,
            enqueued_at: now,
            started_at: None,
            ended_at: None,
            stop_reason: None,
            error: None,
        };
        self.db.insert_run(&rec).await?;

        let position;
        {
            let mut inner = self.inner.lock().await;
            inner.waiting.push_back(rec);
            position = if inner.active.is_none() {
                0
            } else {
                inner.waiting.len()
            };
        }

        let _ = self.tx.send(QueueMessage {
            run_id: id.clone(),
            kind: QueueMessageKind::QueueChanged,
        });
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
            self.db
                .update_state(
                    run_id,
                    RunState::Cancelled,
                    None,
                    Some(chrono::Utc::now().timestamp_millis()),
                    None,
                    Some("user cancelled".into()),
                )
                .await?;
            let _ = self.tx.send(QueueMessage {
                run_id: run_id.into(),
                kind: QueueMessageKind::QueueChanged,
            });
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
            self.db
                .update_state(
                    id,
                    RunState::Cancelled,
                    None,
                    Some(now),
                    None,
                    Some("queue cleared".into()),
                )
                .await?;
        }
        if !drained.is_empty() {
            let _ = self.tx.send(QueueMessage {
                run_id: drained[0].clone(),
                kind: QueueMessageKind::QueueChanged,
            });
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
        let _ = self
            .db
            .update_state(&rec.id, RunState::Running, Some(started_at), None, None, None)
            .await;
        // Emit QueueChanged BEFORE StateChanged so the frontend's queue.active
        // flips from None → Some(rec.id) before any text events arrive. The
        // QueueChanged that fires from enqueue() can race with pop_next() and
        // capture a stale active=None — emitting again here guarantees the
        // post-pop snapshot is the one the frontend ends up with.
        let _ = self.tx.send(QueueMessage {
            run_id: rec.id.clone(),
            kind: QueueMessageKind::QueueChanged,
        });
        let _ = self.tx.send(QueueMessage {
            run_id: rec.id.clone(),
            kind: QueueMessageKind::StateChanged {
                state: RunState::Running,
                started_at: Some(started_at),
                ended_at: None,
                error: None,
            },
        });

        let args: Vec<String> = serde_json::from_str(&rec.args_json).unwrap_or_default();
        let grok_path = self.inner.lock().await.grok_path.clone();
        let cwd = std::path::PathBuf::from(&rec.cwd);

        let spawn_result = process::spawn(&grok_path, &args, &cwd);
        match spawn_result {
            Err(e) => {
                self.finalize(&rec.id, RunState::Failed, Some(format!("spawn failed: {e}")))
                    .await;
            }
            Ok(mut spawned) => {
                {
                    let mut inner = self.inner.lock().await;
                    inner.active_pgid = Some(spawned.pgid);
                }
                // Drain stderr in a background task. Without this, when grok
                // produces > 64 KB of stderr (tracing logs, debug noise) the
                // pipe fills and grok BLOCKS on stderr write, which makes
                // stdout silent and trips our 60s "no output timeout" — even
                // though grok is alive and would have produced text just fine.
                if let Some(stderr) = spawned.child.stderr.take() {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    tokio::spawn(async move {
                        let mut reader = BufReader::new(stderr);
                        let mut line = String::new();
                        loop {
                            line.clear();
                            match reader.read_line(&mut line).await {
                                Ok(0) | Err(_) => break,
                                Ok(_) => {
                                    // Surface unfiltered stderr to the host
                                    // process — useful when diagnosing grok
                                    // misbehavior. Set
                                    // GROK_DESKTOP_QUIET_GROK_STDERR=1 to
                                    // suppress.
                                    if std::env::var("GROK_DESKTOP_QUIET_GROK_STDERR")
                                        .ok()
                                        .as_deref()
                                        != Some("1")
                                    {
                                        eprint!("[grok stderr] {line}");
                                    }
                                }
                            }
                        }
                    });
                }
                let mut reader = process::read_stdout_lines(&mut spawned.child);
                let mut line = String::new();
                let mut consecutive_fail = 0u32;

                // No-output timeout: how long we'll wait between stdout lines
                // before assuming grok is wedged. grok with `--effort medium`
                // can legitimately spend > 60s "thinking" before producing
                // the first NDJSON event, so the default has to be generous.
                // Tunable via env var so power users can tighten it.
                let no_output_secs: u64 = std::env::var("GROK_DESKTOP_NO_OUTPUT_TIMEOUT_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(240);
                loop {
                    line.clear();
                    let read_fut = reader.read_line(&mut line);
                    let outcome =
                        tokio::time::timeout(std::time::Duration::from_secs(no_output_secs), read_fut).await;
                    match outcome {
                        Err(_) => {
                            // N seconds no output and not exited
                            process::kill_group(spawned.pgid).await;
                            self.finalize(
                                &rec.id,
                                RunState::Failed,
                                Some(format!("no output timeout ({}s)", no_output_secs)),
                            )
                            .await;
                            return;
                        }
                        Ok(Ok(0)) => break,
                        Ok(Ok(_)) => {
                            let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                            if trimmed.is_empty() {
                                continue;
                            }
                            // Parse the line twice: once into the typed
                            // GrokEvent enum (for existing Thought/Text/End
                            // consumers), once as raw JSON Value (so the
                            // frontend can introspect tool/subagent events
                            // without us touching Rust for every new type).
                            let raw_value: serde_json::Value =
                                serde_json::from_str(&trimmed)
                                    .unwrap_or(serde_json::Value::Null);
                            match parse_line(&trimmed) {
                                Ok(ev) => {
                                    consecutive_fail = 0;
                                    let _ = self.tx.send(QueueMessage {
                                        run_id: rec.id.clone(),
                                        kind: QueueMessageKind::Event {
                                            event: ev,
                                            raw: raw_value,
                                        },
                                    });
                                }
                                Err(_) => {
                                    consecutive_fail += 1;
                                    if consecutive_fail > 5 {
                                        process::kill_group(spawned.pgid).await;
                                        self.finalize(
                                            &rec.id,
                                            RunState::Failed,
                                            Some("too many parse failures".into()),
                                        )
                                        .await;
                                        return;
                                    }
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            self.finalize(
                                &rec.id,
                                RunState::Failed,
                                Some(format!("stdout read error: {e}")),
                            )
                            .await;
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
                        Ok(_) => RunState::Failed,
                        Err(_) => RunState::Failed,
                    }
                };
                self.finalize(&rec.id, final_state, None).await;
            }
        }
    }

    pub fn notify_worker(&self) {
        self.notify.notify_one();
    }

    async fn finalize(&self, id: &str, state: RunState, error: Option<String>) {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = self
            .db
            .update_state(id, state, None, Some(now), None, error.clone())
            .await;
        {
            let mut inner = self.inner.lock().await;
            if inner.active.as_deref() == Some(id) {
                inner.active = None;
                inner.active_pgid = None;
            }
        }
        let _ = self.tx.send(QueueMessage {
            run_id: id.into(),
            kind: QueueMessageKind::StateChanged {
                state,
                started_at: None,
                ended_at: Some(now),
                error,
            },
        });
        let _ = self.tx.send(QueueMessage {
            run_id: id.into(),
            kind: QueueMessageKind::QueueChanged,
        });
        // Wake worker for next.
        self.notify.notify_one();
    }
}
