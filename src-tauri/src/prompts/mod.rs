//! Prompt library — SQLite-backed reusable prompt templates.
//! Stored next to runs.sqlite in the app data dir.

use crate::runs::db::run_schema;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    /// Short label shown in the sidebar list.
    pub name: String,
    /// Optional category/folder.
    pub category: Option<String>,
    /// Full prompt body inserted into the composer.
    pub body: String,
    /// ms since epoch of the last edit.
    pub updated_at: i64,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct PromptStore {
    pool: SqlitePool,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts(updated_at DESC);
"#;

impl PromptStore {
    pub async fn open_at(path: &Path) -> Result<Self, sqlx::Error> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Delete)
            .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await?;
        run_schema(&pool, SCHEMA).await?;
        Ok(Self { pool })
    }

    pub async fn open_memory() -> Result<Self, sqlx::Error> {
        use std::str::FromStr;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:")?)
            .await?;
        run_schema(&pool, SCHEMA).await?;
        Ok(Self { pool })
    }

    pub async fn list(&self) -> Result<Vec<Prompt>, sqlx::Error> {
        let rows: Vec<(String, String, Option<String>, String, i64, i64)> = sqlx::query_as(
            "SELECT id, name, category, body, created_at, updated_at
             FROM prompts ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, category, body, created_at, updated_at)| Prompt {
                id,
                name,
                category,
                body,
                created_at,
                updated_at,
            })
            .collect())
    }

    pub async fn upsert(&self, prompt: &Prompt) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO prompts (id, name, category, body, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               category = excluded.category,
               body = excluded.body,
               updated_at = excluded.updated_at",
        )
        .bind(&prompt.id)
        .bind(&prompt.name)
        .bind(&prompt.category)
        .bind(&prompt.body)
        .bind(prompt.created_at)
        .bind(prompt.updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM prompts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(name: &str, body: &str) -> Prompt {
        let now = chrono::Utc::now().timestamp_millis();
        Prompt {
            id: uuid::Uuid::now_v7().to_string(),
            name: name.into(),
            category: None,
            body: body.into(),
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn empty_store_lists_empty() {
        let store = PromptStore::open_memory().await.unwrap();
        assert!(store.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn upsert_then_list_returns_in_recency_order() {
        let store = PromptStore::open_memory().await.unwrap();
        let a = p("first", "do A");
        store.upsert(&a).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        let mut b = p("second", "do B");
        b.updated_at = chrono::Utc::now().timestamp_millis();
        store.upsert(&b).await.unwrap();

        let list = store.list().await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "second");
        assert_eq!(list[1].name, "first");
    }

    #[tokio::test]
    async fn upsert_overwrites_existing() {
        let store = PromptStore::open_memory().await.unwrap();
        let mut a = p("name1", "body1");
        store.upsert(&a).await.unwrap();
        a.name = "renamed".into();
        a.body = "body2".into();
        a.updated_at = chrono::Utc::now().timestamp_millis();
        store.upsert(&a).await.unwrap();

        let list = store.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "renamed");
        assert_eq!(list[0].body, "body2");
    }

    #[tokio::test]
    async fn delete_removes_entry() {
        let store = PromptStore::open_memory().await.unwrap();
        let a = p("x", "y");
        store.upsert(&a).await.unwrap();
        assert!(store.delete(&a.id).await.unwrap());
        assert!(store.list().await.unwrap().is_empty());
        // Idempotent: second delete returns false.
        assert!(!store.delete(&a.id).await.unwrap());
    }
}
