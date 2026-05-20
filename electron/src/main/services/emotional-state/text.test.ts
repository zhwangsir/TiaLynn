/**
 * Phase 1 J: emotional-state text 渲染测试。
 */
import { describe, expect, it } from 'vitest'
import { applyTopicMention } from './evolution'
import {
  emotionalStateOneLiner,
  emotionalStateToPromptFragment,
} from './text'
import { createDefaultEmotionalState } from './types'

function fresh() {
  return createDefaultEmotionalState('test', 'calm')
}

describe('emotionalStateToPromptFragment', () => {
  it('基础 calm 状态输出含「心情」+「平静」+ intensity', () => {
    const out = emotionalStateToPromptFragment(fresh())
    expect(out).toContain('# 你现在的状态')
    expect(out).toContain('心情:')
    expect(out).toContain('平静')
    expect(out).toContain('intensity=0.30')
    expect(out).toContain('隐性融入')
  })

  it('高 missing_intensity 输出想念句', () => {
    const s = { ...fresh(), missing_intensity: 0.7, last_chat_at: Date.now() - 12 * 3600_000 }
    const out = emotionalStateToPromptFragment(s)
    expect(out).toMatch(/12 小时/)
    expect(out).toContain('闹心')
  })

  it('高强度 happy → "很心情很好"', () => {
    const s = { ...fresh(), current_mood: 'happy' as const, mood_intensity: 0.9 }
    const out = emotionalStateToPromptFragment(s)
    expect(out).toMatch(/很心情很好|很心情/)
  })

  it('强情感话题被列出', () => {
    let s = fresh()
    s = applyTopicMention(s, '工作', -0.6, Date.now())
    s = applyTopicMention(s, '工作', -0.5, Date.now())
    const out = emotionalStateToPromptFragment(s)
    expect(out).toContain('不舒服的话题')
    expect(out).toContain('工作')
    expect(out).toContain('提过 2 次')
  })

  it('弱情感话题不被列出（abs sentiment <= 0.3）', () => {
    let s = fresh()
    s = applyTopicMention(s, '天气', 0.2, Date.now())
    s = applyTopicMention(s, '天气', 0.1, Date.now())
    const out = emotionalStateToPromptFragment(s)
    expect(out).not.toContain('天气')
  })

  it('低提及次数 (1) 即使强情感也不列', () => {
    const s = applyTopicMention(fresh(), '猫', 0.9, Date.now())
    const out = emotionalStateToPromptFragment(s)
    expect(out).not.toContain('猫')
  })

  it('低 missing (0.1) 不渲染想念句', () => {
    const s = { ...fresh(), missing_intensity: 0.1 }
    const out = emotionalStateToPromptFragment(s)
    expect(out).not.toContain('小时')
  })
})

describe('emotionalStateOneLiner', () => {
  it('基础形态', () => {
    expect(emotionalStateOneLiner(fresh())).toContain('平静')
  })

  it('高想念时追加想念分量', () => {
    const s = { ...fresh(), missing_intensity: 0.7 }
    expect(emotionalStateOneLiner(s)).toContain('想念')
  })

  it('低想念不追加', () => {
    const s = { ...fresh(), missing_intensity: 0.2 }
    expect(emotionalStateOneLiner(s)).not.toContain('想念')
  })
})
