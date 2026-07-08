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

/// Execute every `;`-delimited DDL statement in `schema` against the given
/// pool. sqlx::query() prepares a single statement at a time, so the CREATE
/// INDEX bodies in a multi-line SCHEMA string would silently be ignored if
/// passed to a single query(). This helper avoids that footgun. Shared with
/// the prompt-library store (prompts/mod.rs), which bootstraps the same way.
pub(crate) async fn run_schema(pool: &SqlitePool, schema: &str) -> Result<(), sqlx::Error> {
    for stmt in schema.split(';') {
        let trimmed = stmt.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(pool).await?;
        }
    }
    Ok(())
}

impl Db {
    pub async fn open_memory() -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:")?)
            .await?;
        run_schema(&pool, SCHEMA).await?;
        Ok(Self { pool })
    }

    pub async fn open_at(path: &Path) -> Result<Self, sqlx::Error> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            // Force WAL off and single-conn so DDL definitely persists to the
            // file. Without this, sqlx-pooled connections + the lazy CREATE
            // sequence can leave a 0-byte file on first run.
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Delete)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        run_schema(&pool, SCHEMA).await?;
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
