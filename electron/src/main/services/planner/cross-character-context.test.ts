/**
 * planner.collectCrossCharacterContext — Round P 单测
 *
 * 验证 planner 从自己 memory.db 取 cross-character event 拼 prompt 片段:
 *   - default planner(characterId=null)→ 永远 null,不读 db
 *   - characterId set + 无 event → null
 *   - characterId set + 有 event(source 以 cross_character: 开头)→ section string
 *   - 非 cross_character source 的 event 不混进来
 *   - 最多 3 条(top by ts desc)
 *   - text 截 120 字
 *   - listMemories 抛 → console.warn + 返 null,不阻塞 planner
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('../memory-store', () => ({
  listMemories: vi.fn(),
}))

import { BehaviorPlanner } from './index'
import { listMemories } from '../memory-store'

const mockListMemories = vi.mocked(listMemories)

function mem(args: {
  id: string
  text: string
  source: string
  ts?: number
}): {
  id: string
  kind: 'event'
  text: string
  embedding: number[]
  importance: number
  source: string
  ts: number
} {
  return {
    id: args.id,
    kind: 'event',
    text: args.text,
    embedding: [],
    importance: 0.45,
    source: args.source,
    ts: args.ts ?? Date.now(),
  }
}

describe('Round P: planner.collectCrossCharacterContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('characterId null → 不读 db,返 null', () => {
    const p = new BehaviorPlanner(null)
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    expect(mockListMemories).not.toHaveBeenCalled()
  })

  it('characterId set + 没 event → 返 null', () => {
    mockListMemories.mockReturnValue([])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    expect(mockListMemories).toHaveBeenCalledWith('hina', {
      kind: 'event',
      limit: 20,
    })
  })

  it('characterId set + 1 个 cross-character event → section string 含该 text', () => {
    mockListMemories.mockReturnValue([
      mem({
        id: '1',
        text: 'Suzy 对 master 说: 晚安',
        source: 'cross_character:suzy',
      }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).not.toBeNull()
    expect(r).toContain('Suzy 对 master 说: 晚安')
    expect(r).toContain('1.') // 列表 prefix
    expect(r).toContain('# 你最近作为旁观者听到的')
  })

  it('过滤非 cross_character source 的 event', () => {
    mockListMemories.mockReturnValue([
      mem({ id: '1', text: '主人吃了饭', source: 'turn_abc' }), // 普通 event
      mem({
        id: '2',
        text: 'Suzy 对 master 说: hi',
        source: 'cross_character:suzy',
      }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toContain('Suzy 对 master 说: hi')
    expect(r).not.toContain('主人吃了饭') // 普通 event 不进
  })

  it('超过 3 条 → 只取前 3 条(listMemories 已按 ts desc)', () => {
    mockListMemories.mockReturnValue(
      Array.from({ length: 6 }, (_, i) =>
        mem({
          id: `${i}`,
          text: `event ${i}`,
          source: 'cross_character:other',
        }),
      ),
    )
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toContain('event 0')
    expect(r).toContain('event 1')
    expect(r).toContain('event 2')
    expect(r).not.toContain('event 3') // 第 4 个被切
  })

  it('text 超 120 字 → 截断', () => {
    const longText = 'x'.repeat(300)
    mockListMemories.mockReturnValue([
      mem({ id: '1', text: longText, source: 'cross_character:other' }),
    ])
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()!
    // 提取列表第 1 项的 body(remove "1. " prefix)
    const line = r.split('\n').find((l) => l.startsWith('1. '))
    expect(line).toBeDefined()
    const body = line!.replace(/^1\. /, '')
    expect(body.length).toBe(120)
  })

  it('listMemories 抛 → console.warn + 返 null,不阻塞 planner', () => {
    mockListMemories.mockImplementation(() => {
      throw new Error('db locked')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = new BehaviorPlanner('hina')
    const r = p.collectCrossCharacterContext()
    expect(r).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[planner] collectCrossCharacterContext failed:',
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})
