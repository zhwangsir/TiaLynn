/**
 * 对话历史 SQLite 持久化 ~/.tialynn/history.sqlite
 *
 * 表 turns：所有用户/助手回合
 * 表 sessions：可选会话分组（暂时只有 default 一个）
 *
 * 设计：写操作同步（better-sqlite3 是同步 API，主进程不会卡，单次 sub-ms）。
 * 启动时 listRecent(50) 拿最近 50 条供 dialog store 恢复。
 */
import Database, { type Database as DB } from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getPaths } from './paths'

export interface StoredTurn {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  emotion: string | null
  intensity: number | null
  ts: number
  error: string | null
  session_id: string
}

const DEFAULT_SESSION = 'default'
let db: DB | null = null

function ensure(): DB {
  if (db) return db
  const path = getPaths().historyDbPath
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
  const instance = new Database(path)
  instance.pragma('journal_mode = WAL')
  instance.pragma('synchronous = NORMAL')
  instance.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '${DEFAULT_SESSION}',
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      text TEXT NOT NULL,
      emotion TEXT,
      intensity REAL,
      error TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session_ts ON turns(session_id, ts);
  `)
  db = instance
  return instance
}

export function appendTurn(t: Omit<StoredTurn, 'session_id'> & { session_id?: string }): void {
  const stmt = ensure().prepare(`
    INSERT OR REPLACE INTO turns (id, session_id, role, text, emotion, intensity, error, ts)
    VALUES (@id, @session_id, @role, @text, @emotion, @intensity, @error, @ts)
  `)
  stmt.run({
    id: t.id,
    session_id: t.session_id ?? DEFAULT_SESSION,
    role: t.role,
    text: t.text,
    emotion: t.emotion ?? null,
    intensity: t.intensity ?? null,
    error: t.error ?? null,
    ts: t.ts,
  })
}

export function listRecent(limit = 50, sessionId = DEFAULT_SESSION): StoredTurn[] {
  const rows = ensure()
    .prepare(
      `SELECT id, session_id, role, text, emotion, intensity, error, ts
       FROM turns
       WHERE session_id = ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as StoredTurn[]
  return rows.reverse()
}

export function clearAll(sessionId = DEFAULT_SESSION): number {
  const result = ensure().prepare(`DELETE FROM turns WHERE session_id = ?`).run(sessionId)
  return result.changes
}

export function close(): void {
  if (db) {
    db.close()
    db = null
  }
}
