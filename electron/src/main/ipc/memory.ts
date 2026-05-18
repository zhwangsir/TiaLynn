/**
 * v0.15 C1+C2+C3: 长期记忆 IPC。
 */
import { ipcMain } from 'electron'
import {
  addMemory,
  countMemories,
  deleteMemory,
  listMemories,
  searchMemories,
  type Memory,
} from '../services/memory-store'
import { buildRagContext, dailyReflection, extractMemoriesFromTurn } from '../services/memory-extractor'
import { getActiveCharacter } from '../services/character-store'

export function registerMemoryIpc(): void {
  /** 列当前角色记忆 */
  ipcMain.handle('memory:list', (_evt, opts?: { kind?: Memory['kind']; limit?: number }) => {
    const a = getActiveCharacter()
    if (!a) return []
    return listMemories(a.id, opts ?? {})
  })

  ipcMain.handle('memory:count', () => {
    const a = getActiveCharacter()
    return a ? countMemories(a.id) : 0
  })

  /** 手动添加一条记忆（master 主动告诉她重要的事） */
  ipcMain.handle('memory:add', (_evt, payload: Pick<Memory, 'kind' | 'text' | 'importance'> & { embedding?: number[] }) => {
    const a = getActiveCharacter()
    if (!a) return { ok: false, reason: 'no active' }
    const m = addMemory(a.id, {
      kind: payload.kind,
      text: payload.text,
      embedding: payload.embedding ?? [],
      importance: payload.importance,
      source: 'manual',
    })
    return { ok: true, memory: m }
  })

  ipcMain.handle('memory:delete', (_evt, id: string) => {
    const a = getActiveCharacter()
    if (!a) return { ok: false, reason: 'no active' }
    return { ok: deleteMemory(a.id, id) }
  })

  ipcMain.handle('memory:search', (_evt, payload: { query_embedding: number[]; k?: number }) => {
    const a = getActiveCharacter()
    if (!a) return []
    return searchMemories(a.id, payload.query_embedding, payload.k ?? 5)
  })

  /** C2: dialog reply-end 后 main 调，抽取记忆 */
  ipcMain.handle('memory:extract-from-turn', async (_evt, payload: { user_text: string; assistant_text: string; turn_id: string }) => {
    return extractMemoriesFromTurn(payload.user_text, payload.assistant_text, payload.turn_id)
  })

  /** C3: chat 前 main 调，拿 RAG context prepend */
  ipcMain.handle('memory:rag-context', (_evt, payload: { query_text: string; k?: number }) => {
    return buildRagContext(payload.query_text, payload.k ?? 5)
  })

  /** C3: 触发每日 reflection */
  ipcMain.handle('memory:daily-reflection', async () => {
    return dailyReflection()
  })
}
