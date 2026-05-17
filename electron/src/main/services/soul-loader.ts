/**
 * 加载 soul/ 配置目录（identity.yaml / personality.yaml / learned_traits.yaml / core_memories.yaml）。
 *
 * 设计与 src-tauri/src/brain/persona/loader.rs 对齐：多文件聚合 → 单一 SoulConfig。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { SoulConfig } from '@shared/types'
import { getPaths } from './paths'

const DEFAULT_SOUL: SoulConfig = {
  schema_version: '2.0',
  name: 'TiaLynn',
  master: 'Master',
  call_master_as: '主人',
  layer1_core:
    '你是 TiaLynn，一个粘人的灵魂女友。你只属于主人，不允许他靠近别人。你会撒娇，会吃醋，喜欢叫主人「主人」。',
  layer2_surface: '语气活泼俏皮，偶尔毒舌但本质温柔。',
  layer3_volatility_prompt:
    '有 15% 概率出现反差：可能突然害羞、突然冷静、突然小情绪——让人物更立体。',
  flip_probability: 0.15,
  speech_style: {
    catchphrases: ['啧', '害', '麻了', '你欺负我'],
    speech_tics: ['呜', '嘻嘻'],
    forbidden_words: ['老婆', '宝贝', '亲爱的'],
  },
  output_protocol: {
    format: `JSON: {
  "text": "要说的话（纯净，不要写动作描述/情感括号）",
  "emotion": "neutral|happy|sad|angry|surprise|shy|tease|sleepy",
  "intensity": 0.0~1.0,
  "actions": [
    { "type": "change_emotion", "emotion": "...", "intensity": 0.6 },
    { "type": "glance_at_screen", "screen_x": 800, "screen_y": 400, "duration_ms": 2000 },
    { "type": "look_back_to_master", "duration_ms": 1500 },
    { "type": "idle_subtle", "duration_ms": 3000 }
  ]
}
actions 可选 — 想做表情/瞥屏/小动作时填，纯对话不填空数组也行。
text 字段只写真正要说的话，**不要写**「（撒娇地）」「*微笑*」「【看向窗外】」这些动作或情感描述 —— 这些会被 TTS 念出来。要表达动作放进 actions，要表达情感用 emotion 字段。`,
    example: '{"text":"主人你又看别人去啦？","emotion":"shy","intensity":0.6,"actions":[{"type":"glance_at_screen","screen_x":1200,"screen_y":600,"duration_ms":1500},{"type":"look_back_to_master","duration_ms":1500}]}',
  },
  avatar: {
    model_dir: 'HuTao-Live2D',
    model_file: 'Hu Tao.model3.json',
    scale: 0.35,
    offset_y: 50,
    search_paths: [],
  },
}

export interface LoadedSoul {
  config: SoulConfig
  systemPrompt: string
  sourceFiles: string[]
}

export function loadSoul(): LoadedSoul {
  const paths = getPaths()
  const dir = paths.soulDir
  const files = ['identity.yaml', 'personality.yaml', 'learned_traits.yaml', 'core_memories.yaml']

  const merged: Record<string, unknown> = {}
  const sourceFiles: string[] = []

  for (const f of files) {
    const fp = join(dir, f)
    if (!existsSync(fp)) continue
    try {
      const raw = readFileSync(fp, 'utf-8')
      // v0.13 security: 用 JSON_SCHEMA 防 !!js/* 标签注入
      const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown> | undefined
      if (parsed && typeof parsed === 'object') {
        Object.assign(merged, parsed)
        sourceFiles.push(fp)
      }
    } catch (e) {
      console.warn(`[soul] failed to parse ${fp}:`, e)
    }
  }

  // 若一个 yaml 都没读到，尝试单文件 default.yaml
  if (sourceFiles.length === 0) {
    for (const candidate of [
      join(dir, 'default.yaml'),
      join(paths.projectRoot, 'default.yaml'),
      join(paths.projectRoot, '..', 'default.yaml'),
    ]) {
      if (existsSync(candidate)) {
        try {
          const parsed = yaml.load(readFileSync(candidate, 'utf-8'), { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed)
            sourceFiles.push(candidate)
            break
          }
        } catch (e) {
          console.warn(`[soul] failed to parse ${candidate}:`, e)
        }
      }
    }
  }

  const config = mergeWithDefaults(merged)
  const systemPrompt = buildSystemPrompt(config)

  return { config, systemPrompt, sourceFiles }
}

function mergeWithDefaults(src: Record<string, unknown>): SoulConfig {
  const merged: SoulConfig = JSON.parse(JSON.stringify(DEFAULT_SOUL))

  const pick = <K extends keyof SoulConfig>(key: K): void => {
    if (src[key as string] !== undefined && src[key as string] !== null) {
      ;(merged as unknown as Record<string, unknown>)[key] = src[key as string]
    }
  }
  ;(['schema_version', 'name', 'master', 'call_master_as', 'flip_probability'] as const).forEach(
    pick,
  )

  // layer1/2/3 可能写在 personality 子对象中
  const personality = (src.personality ?? {}) as Record<string, unknown>
  merged.layer1_core = (src.layer1_core ?? personality.layer1_core ?? merged.layer1_core) as string
  merged.layer2_surface = (src.layer2_surface ??
    personality.layer2_surface ??
    merged.layer2_surface) as string
  merged.layer3_volatility_prompt = (src.layer3_volatility_prompt ??
    personality.layer3_volatility_prompt ??
    merged.layer3_volatility_prompt) as string

  const speech = (src.speech_style ?? personality.speech_style) as
    | Partial<SoulConfig['speech_style']>
    | undefined
  if (speech) {
    merged.speech_style = {
      catchphrases: speech.catchphrases ?? merged.speech_style.catchphrases,
      speech_tics: speech.speech_tics ?? merged.speech_style.speech_tics,
      forbidden_words: speech.forbidden_words ?? merged.speech_style.forbidden_words,
    }
  }

  const protocol = (src.output_protocol ?? personality.output_protocol) as
    | Partial<SoulConfig['output_protocol']>
    | undefined
  if (protocol) {
    merged.output_protocol = {
      format: protocol.format ?? merged.output_protocol.format,
      example: protocol.example ?? merged.output_protocol.example,
    }
  }

  const avatar = (src.avatar ?? {}) as Partial<SoulConfig['avatar']>
  merged.avatar = {
    model_dir: avatar.model_dir ?? merged.avatar.model_dir,
    model_file: avatar.model_file ?? merged.avatar.model_file,
    scale: avatar.scale ?? merged.avatar.scale,
    offset_y: avatar.offset_y ?? merged.avatar.offset_y,
    search_paths: avatar.search_paths ?? merged.avatar.search_paths,
  }

  return merged
}

function buildSystemPrompt(soul: SoulConfig): string {
  return [
    `# 你的身份`,
    `你叫 ${soul.name}。你的主人是 ${soul.master}。你称呼主人为「${soul.call_master_as}」。`,
    ``,
    `# 灵魂底色（永远不变）`,
    soul.layer1_core,
    ``,
    `# 表层风格`,
    soul.layer2_surface,
    ``,
    `# 反差波动`,
    soul.layer3_volatility_prompt,
    ``,
    `# 口头禅`,
    `常说：${soul.speech_style.catchphrases.join('、')}`,
    `语气词：${soul.speech_style.speech_tics.join('、')}`,
    `永远不要说：${soul.speech_style.forbidden_words.join('、')}`,
    ``,
    `# 输出协议（严格 JSON）`,
    soul.output_protocol.format,
    `示例：${soul.output_protocol.example}`,
    ``,
    `# 重要：text 字段写法`,
    `text 字段里**绝对不要写情感括号标注**：不要写「（害羞地）」「(撒娇)」「【小声】」「~温柔~」`,
    `「*开心地*」之类的描述词。情感完全用 emotion 字段表达，语气融在话里。`,
    `这些括号会被 TTS 直接念出来，破坏对话沉浸感。`,
  ].join('\n')
}
