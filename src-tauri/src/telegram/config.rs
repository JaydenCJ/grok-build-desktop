use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub bot_token: String,
    pub allowed_chat_ids: HashSet<i64>,
    pub default_cwd: Option<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("TELEGRAM_ALLOWED_CHAT_IDS is required when TELEGRAM_BOT_TOKEN is set (refuse to operate publicly)")]
    AllowlistRequired,
    #[error("TELEGRAM_ALLOWED_CHAT_IDS contained no valid i64 chat IDs")]
    AllowlistEmpty,
    #[error("TELEGRAM_ALLOWED_CHAT_IDS entry '{0}' is not a valid i64")]
    BadChatId(String),
}

impl Config {
    /// Load from process env. Returns:
    /// - `Ok(None)` if `TELEGRAM_BOT_TOKEN` is unset (daemon should not start).
    /// - `Ok(Some(cfg))` if everything parses.
    /// - `Err(_)` if token is set but allowlist is missing/invalid.
    pub fn from_env() -> Result<Option<Self>, ConfigError> {
        // Load .env from stable locations FIRST, because the installed .app is
        // launched with cwd "/" (so a cwd-relative `dotenvy::dotenv()` alone
        // never finds the project's .env). Order: ~/.grok-desktop/.env, then
        // ~/Library/Application Support/Grok Desktop/.env, then cwd fallback
        // (covers `tauri dev`, where cwd is the project root). `from_path`
        // does not override vars already set, so the first hit wins.
        if let Ok(home) = std::env::var("HOME") {
            let candidates = [
                PathBuf::from(&home).join(".grok-desktop/.env"),
                PathBuf::from(&home)
                    .join("Library/Application Support/Grok Desktop/.env"),
            ];
            for path in candidates {
                if path.is_file() {
                    let _ = dotenvy::from_path(&path);
                }
            }
        }
        // Best-effort cwd .env load (dev mode). Ignore errors.
        let _ = dotenvy::dotenv();

        let bot_token = match std::env::var("TELEGRAM_BOT_TOKEN") {
            Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => return Ok(None),
        };

        let allowlist_raw = std::env::var("TELEGRAM_ALLOWED_CHAT_IDS")
            .map_err(|_| ConfigError::AllowlistRequired)?;
        let allowed_chat_ids = parse_allowlist(&allowlist_raw)?;
        if allowed_chat_ids.is_empty() {
            return Err(ConfigError::AllowlistEmpty);
        }

        let default_cwd = std::env::var("TELEGRAM_DEFAULT_CWD")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from);

        Ok(Some(Self {
            bot_token,
            allowed_chat_ids,
            default_cwd,
        }))
    }

    pub fn is_allowed(&self, chat_id: i64) -> bool {
        self.allowed_chat_ids.contains(&chat_id)
    }
}

fn parse_allowlist(raw: &str) -> Result<HashSet<i64>, ConfigError> {
    let mut out = HashSet::new();
    for entry in raw.split(',') {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            continue;
        }
        let id: i64 = trimmed
            .parse()
            .map_err(|_| ConfigError::BadChatId(trimmed.to_string()))?;
        out.insert(id);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_id() {
        let r = parse_allowlist("12345").unwrap();
        assert!(r.contains(&12345));
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn parses_multiple_with_whitespace() {
        let r = parse_allowlist(" 1 , 2,3 , -4 ").unwrap();
        assert_eq!(r.len(), 4);
        assert!(r.contains(&-4));
    }

    #[test]
    fn rejects_garbage() {
        let err = parse_allowlist("12,abc,34").unwrap_err();
        assert!(matches!(err, ConfigError::BadChatId(s) if s == "abc"));
    }

    #[test]
    fn empty_string_returns_empty_set() {
        let r = parse_allowlist("").unwrap();
        assert!(r.is_empty());
    }
}
