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
/// (the Tauri event forwarder and any future subscribers). Large enough to
/// absorb a burst of streaming-json events without lag.
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
    /// Used to attach additional consumers after the
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
            // Number of runs ahead of the new one: everything already waiting
            // (e.g. recovered-but-not-resumed Queued rows after a restart)
            // plus the active run if any. The old `active.is_none() → 0`
            // branch reported "runs next" even with recovered runs in front.
            position = inner.waiting.len() - 1 + usize::from(inner.active.is_some());
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
        // If in waiting queue: remove. (No `cancelled` mark needed — once out
        // of `waiting` the worker can never pop it, and stale marks would
        // grow the set for the process lifetime.)
        if let Some(pos) = inner.waiting.iter().position(|r| r.id == run_id) {
            inner.waiting.remove(pos);
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
        (
            inner.active.clone(),
            inner.waiting.iter().cloned().collect(),
        )
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
                    me.run_one(rec).await;
                }
            }
        });
    }

    /// Pop the next runnable record, doing the cancelled check UNDER the same
    /// lock that publishes `active`. A cancel that lands between pop and spawn
    /// used to leave the run neither killed nor finalized: `active` pointed at
    /// a skipped run forever and the DB row stayed Queued, resurrecting the
    /// cancelled run on the next launch. Skipped runs are finalized as
    /// Cancelled here instead.
    async fn pop_next(&self) -> Option<RunRecord> {
        loop {
            let skipped_id;
            {
                let mut inner = self.inner.lock().await;
                let rec = inner.waiting.pop_front()?;
                if inner.cancelled.remove(&rec.id) {
                    skipped_id = rec.id;
                } else {
                    inner.active = Some(rec.id.clone());
                    return Some(rec);
                }
            }
            self.finalize(
                &skipped_id,
                RunState::Cancelled,
                Some("user cancelled".into()),
            )
            .await;
        }
    }

    async fn run_one(&self, rec: RunRecord) {
        let started_at = chrono::Utc::now().timestamp_millis();
        let _ = self
            .db
            .update_state(
                &rec.id,
                RunState::Running,
                Some(started_at),
                None,
                None,
                None,
            )
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
                self.finalize(
                    &rec.id,
                    RunState::Failed,
                    Some(format!("spawn failed: {e}")),
                )
                .await;
            }
            Ok(mut spawned) => {
                let cancel_requested = {
                    let mut inner = self.inner.lock().await;
                    inner.active_pgid = Some(spawned.pgid);
                    // A cancel may have landed between pop and spawn — its
                    // `active_pgid` read saw None, so nothing was killed.
                    // Honor it now that the pgid exists.
                    inner.cancelled.contains(&rec.id)
                };
                if cancel_requested {
                    process::kill_group(spawned.pgid).await;
                }
                // Drain stderr in a background task. Without this, when grok
                // produces > 64 KB of stderr (tracing logs, debug noise) the
                // pipe fills and grok BLOCKS on stderr write, which makes
                // stdout silent and trips our 60s "no output timeout" — even
                // though grok is alive and would have produced text just fine.
                // Keep the tail of stderr so a non-zero exit can report grok's
                // ACTUAL error (e.g. "invalid reasoning effort: max") instead of
                // a useless generic "likely a crash".
                let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
                if let Some(stderr) = spawned.child.stderr.take() {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let tail = stderr_tail.clone();
                    tokio::spawn(async move {
                        let mut reader = BufReader::new(stderr);
                        let mut line = String::new();
                        loop {
                            line.clear();
                            match reader.read_line(&mut line).await {
                                Ok(0) | Err(_) => break,
                                Ok(_) => {
                                    if let Ok(mut t) = tail.lock() {
                                        t.push_str(&line);
                                        if t.len() > 4096 {
                                            *t = t[t.len() - 4096..].to_string();
                                        }
                                    }
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
                let mut reader = match process::read_stdout_lines(&mut spawned.child) {
                    Ok(reader) => reader,
                    Err(e) => {
                        process::kill_group(spawned.pgid).await;
                        self.finalize(
                            &rec.id,
                            RunState::Failed,
                            Some(format!("stdout unavailable: {e}")),
                        )
                        .await;
                        return;
                    }
                };
                let mut line = String::new();
                let mut consecutive_fail = 0u32;

                // No-output timeout: how long we'll wait between stdout lines
                // before assuming grok is wedged. The timer resets on EVERY
                // line, so a grok that's actively thinking (streaming-json emits
                // `thought` events continuously) never trips it. It only fires
                // when grok is TRULY silent — e.g. blocked on a macOS permission
                // prompt, or wedged. `--effort max` + plan mode can stay silent
                // a while before the first event, so the default is generous.
                // Tunable via env var so power users can tighten it.
                let no_output_secs: u64 = std::env::var("GROK_DESKTOP_NO_OUTPUT_TIMEOUT_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(420);
                loop {
                    line.clear();
                    let read_fut = reader.read_line(&mut line);
                    let outcome = tokio::time::timeout(
                        std::time::Duration::from_secs(no_output_secs),
                        read_fut,
                    )
                    .await;
                    match outcome {
                        Err(_) => {
                            // N seconds with zero output and not exited → wedged.
                            // Usually a macOS permission prompt waiting offscreen
                            // (grant/deny it), or genuinely stuck. Make the error
                            // actionable instead of a bare "timeout".
                            process::kill_group(spawned.pgid).await;
                            self.finalize(
                                &rec.id,
                                RunState::Failed,
                                Some(format!(
                                    "no output for {no_output_secs}s — grok went silent. \
                                     Check for a macOS permission prompt, or lower Effort/Reasoning.",
                                )),
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
                                serde_json::from_str(&trimmed).unwrap_or(serde_json::Value::Null);
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
                // Wait exit — bounded. Every other stall path has a watchdog;
                // without one here a grok that closes stdout but never exits
                // would leave the run Running forever and wedge the queue.
                let mut forced_exit = false;
                let status = match tokio::time::timeout(
                    std::time::Duration::from_secs(30),
                    spawned.child.wait(),
                )
                .await
                {
                    Ok(status) => status,
                    Err(_) => {
                        forced_exit = true;
                        process::kill_group(spawned.pgid).await;
                        // kill_group escalates TERM→KILL, so this reap returns
                        // promptly.
                        spawned.child.wait().await
                    }
                };
                let cancelled = self.inner.lock().await.cancelled.contains(&rec.id);
                let (final_state, fail_err) = if cancelled {
                    (RunState::Cancelled, None)
                } else {
                    match status {
                        Ok(s) if s.success() => (RunState::Done, None),
                        Ok(_) if forced_exit => (
                            RunState::Failed,
                            Some(
                                "grok did not exit after closing its output stream; terminated"
                                    .to_string(),
                            ),
                        ),
                        // grok exited non-zero. Surface the code/signal so the
                        // failure isn't a bare "error" — grok 0.2.x sometimes
                        // crashes mid-run, and a clear message tells the user
                        // it's the CLI (and that retrying usually works).
                        Ok(s) => {
                            // Pull grok's real error off the stderr tail (last
                            // non-empty line) so the message is actionable.
                            let detail = stderr_tail
                                .lock()
                                .ok()
                                .and_then(|t| {
                                    // Prefer clap's "error: …" line; else the last
                                    // meaningful (non-Usage) line.
                                    t.lines()
                                        .map(str::trim)
                                        .find(|l| l.starts_with("error:"))
                                        .map(str::to_string)
                                        .or_else(|| {
                                            t.lines()
                                                .rev()
                                                .map(str::trim)
                                                .find(|l| {
                                                    !l.is_empty()
                                                        && !l.starts_with("For more information")
                                                        && !l.starts_with("Usage:")
                                                })
                                                .map(str::to_string)
                                        })
                                })
                                .map(|l| format!(" — {l}"))
                                .unwrap_or_else(|| {
                                    " — likely a grok CLI crash, try again".to_string()
                                });
                            let msg = match s.code() {
                                Some(c) => format!("grok exited with code {c}{detail}"),
                                None => format!("grok was terminated by a signal{detail}"),
                            };
                            (RunState::Failed, Some(msg))
                        }
                        Err(e) => (
                            RunState::Failed,
                            Some(format!("could not wait on grok: {e}")),
                        ),
                    }
                };
                self.finalize(&rec.id, final_state, fail_err).await;
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
            // Prune the cancel mark so the set doesn't grow for the process
            // lifetime (and a recycled id could never be mis-skipped).
            inner.cancelled.remove(id);
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
