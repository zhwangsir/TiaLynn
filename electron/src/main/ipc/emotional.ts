/**
 * Emotional state IPC handlers (Phase 1 J 接通)。
 *
 * 每轮对话结束 dialog.ts fire-and-forget 调 emotional:on-reply:
 *   1. emotion → sentiment 映射
 *   2. applyChatSentiment (mood 切换 happy/tease/sad/angry)
 *   3. extractTopics(user_text) → applyTopicMention (累积 topic 印记)
 *   4. applyTick (顺带衰减 mood + 增长 missing — 被动 tick)
 */
import {
  emotionalGetState,
  emotionalOnReply,
  emotionalSetMood,
  emotionalTick,
} from '@shared/channels/emotional'
import { getActiveCharacter } from '../services/character-store'
import {
  loadEmotionalState,
  onSetMood,
  onTick,
  updateEmotionalState,
} from '../services/emotional-state/store'
import {
  applyChatSentiment,
  applyTick,
  applyTopicMention,
} from '../services/emotional-state/evolution'
import { emotionToSentiment } from '../services/emotional-state/sentiment'
import { extractTopics } from '../services/emotional-state/topic-extractor'
import { handleInvoke } from './channel-helpers'

export function registerEmotionalIpc(): void {
  handleInvoke(emotionalOnReply, (payload) => {
    const active = getActiveCharacter()
    if (!active) return { ok: false }

    const sentiment = emotionToSentiment(payload.emotion, payload.intensity)
    const topics = extractTopics(payload.user_text ?? '')

    updateEmotionalState(active.id, (s) => {
      let next = applyChatSentiment(s, sentiment)
      // 把 topic hits 转成 sentiment 加权累积
      for (const t of topics) {
        next = applyTopicMention(next, t.topic, sentiment)
      }
      next = applyTick(next)
      return next
    })
    return { ok: true }
  })

  handleInvoke(emotionalGetState, () => {
    const active = getActiveCharacter()
    if (!active) return null
    return loadEmotionalState(active.id)
  })

  handleInvoke(emotionalTick, () => {
    const active = getActiveCharacter()
    if (!active) return null
    return onTick(active.id)
  })

  handleInvoke(emotionalSetMood, (payload) => {
    const active = getActiveCharacter()
    if (!active) return null
    return onSetMood(active.id, payload.mood, payload.intensity, payload.trigger ?? 'manual')
  })
}
