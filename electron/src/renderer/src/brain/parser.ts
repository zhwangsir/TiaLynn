/**
 * 解析 LLM 输出 —— 我们的 output_protocol 要求 JSON {text, emotion, intensity}。
 * 兼容：
 *   1. 完整 JSON
 *   2. JSON 前后带闲话
 *   3. ```json fence
 *   4. 完全不遵守协议（fallback：把整段当 text，emotion=neutral）
 */
import type { EmotionId } from '@shared/types'
import type { ParsedReply } from './types'

const EMOTIONS: EmotionId[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprise',
  'shy',
  'tease',
  'sleepy',
]

export function parseReply(raw: string): ParsedReply {
  const fallback: ParsedReply = { text: raw.trim(), emotion: 'neutral', intensity: 0.5 }
  const cleaned = stripFence(raw).trim()
  const objs = extractJsonObjects(cleaned)
  for (const obj of objs) {
    if (typeof obj.text === 'string') {
      return {
        text: obj.text,
        emotion: normalizeEmotion(obj.emotion),
        intensity: clamp01(typeof obj.intensity === 'number' ? obj.intensity : 0.5),
      }
    }
  }
  return fallback
}

/** 解析流式增量中可能的部分 JSON：用「最大已知前缀」抽取 text 字段 */
export function parsePartialText(buffer: string): string {
  // 简单做法：找 "text":" 后的字符串，到下一个未转义 "
  const m = buffer.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (!m) return ''
  return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
}

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
}

function extractJsonObjects(s: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  let depth = 0
  let start = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        const candidate = s.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate) as Record<string, unknown>
          if (parsed && typeof parsed === 'object') out.push(parsed)
        } catch {
          /* skip malformed */
        }
        start = -1
      }
    }
  }
  return out
}

function normalizeEmotion(v: unknown): EmotionId {
  if (typeof v === 'string') {
    const low = v.trim().toLowerCase() as EmotionId
    if (EMOTIONS.includes(low)) return low
  }
  return 'neutral'
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
