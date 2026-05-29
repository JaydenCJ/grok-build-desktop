//! Telegram bot command dispatcher.

use std::sync::Arc;

use teloxide::prelude::*;
use teloxide::types::ParseMode;
use teloxide::utils::command::BotCommands;

use crate::runs::queue::RunQueue;

use super::config::Config;
use super::stream::StreamerRegistry;

#[derive(BotCommands, Clone, Debug)]
#[command(
    rename_rule = "lowercase",
    description = "Grok Desktop remote commands"
)]
pub enum Command {
    #[command(description = "Display this help.")]
    Help,
    #[command(description = "Run Grok with the given prompt.")]
    Grok(String),
    #[command(description = "Show the run queue.")]
    Queue,
    #[command(description = "Cancel the active run (or pass a UUID prefix).")]
    Cancel(String),
    #[command(description = "Show bot + queue status.")]
    Status,
}

pub async fn run_dispatcher(
    bot: Bot,
    queue: Arc<RunQueue>,
    streamer: Arc<StreamerRegistry>,
    config: Arc<Config>,
) {
    let handler = Update::filter_message()
        // Slash commands (/grok /status /queue /cancel /help) first…
        .branch(
            dptree::entry()
                .filter_command::<Command>()
                .endpoint(handle_command),
        )
        // …then any other text message = a normal-language prompt. This lets
        // the user just chat with the bot without typing /grok every time.
        .branch(dptree::endpoint(handle_plain_message));

    Dispatcher::builder(bot, handler)
        .dependencies(dptree::deps![queue, streamer, config])
        .enable_ctrlc_handler()
        .build()
        .dispatch()
        .await;
}

/// Fallback for non-command messages: treat the raw text as a /grok prompt so
/// plain-language conversation "just works".
async fn handle_plain_message(
    bot: Bot,
    msg: Message,
    queue: Arc<RunQueue>,
    streamer: Arc<StreamerRegistry>,
    config: Arc<Config>,
) -> ResponseResult<()> {
    let chat_id = msg.chat.id.0;
    if !config.is_allowed(chat_id) {
        eprintln!("[grok-desktop] telegram: rejected message from unauthorized chat_id={chat_id}");
        bot.send_message(msg.chat.id, "🚫 Not authorized.").await?;
        return Ok(());
    }
    let text = msg.text().unwrap_or("").trim().to_string();
    // Ignore empty / non-text (stickers, photos) and stray slash input that
    // didn't parse as a known command.
    if text.is_empty() {
        return Ok(());
    }
    if text.starts_with('/') {
        bot.send_message(
            msg.chat.id,
            "Unknown command. Try /help, or just send a normal message to ask Grok.",
        )
        .await?;
        return Ok(());
    }
    handle_grok(bot, msg, text, queue, streamer, config).await
}

async fn handle_command(
    bot: Bot,
    msg: Message,
    cmd: Command,
    queue: Arc<RunQueue>,
    streamer: Arc<StreamerRegistry>,
    config: Arc<Config>,
) -> ResponseResult<()> {
    let chat_id = msg.chat.id.0;
    if !config.is_allowed(chat_id) {
        eprintln!(
            "[grok-desktop] telegram: rejected command from unauthorized chat_id={chat_id}"
        );
        bot.send_message(msg.chat.id, "🚫 Not authorized.")

            .await?;
        return Ok(());
    }

    match cmd {
        Command::Help => {
            bot.send_message(msg.chat.id, Command::descriptions().to_string())
                .await?;
        }
        Command::Grok(prompt) => handle_grok(bot, msg, prompt, queue, streamer, config).await?,
        Command::Queue => handle_queue(bot, msg, queue).await?,
        Command::Cancel(arg) => handle_cancel(bot, msg, arg, queue).await?,
        Command::Status => handle_status(bot, msg, queue, config).await?,
    }
    Ok(())
}

async fn handle_grok(
    bot: Bot,
    msg: Message,
    prompt: String,
    queue: Arc<RunQueue>,
    streamer: Arc<StreamerRegistry>,
    config: Arc<Config>,
) -> ResponseResult<()> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        bot.send_message(msg.chat.id, "Usage: /grok <prompt>")

            .await?;
        return Ok(());
    }

    let cwd = resolve_cwd(&config);
    // CRITICAL: the queue spawns grok with exactly these args — it does NOT
    // append the prompt itself (the desktop UI pushes `-p` before enqueue).
    // Without `-p <prompt>` grok runs with no task, blocks on stdin (null),
    // and exits code 1. So append the prompt here.
    let mut args = default_grok_args();
    args.push("-p".to_string());
    args.push(prompt.clone());

    let placeholder = bot
        .send_message(msg.chat.id, "🤖 enqueuing…")

        .await?;

    match queue.enqueue(prompt, cwd, args).await {
        Ok((run_id, position)) => {
            streamer
                .register(run_id.clone(), placeholder.chat.id, placeholder.id)
                .await;
            let init = if position == 0 {
                "🤖 running…".to_string()
            } else {
                format!("🕒 queued at position {position}")
            };
            bot.edit_message_text(placeholder.chat.id, placeholder.id, init)
                .await?;
            eprintln!("[grok-desktop] telegram: enqueued run {run_id} (pos {position})");
        }
        Err(err) => {
            bot.edit_message_text(
                placeholder.chat.id,
                placeholder.id,
                format!("✗ failed to enqueue: {err}"),
            )
            .await?;
        }
    }
    Ok(())
}

