/**
 * v0.15 C1+C2+C3: 长期记忆 IPC — Phase 1 W4 改 type-safe channel.
 */
import {
  addMemory,
  countMemories,
  deleteMemory,
  listMemories,
  searchMemories,
} from '../services/memory-store'
import { buildRagContext, dailyReflection, extractMemoriesFromTurn } from '../services/memory-extractor'
import { getActiveCharacter } from '../services/character-store'
import {
  memoryAdd,
  memoryCount,
  memoryDailyReflection,
  memoryDelete,
  memoryExtractFromTurn,
  memoryList,
  memoryRagContext,
  memorySearch,
} from '@shared/channels/memory'
import { handleInvoke } from './channel-helpers'

export function registerMemoryIpc(): void {
  handleInvoke(memoryList, (opts) => {
    const a = getActiveCharacter()
    if (!a) return []
    return listMemories(a.id, opts ?? {})
  })

  handleInvoke(memoryCount, () => {
    const a = getActiveCharacter()
    return a ? countMemories(a.id) : 0
  })

  handleInvoke(memoryAdd, (payload) => {
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

  handleInvoke(memoryDelete, (id) => {
    const a = getActiveCharacter()
    if (!a) return { ok: false, reason: 'no active' }
    return { ok: deleteMemory(a.id, id) }
  })

  handleInvoke(memorySearch, (payload) => {
    const a = getActiveCharacter()
    if (!a) return []
    return searchMemories(a.id, payload.query_embedding, payload.k ?? 5)
  })

  handleInvoke(memoryExtractFromTurn, async (payload) => {
    return extractMemoriesFromTurn(payload.user_text, payload.assistant_text, payload.turn_id)
  })

  handleInvoke(memoryRagContext, (payload) => {
    const ctx = buildRagContext(payload.query_text, payload.k ?? 5)
    if (!ctx) return { ok: false, reason: 'no matches' }
    // 简单计 newline 行数估算 matches
    const matches = ctx.split('\n').filter((l) => l.trim().startsWith('-')).length
    return { ok: true, context: ctx, matches }
  })

  handleInvoke(memoryDailyReflection, async () => {
    return dailyReflection()
  })
}
