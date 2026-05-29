//! Per-run streaming state — accumulates `text` events and edits the originating
//! Telegram message at most once per second (Telegram's recommended cadence for
//! edits to the same message).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use teloxide::prelude::*;
use teloxide::types::{ChatId, MessageId, ParseMode};
use tokio::sync::Mutex;

use crate::runs::db::RunState;
use crate::runs::event::GrokEvent;
use crate::runs::queue::{QueueMessage, QueueMessageKind};

/// Telegram message body cap. Real limit is 4096; leave headroom for the
/// status footer we append on each edit.
const MAX_BODY_CHARS: usize = 3500;
/// Minimum interval between successive edits to the same message.
const MIN_EDIT_INTERVAL: Duration = Duration::from_millis(1000);
/// Minimum text-growth before we bother editing (avoids no-op edits).
const MIN_EDIT_DELTA: usize = 20;

#[derive(Debug)]
struct StreamerState {
    chat_id: ChatId,
    message_id: MessageId,
    /// Full accumulated text body (may exceed MAX_BODY_CHARS — we slice on edit).
    accumulated: String,
    last_edit_at: Instant,
    last_edit_len: usize,
    final_state: Option<RunState>,
    stop_reason: Option<String>,
    error: Option<String>,
    thought_started_at: Option<Instant>,
}

impl StreamerState {
    fn new(chat_id: ChatId, message_id: MessageId) -> Self {
        Self {
            chat_id,
            message_id,
            accumulated: String::new(),
            last_edit_at: Instant::now() - MIN_EDIT_INTERVAL * 2,
            last_edit_len: 0,
            final_state: None,
            stop_reason: None,
            error: None,
            thought_started_at: None,
        }
    }

    fn should_edit_now(&self) -> bool {
        let grew_enough = self.accumulated.len().saturating_sub(self.last_edit_len) >= MIN_EDIT_DELTA;
        let elapsed = self.last_edit_at.elapsed() >= MIN_EDIT_INTERVAL;
        grew_enough && elapsed
    }
}

pub struct StreamerRegistry {
    bot: Bot,
    by_run: Mutex<HashMap<String, StreamerState>>,
}

impl StreamerRegistry {
    pub fn new(bot: Bot) -> Self {
        Self {
            bot,
            by_run: Mutex::new(HashMap::new()),
        }
    }

    /// Register a fresh run started via `/grok`. The originating Telegram
    /// message will be edited as text streams in.
    pub async fn register(&self, run_id: String, chat_id: ChatId, message_id: MessageId) {
        let mut by_run = self.by_run.lock().await;
        by_run.insert(run_id, StreamerState::new(chat_id, message_id));
    }

    /// Forget a run that the user cancelled before it streamed anything.
    pub async fn forget(&self, run_id: &str) {
        self.by_run.lock().await.remove(run_id);
    }

    /// Apply one QueueMessage. No-op if the run isn't tracked (was started
    /// from the desktop UI, not the bot).
    pub async fn dispatch(self: &Arc<Self>, msg: &QueueMessage) {
        let mut by_run = self.by_run.lock().await;
        let Some(state) = by_run.get_mut(&msg.run_id) else {
            return;
        };

        match &msg.kind {
            QueueMessageKind::Event { event, raw: _ } => match event {
                GrokEvent::Thought { .. } => {
                    if state.thought_started_at.is_none() {
                        state.thought_started_at = Some(Instant::now());
                    }
                    // Don't accumulate thoughts; they'd dominate the message body.
                    // The status footer reflects "thinking…" while waiting for text.
                }
                GrokEvent::Text { data } => {
                    state.accumulated.push_str(data);
                    if state.should_edit_now() {
                        let payload = state.render_body();
                        let chat_id = state.chat_id;
                        let message_id = state.message_id;
                        let now = Instant::now();
                        state.last_edit_at = now;
                        state.last_edit_len = state.accumulated.len();
                        // Drop the lock before awaiting the network call.
                        drop(by_run);
                        let _ = self
                            .bot
                            .edit_message_text(chat_id, message_id, payload)
                            .parse_mode(ParseMode::Html)
                            .await;
                        return;
                    }
                }
                GrokEvent::End { stop_reason, .. } => {
                    state.stop_reason = Some(stop_reason.clone());
                }
                GrokEvent::Unknown => {}
            },
            QueueMessageKind::StateChanged { state: rs, error, .. } => {
                state.final_state = Some(*rs);
                if let Some(e) = error {
                    state.error = Some(e.clone());
                }
                let is_terminal = matches!(
                    rs,
                    RunState::Done | RunState::Cancelled | RunState::Failed
                );
                if is_terminal {
                    // Force the final edit regardless of timer.
                    let payload = state.render_body();
                    let chat_id = state.chat_id;
                    let message_id = state.message_id;
                    let run_id = msg.run_id.clone();
                    drop(by_run);
                    let _ = self
                        .bot
                        .edit_message_text(chat_id, message_id, payload)
                        .parse_mode(ParseMode::Html)
                        .await;
                    // Stop tracking — no more events will come for this run.
                    self.by_run.lock().await.remove(&run_id);
                    return;
                }
            }
            QueueMessageKind::QueueChanged => {
                // Ignore — queue snapshots don't change message body.
            }
        }
    }
}

