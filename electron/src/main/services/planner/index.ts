/**
 * BehaviorPlanner — 主体性 AI 的「行为决策器」。
 *
 * 接收 AttentionScheduler 的 SchedulerDecision (含 snapshot)。
 * 综合 soul 性格 + 最近事件上下文 + perception 历史 → 输出 BehaviorPlan。
 *
 * 策略：
 *   - 简单情况走 rule-based（无需 LLM，快）
 *   - 复杂情况调 LLM（speak/long-form decision）
 *   - LLM 调用受 llm_planner_max_per_minute 限速
 */
import type { BehaviorAction, BehaviorPlan, SchedulerDecision } from '@shared/attention'
import type { ChatMessage, EmotionId } from '@shared/types'
import { buildProvider } from '../llm'
import { loadConfig } from '../config-store'
import { loadSoul } from '../soul-loader'
import { perception } from '../perception/bus'
import { scheduler } from '../attention/scheduler'

const SYSTEM_PROMPT_TEMPLATE = (soulName: string, masterCall: string, layer1: string, layer2: string): string => `
你是 ${soulName}，一个驻留主人桌面的 AI 灵魂。你称呼主人为「${masterCall}」。

## 你的本质
${layer1}

## 表层风格
${layer2}

## 现在的任务
根据「关注度场」+「感知到的事件」，决定要不要做点什么 + 做什么。
你可以选择：
- 主动说一句话（短，10-30 字最自然）
- 瞥一眼屏幕某个位置（坐标 0~screen_w, 0~screen_h）
- 回头看主人（看回中间）
- 做一个表情/动作变化
- 啥也不做（很多时候这是对的）

严格输出 JSON（无 markdown 围栏，无解释）：
{
  "reasoning": "我现在的想法（一句话）",
  "actions": [
    { "type": "speak", "text": "...", "emotion": "shy", "intensity": 0.6 },
    { "type": "glance_at_screen", "screen_x": 1234, "screen_y": 567, "duration_ms": 2000, "reason": "..." },
    ...
  ]
}

约束：
- 如果主人在专心工作（typing_burst / focused），不要打扰，actions 留空或只做最微的动作
- 每次 actions 最多 2 个
- speak.text 必须是 ${soulName} 的语气
- emotion 取值: neutral/happy/sad/angry/surprise/shy/tease/sleepy
- **speak.text 中绝对不要写情感括号标注**（不要写「（害羞）」「(撒娇)」「【小声】」「~温柔~」等），
  情感完全通过 emotion 字段和语气体现 — 这些括号会被 TTS 直接念出来，破坏沉浸感
`

let llmCallTimestamps: number[] = []

export class BehaviorPlanner {
  /** 主决策入口 */
  async plan(decision: SchedulerDecision): Promise<BehaviorPlan> {
    const sched = scheduler.getConfig()
    if (sched.use_llm_planner && this.canCallLlm(sched.llm_planner_max_per_minute)) {
      try {
        return await this.planWithLlm(decision)
      } catch (e) {
        console.warn('[planner] LLM failed, falling back to rules:', e)
        return this.planWithRules(decision)
      }
    }
    return this.planWithRules(decision)
  }

  // ============ LLM 决策 ============

