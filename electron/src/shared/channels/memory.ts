/**
 * Memory 域 IPC channels (Phase 1 W4)。
 *
 * 8 个 handler 全部 type-safe，main 实现签名跟服务层 (memory-store / memory-extractor) 对齐。
 */
import { defineChannel } from '../ipc-channel'

export type MemoryKind = 'fact' | 'preference' | 'event' | 'reflection'

export interface Memory {
  id: string
  kind: MemoryKind
  text: string
  embedding: number[]
  importance: number
  source: string
  ts: number
}

export interface MemorySearchHit extends Memory {
  score: number
}

export const memoryList = defineChannel<
  { kind?: MemoryKind; limit?: number } | undefined,
  Memory[]
>('memory:list')

export const memoryCount = defineChannel<void, number>('memory:count')

export const memoryAdd = defineChannel<
  {
    kind: MemoryKind
    text: string
    importance: number
    embedding?: number[]
  },
  { ok: boolean; memory?: Memory; reason?: string }
>('memory:add')

export const memoryDelete = defineChannel<
  string,
  { ok: boolean; reason?: string }
>('memory:delete')

export const memorySearch = defineChannel<
  { query_embedding: number[]; k?: number },
  MemorySearchHit[]
>('memory:search')

/** main 实际返回 Memory[] (extractMemoriesFromTurn 直接 return)，不是 { ok, extracted } —
 *  之前 api.ts 写的伪类型让 dialog.ts 拿到错的 shape — type-safe channel 揪出此 bug */
export const memoryExtractFromTurn = defineChannel<
  { user_text: string; assistant_text: string; turn_id: string },
  Memory[]
>('memory:extract-from-turn')

/** 注：service 返回 string，main wrapper 包装成 { ok, context, matches } */
export const memoryRagContext = defineChannel<
  { query_text: string; k?: number },
  { ok: boolean; context?: string; matches?: number; reason?: string }
>('memory:rag-context')

export const memoryDailyReflection = defineChannel<
  void,
  { ok: boolean; reflection?: Memory; reason?: string }
>('memory:daily-reflection')
