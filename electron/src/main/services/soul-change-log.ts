/**
 * Soul Change Log (P5) — 每次 SoulEditor 保存 yaml 后追加 audit trail。
 *
 * 文件: ~/.tialynn/characters/<id>/soul-changes.log (NDJSON 每行 JSON)
 * 字段: { ts, character_id, filename, summary, changes }
 *
 * 设计:
 *   - NDJSON 便于追加 (无需 rewrite 全文件)
 *   - 每次 append 截断到 200 行 LRU (避免无限增长)
 *   - 失败不影响主 save 流程 (try/catch swallow)
 *   - 调用方传入 before/after yaml 内容字符串 → 这里做 yaml parse + diff
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { diffSoulConfigs, type FieldChange, type SoulConfig } from '@tialynn/soul-loader'
import { characterDir, getCharacter } from './character-store'

const MAX_LOG_ENTRIES = 200

export interface SoulChangeLogEntry {
  ts: number
  character_id: string
  filename: string
  summary: string
  changes: FieldChange[]
}

/**
 * P0 SEC (H2): characterId 在用于 fs path 之前必须验证存在，
 * 防 '../etc' / '/etc/cron' 类路径污染从 IPC 传入。
 */
function isValidCharacterId(characterId: string): boolean {
  if (!characterId || typeof characterId !== 'string') return false
  if (!/^[a-zA-Z0-9_-]+$/.test(characterId)) return false
  return getCharacter(characterId) !== null
}

function logPath(characterId: string): string {
  return join(characterDir(characterId), 'soul-changes.log')
}

/**
 * 计算 diff + append 一条 log entry。
 * 完全 best-effort — yaml 解析失败 / 写盘失败都 swallow。
 */
export function recordSoulChange(
  characterId: string,
  filename: string,
  beforeYaml: string,
  afterYaml: string,
): SoulChangeLogEntry | null {
  // P0 SEC (H2): characterId 必须验证
  if (!isValidCharacterId(characterId)) {
    console.warn('[soul-change-log] 非法 characterId 拒绝写 log:', characterId)
    return null
  }
  // filename 必须是合法 yaml 文件名 (跟 writeCharacterSoulFile 约束一致)
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    console.warn('[soul-change-log] 非法 filename 拒绝:', filename)
    return null
  }
  try {
    const beforeObj = parseYamlSafe(beforeYaml)
    const afterObj = parseYamlSafe(afterYaml)
    // 用 partial 对象当 SoulConfig (diff 不依赖完整字段) — 双 cast 绕过 TS 严格检查
    const diff = diffSoulConfigs(
      beforeObj as unknown as SoulConfig,
      afterObj as unknown as SoulConfig,
    )
    if (diff.changes.length === 0) return null

    const entry: SoulChangeLogEntry = {
      ts: Date.now(),
      character_id: characterId,
      filename,
      summary: diff.summary,
      changes: diff.changes,
    }
    appendToFile(characterId, entry)
    return entry
  } catch (e) {
    console.error('[soul-change-log] recordSoulChange failed (non-fatal):', e)
    return null
  }
}

function parseYamlSafe(text: string): Record<string, unknown> {
  if (!text || !text.trim()) return {}
  try {
    const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA })
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function appendToFile(characterId: string, entry: SoulChangeLogEntry): void {
  const p = logPath(characterId)
  // 读原序（NDJSON 一行一 entry，无 reverse）
  const existing: SoulChangeLogEntry[] = []
  if (existsSync(p)) {
    try {
      const raw = readFileSync(p, 'utf-8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          existing.push(JSON.parse(line))
        } catch {
          /* 损坏行跳过 */
        }
      }
    } catch {
      /* read fail 视为空 */
    }
  }
  existing.push(entry)
  // LRU 截断 (保留最新的 MAX_LOG_ENTRIES 条)
  const kept = existing.slice(-MAX_LOG_ENTRIES)
  writeFileSync(p, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
}

/** 读出某 character 的全部历史（按时间倒序 newest first） */
export function loadSoulChangeLog(characterId: string): SoulChangeLogEntry[] {
  // P0 SEC (H2): 验证 characterId 防路径污染
  if (!isValidCharacterId(characterId)) return []
  const p = logPath(characterId)
  if (!existsSync(p)) return []
  try {
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim().length > 0)
    const entries: SoulChangeLogEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line))
      } catch {
        /* 损坏行跳过 */
      }
    }
    return entries.reverse() // newest first
  } catch {
    return []
  }
}

export function clearSoulChangeLog(characterId: string): void {
  // P0 SEC (H2): 验证 characterId 防路径污染
  if (!isValidCharacterId(characterId)) return
  const p = logPath(characterId)
  if (existsSync(p)) writeFileSync(p, '', 'utf-8')
}
