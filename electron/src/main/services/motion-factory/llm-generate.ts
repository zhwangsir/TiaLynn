/**
 * 用 Claude (或其它 LLM) 生成 MotionDraft。
 *
 * Prompt 策略：
 *   1. 系统提示：解释 Live2D motion3.json 的 Linear keyframe 格式 + JSON schema
 *   2. 上下文：给模型可用 parameter list（含 min/max/usage_count），
 *      让 LLM 用熟悉/常用 parameter，且值不超范围
 *   3. 给 2-3 个已有 motion 摘要作为 few-shot
 *   4. 用户描述："温柔地点头" → 输出 strict JSON MotionDraft
 */
import type { ChatMessage } from '@shared/types'
import type { MotionDraft, ModelMotionSummary } from '@shared/motion'
import { buildProvider } from '../llm'
import { loadConfig } from '../config-store'

const SYSTEM_PROMPT = `你是 Live2D 动作设计师。给定模型的可用参数和示例动作，生成一个新动作。
严格输出 JSON，无其它文字：

{
  "name": "短英文/拼音名（用作文件名，必填）",
  "duration": 数字（秒，1~5 之间最自然），
  "loop": 是否循环（idle/呼吸类 true，一次性反应 false），
  "fps": 30,
  "tracks": [
    {
      "param": "参数 id（必须在「可用参数」清单里）",
      "keyframes": [[时间秒, 值], ...]  // 时间从 0 开始，最大 = duration，至少 2 个 keyframe
    }
  ],
  "description": "简短中文描述（写入 UserData）"
}

约束：
- 值必须在该参数的 min/max 范围内
- 至少有 3 条 tracks，至少有 1 条覆盖 ParamAngleX/Y 或 PARAM_ANGLE_X/Y（头部摇动）
- 对话/陪伴场景 1.5-4 秒最自然
- loop=true 时确保 keyframes 首末值相同/接近（避免跳变）`

export interface GenerateParams {
  summary: ModelMotionSummary
  /** 用户描述，如 "温柔点头" / "听到夸奖时害羞" */
  description: string
  /** 可选风格提示 */
  style?: string
  /** 已有 motions 的 few-shot 数量（最大 3） */
  examples?: number
}

