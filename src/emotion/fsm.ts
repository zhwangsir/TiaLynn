import type { EmotionId } from '@/types/soul'

/**
 * 关键词触发表（v0.1 简化版，v0.2 起改为 LLM 协议返回情绪标签）。
 * 顺序敏感：从上到下，第一个命中即返回。
 */
const KEYWORD_RULES: Array<{ keywords: string[]; emotion: EmotionId }> = [
  // 占有欲（"她/别人"等敏感词）
  { keywords: ['她', '别人', '另一个', '前任', '女同事'], emotion: 'possessive' },
  // 责怪/愤怒
  { keywords: ['滚', '讨厌', '不喜欢', '别烦我'], emotion: 'angry' },
  // 害羞/被欺负
  { keywords: ['你欺负', '你坏', '坏蛋', '羞', '害羞'], emotion: 'shy' },
  // 伤心
  { keywords: ['累', '难过', '伤心', '哭', '不开心', '心累'], emotion: 'sad' },
  // 困倦
  { keywords: ['困', '睡', '晚安', '熬夜'], emotion: 'sleepy' },
  // 开心（放后面避免覆盖更具体的）
  { keywords: ['哈哈', '好棒', '喜欢', '爱你', '开心', '高兴', '可爱', '美'], emotion: 'happy' },
]

export function detectEmotionFromText(text: string): EmotionId | null {
  const lower = text.trim()
  if (!lower) return null
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      return rule.emotion
    }
  }
  return null
}