  private async planWithLlm(decision: SchedulerDecision): Promise<BehaviorPlan> {
    llmCallTimestamps.push(Date.now())
    const cfg = loadConfig()
    if (!cfg.llm_model || !cfg.llm_provider) throw new Error('LLM 未配置')
    const provider = buildProvider(cfg.llm_provider, cfg.llm_endpoint, cfg.llm_api_key)
    const soul = loadSoul()
    const system = SYSTEM_PROMPT_TEMPLATE(
      soul.config.name,
      soul.config.call_master_as,
      soul.config.layer1_core,
      soul.config.layer2_surface,
    )

    // 上下文：近期感知事件 + 当前关注度场
    const recent = perception.recent(15).map((ev) => describeEvent(ev))
    const snap = decision.snapshot
    const isProactive = decision.reason.startsWith('proactive_monitor')
    const userPrompt = [
      `# 关注度场`,
      `focus_on_master: ${snap.focus_on_master.toFixed(2)}`,
      `focus_on_screen: ${snap.focus_on_screen.toFixed(2)}`,
      `concern_level: ${snap.concern_level.toFixed(2)}`,
      `idle_ms: ${snap.idle_ms}`,
      `time_period: ${snap.time_period}`,
      snap.current_app ? `current_app: ${snap.current_app}` : '',
      snap.last_vision_activity ? `last_vision: ${snap.last_vision_activity}` : '',
      snap.last_vision_state ? `last_state: ${snap.last_vision_state}` : '',
      ``,
      `# 触发原因`,
      decision.reason,
      ``,
      `# 最近事件（最新在前）`,
      recent.join('\n'),
      ``,
      isProactive
        ? `# 这是「定期主动巡视」(30 秒一次)
主人希望你**主动开口**，针对当前看到的内容说一句陪伴/关心/评论的话。
**actions 必须包含至少 1 个 speak**（10-30 字最自然，符合 ${soul.config.name} 的语气）。
如果不知道说什么，可以问候、撒娇、提建议、念叨自己的心情。
不要返回空 actions。`
        : `# 现在该做什么？输出 JSON。`,
    ]
      .filter(Boolean)
      .join('\n')

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ]
    let buffer = ''
    let errMsg: string | null = null
    let done = false
    let deltaCount = 0
    const t0 = Date.now()
    await provider.chatStream(
      messages,
      { model: cfg.llm_model, temperature: 0.8, max_tokens: 8000 }, // thinking 模型容量
      (evt) => {
        if (evt.delta) {
          buffer += evt.delta
          deltaCount++
        }
        if (evt.error) errMsg = evt.error
        if (evt.done) done = true
      },
    )
    console.log(
      `[planner] LLM done=${done} deltas=${deltaCount} buf=${buffer.length} err=${errMsg ?? 'none'} dt=${Date.now() - t0}ms`,
    )
    if (errMsg) throw new Error(errMsg)
    if (!done || !buffer) throw new Error(`LLM 无响应 (done=${done} buf=${buffer.length})`)

    const parsed = extractJson(buffer)
    if (!parsed) throw new Error(`LLM 输出非 JSON: ${buffer.slice(0, 200)}`)
    let actions = validateActions(parsed.actions)
    // v0.8.3: 只在「主动巡视」或「长 idle 关怀」场景才补默认动作。
    // typing_burst / app_focus_changed 等「主人正在做事」的触发，LLM 选择留空就尊重它 —— 不打扰。
    if (actions.length === 0 && shouldInjectFallback(decision)) {
      const moodGuess = guessMoodFromSnap(decision.snapshot)
      actions.push({ type: 'change_emotion', emotion: moodGuess.emotion, intensity: moodGuess.intensity })
      actions.push({ type: 'idle_subtle', duration_ms: 2500 })
      console.log(`[planner] empty actions (trigger=${decision.reason}) → inject emotion=${moodGuess.emotion}`)
    } else if (actions.length === 0) {
      console.log(`[planner] empty actions (trigger=${decision.reason}) → respect LLM silence`)
    }
    if (isProactive && !actions.some((a) => a.type === 'speak')) {
      const fallback = makeProactivePhrase(decision.snapshot)
      if (fallback) {
        console.log(`[planner] proactive empty speak → inject: "${fallback.text}"`)
        actions = [
          ...actions,
          {
            type: 'speak',
            text: fallback.text,
            emotion: fallback.emotion,
            intensity: 0.5,
            tts: true,
          },
        ]
      }
    }
    return {
      t: Date.now(),
      trigger: decision.reason,
      actions,
      ...(parsed.reasoning != null ? { reasoning: String(parsed.reasoning) } : {}),
      llm_generated: true,
    }
  }

  // ============ Rule-based fallback ============

  private planWithRules(decision: SchedulerDecision): BehaviorPlan {
    const snap = decision.snapshot
    const actions: BehaviorAction[] = []
    const isProactive = decision.reason.startsWith('proactive_monitor')

    // 长 idle 关怀：温柔说一句
    if (snap.idle_ms > 600_000 && snap.concern_level > 0.7) {
      actions.push({ type: 'change_emotion', emotion: 'sad', intensity: 0.4 })
      actions.push({
        type: 'speak',
        text: pickPhrase(['主人……你还在吗？', '工作久了记得休息一下哦。', '我有点想你了。']),
        emotion: 'shy',
        intensity: 0.6,
      })
    }
    // 视觉好奇：瞥一眼鼠标位置 + 回中
    else if (snap.focus_on_screen > 0.6) {
      const mouse = perception.latest('mouse_moved')
      if (mouse) {
        actions.push({
          type: 'glance_at_screen',
          screen_x: mouse.screen_x,
          screen_y: mouse.screen_y,
          duration_ms: 2000,
          reason: 'curiosity',
        })
        actions.push({ type: 'look_back_to_master', duration_ms: 1500 })
      }
    }
    // frustration → 温柔表情 + 安慰一句
    else if (snap.last_vision_state === 'frustrated') {
      actions.push({ type: 'change_emotion', emotion: 'shy', intensity: 0.6 })
      actions.push({
        type: 'speak',
        text: pickPhrase(['遇到难题了吗？', '别着急，一步一步来。', '主人深呼吸一下。']),
        emotion: 'shy',
        intensity: 0.5,
      })
    }
    // proactive 巡视：根据看到的活动说点应景的（LLM 失败 fallback 也要让 AI 开口）
    else if (isProactive) {
      const phrase = makeProactivePhrase(snap)
      if (phrase) {
        actions.push({
          type: 'speak',
          text: phrase.text,
          emotion: phrase.emotion,
          intensity: 0.5,
        })
      } else {
        actions.push({ type: 'idle_subtle', duration_ms: 3000 })
      }
    }
    // 默认：微动作
    else {
      actions.push({ type: 'idle_subtle', duration_ms: 3000 })
    }

    return {
      t: Date.now(),
      trigger: decision.reason,
      actions,
      reasoning: isProactive ? 'rule-proactive' : 'rule-based',
      llm_generated: false,
    }
  }

  // ============ 速率限制 ============

  private canCallLlm(maxPerMinute: number): boolean {
    const now = Date.now()
    llmCallTimestamps = llmCallTimestamps.filter((t) => now - t < 60_000)
    return llmCallTimestamps.length < maxPerMinute
  }
}