async fn handle_queue(bot: Bot, msg: Message, queue: Arc<RunQueue>) -> ResponseResult<()> {
    let (active, waiting) = queue.snapshot().await;
    let lines: Vec<String> = waiting
        .iter()
        .enumerate()
        .map(|(i, r)| format!("{}. {}", i + 1, truncate(&r.prompt, 60)))
        .collect();
    let body = match (active, lines.is_empty()) {
        (None, true) => "queue empty".to_string(),
        (Some(id), true) => format!("▶ running: {}\n(no queued tasks)", short_id(&id)),
        (None, false) => format!("⏸ no active\n{}", lines.join("\n")),
        (Some(id), false) => format!("▶ running: {}\n{}", short_id(&id), lines.join("\n")),
    };
    bot.send_message(msg.chat.id, body)

        .await?;
    Ok(())
}

async fn handle_cancel(
    bot: Bot,
    msg: Message,
    arg: String,
    queue: Arc<RunQueue>,
) -> ResponseResult<()> {
    let arg = arg.trim();
    let target = if arg.is_empty() {
        // Cancel active.
        match queue.snapshot().await.0 {
            Some(id) => id,
            None => {
                bot.send_message(msg.chat.id, "nothing active to cancel")

                    .await?;
                return Ok(());
            }
        }
    } else {
        // Resolve prefix match across active + queued.
        let (active, queued) = queue.snapshot().await;
        let mut candidates: Vec<String> = queued.iter().map(|r| r.id.clone()).collect();
        if let Some(id) = active {
            candidates.push(id);
        }
        let matches: Vec<String> = candidates
            .into_iter()
            .filter(|id| id.starts_with(arg))
            .collect();
        match matches.len() {
            0 => {
                bot.send_message(msg.chat.id, format!("no run matching '{arg}'"))

                    .await?;
                return Ok(());
            }
            1 => matches.into_iter().next().unwrap(),
            n => {
                bot.send_message(
                    msg.chat.id,
                    format!("ambiguous: {n} runs match '{arg}', please give more chars"),
                )

                .await?;
                return Ok(());
            }
        }
    };

    match queue.cancel(&target).await {
        Ok(true) => {
            bot.send_message(msg.chat.id, format!("⛔ cancelled {}", short_id(&target)))

                .await?;
        }
        Ok(false) => {
            bot.send_message(msg.chat.id, "run not found (already finished?)")

                .await?;
        }
        Err(err) => {
            bot.send_message(msg.chat.id, format!("cancel error: {err}"))

                .await?;
        }
    }
    Ok(())
}

async fn handle_status(
    bot: Bot,
    msg: Message,
    queue: Arc<RunQueue>,
    config: Arc<Config>,
) -> ResponseResult<()> {
    let (active, waiting) = queue.snapshot().await;
    let body = format!(
        "Grok Desktop bot online\n\
         Authorized chats: {}\n\
         Active run: {}\n\
         Queue depth: {}\n\
         Default cwd: {}",
        config.allowed_chat_ids.len(),
        active.as_deref().map(short_id).unwrap_or_else(|| "none".into()),
        waiting.len(),
        config
            .default_cwd
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(session_state coding_cwd or $HOME)".to_string()),
    );
    bot.send_message(msg.chat.id, body)

        .parse_mode(ParseMode::Html)
        .await?;
    Ok(())
}

fn default_grok_args() -> Vec<String> {
    vec![
        "--no-alt-screen".into(),
        "--output-format".into(),
        "streaming-json".into(),
        "--model".into(),
        "grok-build".into(),
        "--effort".into(),
        "medium".into(),
        // Same system-level guidance the desktop UI sends via --rules, so remote
        // (Telegram) runs behave like the app — without bloating the user turn.
        "--rules".into(),
        GROK_SENIOR_RULES.into(),
        "--no-subagents".into(),
        "--disable-web-search".into(),
        "--max-turns".into(),
        "12".into(),
    ]
}

/// Durable senior-engineer guidance appended to grok-build's system prompt
/// (mirrors the desktop UI's buildGrokRules). Kept tight — grok-build already
/// has a strong coding prompt.
const GROK_SENIOR_RULES: &str = "Operate as a senior engineer: high signal, minimal ceremony.\nBefore editing, quickly map the repo — entry points, likely files, build/test commands, risk boundaries.\nPrefer exact file paths, exact commands, and concrete diffs over prose.\nKeep edits narrow and make verification easy: give one command to verify each change.\nIf the request is ambiguous, make the safest useful assumption and state it in one line.";

fn resolve_cwd(config: &Config) -> String {
    if let Some(p) = &config.default_cwd {
        return p.display().to_string();
    }
    // Fallback: try session_state.json
    if let Ok(home) = std::env::var("HOME") {
        let session = std::path::PathBuf::from(&home)
            .join("Library/Application Support/Grok Desktop/session_state.json");
        if let Ok(content) = std::fs::read_to_string(&session) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(cwd) = v.get("coding_cwd").and_then(|c| c.as_str()) {
                    if !cwd.trim().is_empty() {
                        return cwd.to_string();
                    }
                }
            }
        }
        return home;
    }
    "/".into()
}

fn short_id(id: &str) -> String {
    if id.len() > 8 {
        id[..8].to_string()
    } else {
        id.to_string()
    }
}

fn truncate(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        out.push('…');
    }
    out
}
