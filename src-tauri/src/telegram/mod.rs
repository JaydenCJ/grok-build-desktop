//! Telegram remote control daemon.
//!
//! Boots only when `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_CHAT_IDS` are set
//! in the process environment (typically via `.env` loaded by `dotenvy`).
//!
//! When active, the daemon:
//! - long-polls Telegram for messages
//! - dispatches `/grok`, `/queue`, `/cancel`, `/status`, `/help` commands
//! - subscribes to the RunQueue broadcast and edits the originating Telegram
//!   message with the streaming output (1 Hz cadence by default).

pub mod commands;
pub mod config;
pub mod stream;

use std::sync::Arc;

use crate::runs::queue::{QueueMessage, RunQueue};
use config::Config;
use teloxide::prelude::*;
use tokio::sync::broadcast;

/// Spawn the Telegram daemon if configured. No-op when env vars are missing.
///
/// Returns immediately; the daemon runs as a detached tokio task.
pub fn spawn_daemon(queue: Arc<RunQueue>, mut rx: broadcast::Receiver<QueueMessage>) {
    let config = match Config::from_env() {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            eprintln!("[grok-desktop] telegram: TELEGRAM_BOT_TOKEN not set, daemon disabled");
            return;
        }
        Err(err) => {
            eprintln!("[grok-desktop] telegram: invalid config, daemon disabled: {err}");
            return;
        }
    };

    let bot = Bot::new(config.bot_token.clone());
    let streamer = Arc::new(stream::StreamerRegistry::new(bot.clone()));

    // Subscribe to RunQueue broadcast → push events into streamers.
    {
        let streamer = streamer.clone();
        tauri::async_runtime::spawn(async move {
            use tokio::sync::broadcast::error::RecvError;
            loop {
                match rx.recv().await {
                    Ok(msg) => streamer.dispatch(&msg).await,
                    Err(RecvError::Lagged(n)) => {
                        eprintln!("[grok-desktop] telegram streamer lagged, dropped {n} events");
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        });
    }

    // Run the command dispatcher.
    tauri::async_runtime::spawn(async move {
        eprintln!(
            "[grok-desktop] telegram: daemon online, {} chat(s) allowlisted",
            config.allowed_chat_ids.len()
        );
        commands::run_dispatcher(bot, queue, streamer, Arc::new(config)).await;
    });
}