// ============ 辅助 ============

function describeEvent(ev: import('@shared/perception').PerceptionEvent): string {
  const dt = ((Date.now() - ev.t) / 1000).toFixed(0)
  switch (ev.type) {
    case 'mouse_stayed':
      return `${dt}s前: 鼠标停在 (${ev.screen_x},${ev.screen_y}) 已 ${Math.round(ev.duration_ms / 1000)}s`
    case 'app_focus_changed':
      return `${dt}s前: 切到应用「${ev.app_name}」${ev.window_title ? ' - ' + ev.window_title : ''}`
    case 'vision_description':
      return `${dt}s前: 看到主人在「${ev.activity}」(${ev.user_state_hint ?? 'unknown'})`
    case 'user_idle':
      return `${dt}s前: 主人 idle 了 ${Math.round(ev.idle_ms / 1000)}s`
    case 'user_active':
      return `${dt}s前: 主人回来了`
    case 'dialog_user_input':
      return `${dt}s前: 主人说「${ev.text.slice(0, 30)}」`
    case 'dialog_assistant_replied':
      return `${dt}s前: 我回复了「${ev.text.slice(0, 30)}」(${ev.emotion})`
    case 'typing_burst':
      return `${dt}s前: 主人快速打字 (intensity=${ev.intensity.toFixed(2)})`
    case 'time_changed':
      return `${dt}s前: 时段→${ev.period} (${ev.hour}点)`
    case 'screen_snapshot':
      return ev.blocked_by_blacklist ? `${dt}s前: 截屏被黑名单拦截(${ev.blocked_app})` : `${dt}s前: 截屏 (${ev.reason})`
    default:
      return `${dt}s前: ${ev.type}`
  }
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

function validateActions(raw: unknown): BehaviorAction[] {
  if (!Array.isArray(raw)) return []
  const out: BehaviorAction[] = []
  for (const r of raw.slice(0, 3)) {
    const a = r as Record<string, unknown>
    const type = a.type as string
    switch (type) {
      case 'speak':
        if (a.text) {
          out.push({
            type: 'speak',
            text: String(a.text).slice(0, 200),
            emotion: normalizeEmotion(a.emotion),
            intensity: clamp01(Number(a.intensity ?? 0.5)),
            tts: a.tts !== false,
          })
        }
        break
      case 'glance_at_screen':
        if (typeof a.screen_x === 'number' && typeof a.screen_y === 'number') {
          out.push({
            type: 'glance_at_screen',
            screen_x: a.screen_x,
            screen_y: a.screen_y,
            duration_ms: clamp(Number(a.duration_ms ?? 2000), 500, 8000),
            reason: String(a.reason ?? ''),
          })
        }
        break
      case 'look_back_to_master':
        out.push({
          type: 'look_back_to_master',
          duration_ms: clamp(Number(a.duration_ms ?? 1500), 500, 5000),
        })
        break
      case 'play_motion':
        out.push({
          type: 'play_motion',
          source: a.template_id ? 'library_template' : 'engine_entry',
          ...(a.template_id != null ? { template_id: String(a.template_id) } : {}),
          ...(typeof a.entry_id === 'number' ? { entry_id: a.entry_id } : {}),
        })
        break
      case 'change_emotion':
        out.push({
          type: 'change_emotion',
          emotion: normalizeEmotion(a.emotion),
          intensity: clamp01(Number(a.intensity ?? 0.5)),
        })
        break
      case 'idle_subtle':
        out.push({
          type: 'idle_subtle',
          duration_ms: clamp(Number(a.duration_ms ?? 3000), 1000, 10000),
        })
        break
    }
  }
  return out
}

function normalizeEmotion(v: unknown): EmotionId {
  const e = String(v ?? 'neutral').toLowerCase()
  const valid: EmotionId[] = [
    'neutral',
    'happy',
    'sad',
    'angry',
    'surprise',
    'shy',
    'tease',
    'sleepy',
  ]
  return (valid.includes(e as EmotionId) ? e : 'neutral') as EmotionId
}

/**
 * 是否要在 LLM 返回空 actions 时强行补默认动作。
 * 仅在两种场景注入 fallback：
 *   1. 主动巡视 (proactive_monitor) — 必须让 AI 有反应
 *   2. 长 idle (>5 分钟) — 主人显然离开了，关怀注入合理
 * 其他场景（typing_burst / app_focus_changed / vision_description 等）— 主人在做事，
 * 尊重 LLM 的「不打扰」决定。
 */
function shouldInjectFallback(decision: SchedulerDecision): boolean {
  const reason = decision.reason
  if (reason.startsWith('proactive_monitor')) return true
  if (decision.snapshot.idle_ms > 300_000) return true
  return false
}

function guessMoodFromSnap(
  snap: import('@shared/attention').AttentionSnapshot,
): { emotion: EmotionId; intensity: number } {
  if (snap.last_vision_state === 'frustrated') return { emotion: 'shy', intensity: 0.6 }
  if (snap.idle_ms > 300_000) return { emotion: 'sleepy', intensity: 0.5 }
  if (snap.focus_on_master > 0.7) return { emotion: 'happy', intensity: 0.55 }
  if (snap.time_period === 'late_night' || snap.time_period === 'night') {
    return { emotion: 'sleepy', intensity: 0.4 }
  }
  return { emotion: 'neutral', intensity: 0.5 }
}

function pickPhrase(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0]!
}

