use crate::error::AppResult;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub emotion: Option<String>,
    pub ts: i64,
    pub session_id: String,
}

pub struct MemoryStore {
    conn: Mutex<Connection>,
    pub session_id: String,
}

impl MemoryStore {
    pub fn open(db_path: PathBuf, session_id: String) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&db_path)?;
        let store = MemoryStore {
            conn: Mutex::new(conn),
            session_id,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                emotion TEXT,
                ts INTEGER NOT NULL,
                session_id TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session_ts
                ON messages(session_id, ts);

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                importance REAL DEFAULT 0.5,
                embedding BLOB,
                created_at INTEGER NOT NULL,
                last_recall INTEGER,
                recall_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                raw TEXT NOT NULL,
                summary TEXT,
                ts INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS soul_evolution (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                field_path TEXT NOT NULL,
                delta TEXT NOT NULL,
                reason TEXT,
                applied_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    pub fn append_message(
        &self,
        role: &str,
        content: &str,
        emotion: Option<&str>,
    ) -> AppResult<i64> {
        let ts = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (role, content, emotion, ts, session_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![role, content, emotion, ts, self.session_id],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn recent_messages(&self, limit: usize) -> AppResult<Vec<StoredMessage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, role, content, emotion, ts, session_id
               FROM messages
              ORDER BY ts DESC
              LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                emotion: row.get(3)?,
                ts: row.get(4)?,
                session_id: row.get(5)?,
            })
        })?;
        let mut msgs: Vec<StoredMessage> = rows.collect::<Result<_, _>>()?;
        msgs.reverse(); // 时间正序返回前端
        Ok(msgs)
    }

    pub fn append_observation(
        &self,
        source: &str,
        raw: &str,
        summary: Option<&str>,
    ) -> AppResult<i64> {
        let ts = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO observations (source, raw, summary, ts) VALUES (?1, ?2, ?3, ?4)",
            params![source, raw, summary, ts],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

/// 默认数据库位置：
/// macOS: ~/Library/Application Support/TiaLynn/memory.db
/// Linux: ~/.local/share/TiaLynn/memory.db
/// Windows: %APPDATA%/TiaLynn/memory.db
pub fn default_db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TiaLynn")
        .join("memory.db")
}