export async function generateMotion(p: GenerateParams): Promise<MotionDraft> {
  const cfg = loadConfig()

  // 提前明确诊断 — 之前 buildProvider 不抛错但 chatStream 失败时上层只看到模糊错误
  if (!cfg.llm_provider) {
    throw new Error('LLM provider 未配置；请在「设置」中选择 Anthropic / OpenAI 兼容 / Ollama')
  }
  if (cfg.llm_provider === 'anthropic' && !cfg.llm_api_key) {
    throw new Error('Anthropic provider 需要 API key；请在「设置」填入 llm_api_key')
  }
  if (!cfg.llm_model) {
    throw new Error('LLM model 未配置；请在「设置」中填入模型名（如 claude-sonnet-4-5）')
  }
  if (!cfg.llm_endpoint && cfg.llm_provider !== 'anthropic') {
    throw new Error(`${cfg.llm_provider} 需要 endpoint URL；请在「设置」中填入`)
  }

  const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)

  // 选 top-N 高频参数 (~30 个足够)，避免上下文爆
  const topParams = p.summary.params.slice(0, 30).map((x) => ({
    id: x.id,
    range: `${round(x.min)}~${round(x.max)}`,
    used: x.usage_count,
  }))

  // few-shot：给 LLM 看 2 个已有 motion 的精简摘要（不展开 segments，太多）
  const fewShot = p.summary.motions
    .slice(0, p.examples ?? 2)
    .map((m) => `- 「${m.name}」时长 ${m.duration.toFixed(1)}s，loop=${m.loop}，使用参数 ${m.params.slice(0, 5).join(', ')}`)
    .join('\n')

  const userPrompt = [
    `# 可用参数（id : 值范围 : 在已有动作中出现次数）`,
    topParams.map((p) => `- ${p.id} : ${p.range} : ${p.used} 次`).join('\n'),
    ``,
    `# 模型已有的示例动作`,
    fewShot || '（无）',
    ``,
    `# 现在请生成一个新动作`,
    `描述：${p.description}`,
    p.style ? `风格：${p.style}` : '',
    ``,
    `严格只输出 JSON，无 markdown 围栏，无解释。`,
  ]
    .filter(Boolean)
    .join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let buffer = ''
  let streamError: string | null = null
  let done = false

  try {
    await provider.chatStream(
      messages,
      { model: cfg.llm_model, temperature: 0.7, max_tokens: 4000 },
      (evt) => {
        if (evt.delta) buffer += evt.delta
        if (evt.error) streamError = evt.error // capture，不 throw（chatStream 内部会吞）
        if (evt.done) done = true
      },
    )
  } catch (e) {
    throw new Error(
      `LLM 流式调用失败 (${cfg.llm_provider} @ ${cfg.llm_endpoint || '默认'}): ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }

  if (streamError) {
    throw new Error(`LLM 返回错误: ${streamError}`)
  }
  if (!done) {
    throw new Error('LLM 流未正常结束（可能网络中断）')
  }
  if (buffer.length === 0) {
    throw new Error(
      `LLM 没有返回任何文本。可能是 model 名错误、API key 无效、endpoint 不可达。检查 ${cfg.llm_provider} 配置：endpoint=${cfg.llm_endpoint || '默认'}, model=${cfg.llm_model}`,
    )
  }

  const json = extractJson(buffer)
  if (!json) {
    throw new Error(
      `LLM 输出无法解析为 JSON（前 300 字符）：\n${buffer.slice(0, 300)}\n\n` +
        `提示：可能该模型不支持复杂 JSON 输出，或被 system prompt 拒绝。试试换 model 或简化描述。`,
    )
  }
  const draft = validateDraft(json, p.summary)
  return draft
}

function extractJson(text: string): unknown {
  // 去 markdown 围栏
  const cleaned = text.replace(/^```(?:json)?/im, '').replace(/```\s*$/m, '').trim()
  // 找第一个 { ... 最后一个 } 之间
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1))
  } catch {
    return null
  }
}

function validateDraft(raw: unknown, summary: ModelMotionSummary): MotionDraft {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const r = raw as Record<string, unknown>
  const name = String(r.name ?? 'untitled')
  const duration = clamp(Number(r.duration ?? 2), 0.5, 30)
  const loop = !!r.loop
  const fps = Math.round(Number(r.fps ?? 30))
  if (!Array.isArray(r.tracks)) throw new Error('tracks 不是数组')

  const knownParams = new Set(summary.params.map((p) => p.id))
  const tracks = r.tracks
    .map((t) => {
      const tr = t as Record<string, unknown>
      const param = String(tr.param ?? '')
      if (!param) return null
      const kf = Array.isArray(tr.keyframes) ? tr.keyframes : []
      const keyframes = kf
        .map((k) => {
          if (Array.isArray(k) && k.length >= 2) {
            const t = clamp(Number(k[0]), 0, duration)
            const v = Number(k[1])
            if (!Number.isFinite(t) || !Number.isFinite(v)) return null
            return [t, v] as [number, number]
          }
          return null
        })
        .filter((x): x is [number, number] => x !== null)
      if (keyframes.length < 2) return null
      // 若参数已知 → 钳到 min/max（防 LLM 越界）
      const known = summary.params.find((p) => p.id === param)
      if (known) {
        const m = known.min - Math.abs(known.min) * 0.1
        const M = known.max + Math.abs(known.max) * 0.1
        for (const k of keyframes) k[1] = clamp(k[1], m, M)
      }
      return { param, keyframes }
    })
    .filter((x): x is { param: string; keyframes: Array<[number, number]> } => x !== null)

  // 至少筛掉完全无效的 tracks
  if (tracks.length === 0) throw new Error('没有任何有效 tracks')

  return {
    name,
    duration,
    loop,
    fps,
    tracks,
    description: r.description ? String(r.description) : undefined,
  }
  void knownParams // 暂未使用
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}
function round(v: number): number {
  return Math.round(v * 100) / 100
}