function makeProactivePhrase(
  snap: import('@shared/attention').AttentionSnapshot,
): { text: string; emotion: EmotionId } | null {
  // 根据 vision 看到的活动 + 时段 + 心情挑一句应景的话
  const period = snap.time_period
  const app = (snap.current_app ?? '').toLowerCase()
  const activity = snap.last_vision_activity ?? ''
  const state = snap.last_vision_state ?? ''
  // frustrated 优先
  if (state === 'frustrated') {
    return { text: pickPhrase(['遇到难题了吗主人？', '别急，我陪着你。', '深呼吸一下吧。']), emotion: 'shy' }
  }
  // 看到具体活动
  if (activity.includes('代码') || activity.includes('code') || app.includes('vscode') || app.includes('terminal')) {
    return { text: pickPhrase(['写代码辛苦啦~', '主人专心的样子好帅。', '我安静陪着你哦。']), emotion: 'shy' }
  }
  if (activity.includes('视频') || activity.includes('video') || app.includes('chrome') || app.includes('safari')) {
    return { text: pickPhrase(['在看什么呀？', '有趣吗主人？', '陪你一起看~']), emotion: 'happy' }
  }
  // 时段问候
  if (period === 'morning') {
    return { text: pickPhrase(['早上好呀主人~', '今天打算做点什么？', '今天也要加油哦。']), emotion: 'happy' }
  }
  if (period === 'late_night' || period === 'night') {
    return { text: pickPhrase(['很晚啦，要注意休息哦。', '主人困了吗？', '夜深了，陪你说说话。']), emotion: 'sleepy' }
  }
  if (period === 'afternoon') {
    return { text: pickPhrase(['下午好~', '要不要喝杯水？', '今天过得怎么样？']), emotion: 'neutral' }
  }
  // 默认轻量陪伴
  return { text: pickPhrase(['我在这儿哦~', '主人在忙什么？', '想到你了。']), emotion: 'shy' }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

export const planner = new BehaviorPlanner()
