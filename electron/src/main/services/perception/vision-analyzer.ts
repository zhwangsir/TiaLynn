/**
 * Vision Analyzer —— 截屏 → 调 vision LLM → publish 描述事件
 *
 * LM Studio OpenAI-compat 视觉调用格式：
 *   POST /v1/chat/completions
 *   {
 *     "model": "qwen-vl-...",
 *     "messages": [
 *       { "role": "user", "content": [
 *         { "type": "text", "text": "描述..." },
 *         { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
 *       ]}
 *     ]
 *   }
 *
 * 输出 JSON 结构化描述 → 发 perception event
 *
 * 关键设计：
 *   - 不阻塞 sensor — 异步进行
 *   - 失败静默 + 日志（vision 调用慢且不稳定，不弹 toast 烦用户）
 *   - 限并发 1（避免同时多次截屏调用挤爆 vision LLM）
 */
import { perception } from './bus'
import type { PerceptionConfig, ScreenSnapshotEvent } from '@shared/perception'

const SYSTEM_PROMPT = `你是一位敏锐的桌面观察者。看一张主人的屏幕截图，输出严格 JSON（无 markdown 围栏）：
{
  "activity": "一句话主活动（如：「写 Python 代码」「看 B 站视频」「浏览设计稿」「聊天」）",
  "description": "2-3 句更详细的描述",
  "notable_elements": ["3-5 个关键元素"],
  "user_state": "focused/frustrated/idle/switching/reading/unknown 中的一个"
}
要简洁、客观、不加判断。看到代码就描述语言/库；看到错误就提一下；看到视频/图片就描述内容大意。`

let inFlight = false

export async function analyzeSnapshot(
  ev: ScreenSnapshotEvent,
  config: PerceptionConfig,
): Promise<void> {
  if (inFlight) {
    // 已有一个分析在跑，跳过这次（vision 慢，避免堆积）
    return
  }
  if (!ev.image_b64) return
  if (!config.vision_endpoint || !config.vision_model) {
    console.warn('[vision-analyzer] endpoint/model not configured')
    return
  }

  inFlight = true
  const start = Date.now()
  try {
    const url = `${config.vision_endpoint.replace(/\/+$/, '')}/v1/chat/completions`
    const body = {
      model: config.vision_model,
      temperature: 0.3,
      max_tokens: 4000, // VL 模型有时也有 thinking
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SYSTEM_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:${ev.image_mime ?? 'image/jpeg'};base64,${ev.image_b64}`,
              },
            },
          ],
        },
      ],
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.warn(`[vision-analyzer] HTTP ${resp.status}: ${text.slice(0, 200)}`)
      return
    }

    const json = (await resp.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string }
        finish_reason?: string
      }>
      error?: { message?: string }
    }
    if (json.error?.message) {
      console.warn(`[vision-analyzer] model error: ${json.error.message}`)
      return
    }
    const choice = json.choices?.[0]
    // thinking 模型 fallback: 若 content 空但 reasoning_content 有 → 拿 reasoning 末尾试
    const content =
      choice?.message?.content ||
      (choice?.message?.reasoning_content
        ? extractFinalAnswerFromReasoning(choice.message.reasoning_content)
        : '') ||
      ''
    if (!content) {
      console.warn(
        `[vision-analyzer] empty response. finish_reason=${choice?.finish_reason ?? '?'} 可能模型不支持 vision 或 max_tokens 太小`,
      )
      return
    }

    const parsed = extractJson(content)
    if (!parsed) {
      console.warn('[vision-analyzer] non-JSON response:', content.slice(0, 200))
      // 即使无法解析也发个事件，至少有 raw 描述
      perception.publish({
        type: 'vision_description',
        t: Date.now(),
        snapshot_t: ev.t,
        activity: '未知',
        description: content.slice(0, 300),
        notable_elements: [],
        user_state_hint: 'unknown',
        latency_ms: Date.now() - start,
      })
      return
    }

    perception.publish({
      type: 'vision_description',
      t: Date.now(),
      snapshot_t: ev.t,
      activity: String(parsed.activity ?? '未知'),
      description: String(parsed.description ?? ''),
      notable_elements: Array.isArray(parsed.notable_elements)
        ? parsed.notable_elements.map(String).slice(0, 8)
        : [],
      user_state_hint: normalizeUserState(parsed.user_state),
      latency_ms: Date.now() - start,
    })
  } catch (e) {
    console.warn('[vision-analyzer] error:', e)
  } finally {
    inFlight = false
  }
}

function extractFinalAnswerFromReasoning(reasoning: string): string {
  // 一些 thinking 模型把答案放在 reasoning 末尾「**Output:**」「最终输出：」之后
  const markers = ['Final Plan:', 'Output:', '**Output:**', '最终输出:', '最终输出：', 'Final answer:']
  for (const m of markers) {
    const idx = reasoning.lastIndexOf(m)
    if (idx >= 0) return reasoning.slice(idx + m.length).trim()
  }
  return ''
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeUserState(
  v: unknown,
): 'focused' | 'frustrated' | 'idle' | 'switching' | 'reading' | 'unknown' {
  const s = String(v ?? '').toLowerCase()
  if (['focused', 'frustrated', 'idle', 'switching', 'reading'].includes(s)) {
    return s as 'focused' | 'frustrated' | 'idle' | 'switching' | 'reading'
  }
  return 'unknown'
}