impl StreamerState {
    /// Produce the message body to push to Telegram. HTML-escaped + footer.
    fn render_body(&self) -> String {
        // Body: tail of accumulated text, escaped.
        let body_slice: &str = if self.accumulated.len() > MAX_BODY_CHARS {
            // Take the *tail* — the most recent content is usually what matters.
            let start = self.accumulated.len() - MAX_BODY_CHARS;
            // Avoid splitting mid-UTF8 codepoint.
            let mut s = start;
            while s < self.accumulated.len() && !self.accumulated.is_char_boundary(s) {
                s += 1;
            }
            &self.accumulated[s..]
        } else {
            &self.accumulated
        };
        let escaped = escape_html(body_slice);
        let truncated_marker = if self.accumulated.len() > MAX_BODY_CHARS {
            "…(showing tail)\n\n"
        } else {
            ""
        };

        // Natural chat reply: plain text, no <pre> code-block (which Telegram
        // renders with a "copy" button), no "✓ done · EndTurn" footer. Just
        // the message — like talking to a person.
        match self.final_state {
            // Finished → the clean reply, nothing else.
            Some(RunState::Done) => {
                if escaped.is_empty() {
                    "🤖 (no output)".to_string()
                } else {
                    format!("{truncated_marker}{escaped}")
                }
            }
            Some(RunState::Failed) => {
                let err = self.error.as_deref().unwrap_or("run failed");
                if escaped.is_empty() {
                    format!("⚠️ {err}")
                } else {
                    format!("{truncated_marker}{escaped}\n\n⚠️ {err}")
                }
            }
            Some(RunState::Cancelled) => {
                if escaped.is_empty() {
                    "⛔ cancelled".to_string()
                } else {
                    format!("{truncated_marker}{escaped}\n\n⛔ cancelled")
                }
            }
            // Still streaming → plain text with a tiny typing caret, or a
            // status line while there's no text yet.
            _ => {
                if escaped.is_empty() {
                    self.render_footer()
                } else {
                    format!("{truncated_marker}{escaped} ▍")
                }
            }
        }
    }

    fn render_footer(&self) -> String {
        match self.final_state {
            Some(RunState::Done) => {
                let reason = self.stop_reason.as_deref().unwrap_or("done");
                format!("✓ done · {reason}")
            }
            Some(RunState::Cancelled) => "⛔ cancelled".to_string(),
            Some(RunState::Failed) => {
                let err = self.error.as_deref().unwrap_or("error");
                format!("✗ failed: {err}")
            }
            Some(RunState::Queued) | Some(RunState::Running) | None => {
                if self.accumulated.is_empty() {
                    if self.thought_started_at.is_some() {
                        "🤔 thinking…".to_string()
                    } else {
                        "🤖 running…".to_string()
                    }
                } else {
                    "✍️ writing…".to_string()
                }
            }
        }
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use teloxide::types::ChatId;

    fn state(text: &str) -> StreamerState {
        let mut s = StreamerState::new(ChatId(1), MessageId(1));
        s.accumulated = text.to_string();
        s
    }

    #[test]
    fn should_edit_requires_both_time_and_delta() {
        let mut s = state("");
        // Fresh state: no growth yet → no edit.
        assert!(!s.should_edit_now());

        s.accumulated = "x".repeat(50);
        // Enough growth, but last_edit_at is "Instant::now() - 2 * MIN_EDIT_INTERVAL"
        // initialized in `new`, so elapsed should satisfy MIN_EDIT_INTERVAL.
        assert!(s.should_edit_now());

        // Reset edit timestamp to "just now" → should not edit despite growth.
        s.last_edit_at = Instant::now();
        s.last_edit_len = 50;
        s.accumulated.push_str(&"y".repeat(100));
        assert!(!s.should_edit_now());
    }

    #[test]
    fn render_body_falls_back_to_running_when_no_text() {
        let s = state("");
        let body = s.render_body();
        assert!(body.contains("running…") || body.contains("thinking…"));
    }

    #[test]
    fn render_body_escapes_html() {
        let s = state("<script>alert(1)</script>");
        let body = s.render_body();
        assert!(body.contains("&lt;script&gt;"));
        assert!(!body.contains("<script>alert"));
    }

    #[test]
    fn render_body_truncates_long_text_to_tail() {
        let mut s = state(&"a".repeat(5000));
        s.last_edit_len = 5000;
        let body = s.render_body();
        assert!(body.contains("showing tail"));
        // The tail is the last 3500 chars + footer + tags, total around 3600.
        assert!(body.len() < 4096, "body must fit Telegram cap, got {}", body.len());
    }
}
