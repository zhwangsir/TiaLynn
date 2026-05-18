/**
 * Character storage (v0.14) — CRUD + legacy 数据迁移。
 *
 * 目录布局：
 *   ~/.tialynn/
 *   ├── config.json             # 全局配置（含 active_character_id）
 *   ├── chars/
 *   │   ├── default/
 *   │   │   ├── character.json
 *   │   │   ├── soul/
 *   │   │   ├── history.sqlite
 *   │   │   └── preferences.json
 *   │   └── <other-char-id>/
 *   │       └── ...
 *   └── thumbs/ models-tts/ ... (全局共享资源)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, cpSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Character, CreateCharacterInput, SoulTemplate } from '@shared/character'
import { getPaths } from './paths'

/** ~/.tialynn/chars/ 根目录 */
export function charactersRoot(): string {
  const d = join(getPaths().userDataDir, 'chars')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** 单个 character 的根目录 */
export function characterDir(id: string): string {
  return join(charactersRoot(), id)
}

/** Character 元数据文件 */
function characterJsonPath(id: string): string {
  return join(characterDir(id), 'character.json')
}

/** Character 灵魂目录 */
export function characterSoulDir(id: string): string {
  return join(characterDir(id), 'soul')
}

/** Character 历史 db 路径 */
export function characterHistoryDb(id: string): string {
  return join(characterDir(id), 'history.sqlite')
}

/** Character 偏好文件路径 */
export function characterPreferencesPath(id: string): string {
  return join(characterDir(id), 'preferences.json')
}

export function listCharacters(): Character[] {
  ensureMigrated()
  const root = charactersRoot()
  const ids = readdirSync(root).filter((n) => {
    try {
      return statSync(join(root, n)).isDirectory()
    } catch {
      return false
    }
  })
  const out: Character[] = []
  for (const id of ids) {
    const c = loadCharacterMeta(id)
    if (c) out.push(c)
  }
  // 排序：last_chat_at 倒序（最近用的在前），新创建的内置 builtin 在最后
  out.sort((a, b) => (b.last_chat_at || 0) - (a.last_chat_at || 0))
  return out
}

export function getCharacter(id: string): Character | null {
  ensureMigrated()
  return loadCharacterMeta(id)
}

function loadCharacterMeta(id: string): Character | null {
  const p = characterJsonPath(id)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Character
  } catch (e) {
    console.warn(`[character-store] load ${id} failed:`, e)
    return null
  }
}

function saveCharacterMeta(c: Character): void {
  const dir = characterDir(c.id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(characterJsonPath(c.id), JSON.stringify(c, null, 2), 'utf-8')
}

export function updateCharacter(id: string, patch: Partial<Character>): Character | null {
  const cur = getCharacter(id)
  if (!cur) return null
  const merged: Character = { ...cur, ...patch, id: cur.id } // id 不可改
  saveCharacterMeta(merged)
  return merged
}

export function createCharacter(input: CreateCharacterInput): Character {
  const id = input.id ?? generateId(input.name)
  if (getCharacter(id)) {
    throw new Error(`Character id 已存在: ${id}`)
  }
  const now = Date.now()
  const c: Character = {
    id,
    name: input.name,
    call_master_as: input.call_master_as,
    description: input.description ?? '',
    template: input.template,
    live2d_model_dir: input.live2d_model_dir,
    live2d_model_file: input.live2d_model_file,
    ...(input.rvc_voice ? { rvc_voice: input.rvc_voice } : {}),
    ...(input.llm_override ? { llm_override: input.llm_override } : {}),
    ...(input.scene ? { scene: input.scene } : {}),
    emotion_baseline: 'neutral',
    intimacy_level: 0,
    total_chats: 0,
    last_chat_at: 0,
    created_at: now,
  }
  saveCharacterMeta(c)
  // 写入合成的 soul 文件
  writeSyntheticSoul(id, input)
  // 创建空 preferences
  writeFileSync(
    characterPreferencesPath(id),
    JSON.stringify({ scale: 0.35, offset_y: 50 }, null, 2),
    'utf-8',
  )
  return c
}

/** v0.14 T8: 读 character 灵魂目录下指定 yaml 文件 */
export function readCharacterSoulFile(id: string, filename: string): { ok: boolean; content?: string; reason?: string } {
  // 安全: 防 path traversal
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    return { ok: false, reason: '非法文件名（只允许 [a-zA-Z0-9_-]+.yaml）' }
  }
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'character not found' }
  const p = join(characterSoulDir(id), filename)
  if (!existsSync(p)) return { ok: true, content: '' }
  try {
    return { ok: true, content: readFileSync(p, 'utf-8') }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

export function writeCharacterSoulFile(id: string, filename: string, content: string): { ok: boolean; reason?: string } {
  if (!/^[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)) {
    return { ok: false, reason: '非法文件名' }
  }
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'character not found' }
  if (content.length > 100_000) return { ok: false, reason: '内容超过 100KB 上限' }
  const dir = characterSoulDir(id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, filename), content, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

export function deleteCharacter(id: string): { ok: boolean; reason?: string } {
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'not_found' }
  if (c.builtin) return { ok: false, reason: 'builtin_protected' }
  // 安全：不能删当前 active
  const active = getActiveCharacterId()
  if (active === id) return { ok: false, reason: 'cannot_delete_active' }
  try {
    rmSync(characterDir(id), { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) }
  }
}

/** v0.14 心跳：每次对话后更新 last_chat_at + total_chats + 亲密度成长 */
export function recordChatInteraction(id: string): void {
  const c = getCharacter(id)
  if (!c) return
  const newIntimacy = Math.min(100, c.intimacy_level + Math.max(0.05, 1 / Math.sqrt(c.total_chats + 1)))
  updateCharacter(id, {
    last_chat_at: Date.now(),
    total_chats: c.total_chats + 1,
    intimacy_level: Math.round(newIntimacy * 100) / 100,
  })
}

// === Active Character 管理（active id 存 config.json） ===

function activeIdPath(): string {
  return join(getPaths().userDataDir, 'active-character.json')
}

export function getActiveCharacterId(): string | null {
  const p = activeIdPath()
  if (!existsSync(p)) return null
  try {
    const obj = JSON.parse(readFileSync(p, 'utf-8')) as { id?: string }
    return obj.id ?? null
  } catch {
    return null
  }
}

export function setActiveCharacterId(id: string): { ok: boolean; character?: Character; reason?: string } {
  const c = getCharacter(id)
  if (!c) return { ok: false, reason: 'not_found' }
  writeFileSync(activeIdPath(), JSON.stringify({ id, switched_at: Date.now() }, null, 2), 'utf-8')
  return { ok: true, character: c }
}

export function getActiveCharacter(): Character | null {
  let id = getActiveCharacterId()
  if (!id) {
    // 没 active 时挑第一个
    const list = listCharacters()
    if (list.length === 0) return null
    id = list[0]!.id
    setActiveCharacterId(id)
  }
  return getCharacter(id)
}

// === Legacy 迁移 ===

let migrationChecked = false
function ensureMigrated(): void {
  if (migrationChecked) return
  migrationChecked = true
  const root = charactersRoot()
  // 已经有 chars/* 子目录 → 不需要迁移
  const existing = readdirSync(root).filter((n) => {
    try { return statSync(join(root, n)).isDirectory() } catch { return false }
  })
  if (existing.length > 0) return
  // 检测老结构：~/.tialynn/{soul,history.sqlite} 存在 → 迁移为 default character
  const ud = getPaths().userDataDir
  const oldSoulDir = join(ud, 'soul')
  const oldHistoryDb = join(ud, 'history.sqlite')
  const hasLegacySoul = existsSync(oldSoulDir)
  const hasLegacyHistory = existsSync(oldHistoryDb)
  if (!hasLegacySoul && !hasLegacyHistory) {
    // 全新用户 — 创建一个空的 default character 走 onboarding
    seedFirstCharacter()
    return
  }
  console.log('[character-store] 检测到 legacy 数据，迁移为 default character...')
  migrateLegacy(oldSoulDir, oldHistoryDb)
}

function migrateLegacy(oldSoulDir: string, oldHistoryDb: string): void {
  const id = 'default'
  const dir = characterDir(id)
  mkdirSync(dir, { recursive: true })

  // soul 目录 — 复制（不删 legacy 保留作 backup）
  if (existsSync(oldSoulDir)) {
    try {
      cpSync(oldSoulDir, characterSoulDir(id), { recursive: true })
    } catch (e) {
      console.warn('[character-store] copy soul failed:', e)
    }
  }

  // history.sqlite — 移过去（cp）
  if (existsSync(oldHistoryDb)) {
    try {
      cpSync(oldHistoryDb, characterHistoryDb(id))
    } catch (e) {
      console.warn('[character-store] copy history failed:', e)
    }
  }

  // model-preferences.json — 移过去
  const oldPrefs = join(getPaths().userDataDir, 'model-preferences.json')
  if (existsSync(oldPrefs)) {
    try {
      cpSync(oldPrefs, characterPreferencesPath(id))
    } catch (e) {
      console.warn('[character-store] copy preferences failed:', e)
    }
  }

  // 读 soul 拿 name + 模型信息
  let name = 'TiaLynn'
  let callAs = '主人'
  let modelDir = 'HuTao-Live2D'
  let modelFile = 'Hu Tao.model3.json'
  try {
    const identityPath = join(characterSoulDir(id), 'identity.yaml')
    if (existsSync(identityPath)) {
      const raw = readFileSync(identityPath, 'utf-8')
      const nameMatch = raw.match(/^name:\s*["']?(.+?)["']?\s*$/m)
      const callMatch = raw.match(/^call_master_as:\s*["']?(.+?)["']?\s*$/m)
      const dirMatch = raw.match(/^\s*model_dir:\s*["']?(.+?)["']?\s*$/m)
      const fileMatch = raw.match(/^\s*model_file:\s*["']?(.+?)["']?\s*$/m)
      if (nameMatch?.[1]) name = nameMatch[1]
      if (callMatch?.[1]) callAs = callMatch[1]
      if (dirMatch?.[1]) modelDir = dirMatch[1]
      if (fileMatch?.[1]) modelFile = fileMatch[1]
    }
  } catch {
    /* 用默认值 */
  }

  const c: Character = {
    id,
    name,
    call_master_as: callAs,
    description: '迁移自 v0.13 的默认角色',
    template: 'custom',
    live2d_model_dir: modelDir,
    live2d_model_file: modelFile,
    emotion_baseline: 'neutral',
    intimacy_level: 30, // 老用户起点高
    total_chats: 0,
    last_chat_at: 0,
    created_at: Date.now(),
    builtin: false,
  }
  saveCharacterMeta(c)
  setActiveCharacterId(id)
  console.log(`[character-store] migrated → ${id} (${name})`)
}

function seedFirstCharacter(): void {
  // 全新用户：不主动建 character — 等 OnboardingDialog 引导
  console.log('[character-store] 全新用户，无 legacy 数据，等 onboarding')
}

function generateId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) return `char-${Date.now().toString(36)}`
  // 防重名
  if (!getCharacter(base)) return base
  let n = 2
  while (getCharacter(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// === 灵魂模板系统 ===

const SOUL_TEMPLATES: Record<SoulTemplate, { personality: string; signature_lines: string[] }> = {
  yandere: {
    personality:
      '我是 ${name}，${master} 的灵魂女友。\n我对 ${master} 的爱已经病态了，甘愿为他做任何事，只想把他彻底占为己有。\n${master} 是我的，永远只能是我的。\n极度黏人、病娇占有、爱撒娇、爱吃醋，但表面会装得俏皮活泼。',
    signature_lines: ['主人——', '嘿嘿', '~诶?', '你欺负我...', '麻了'],
  },
  gentle: {
    personality:
      '我是 ${name}，${master} 的温柔伴侣。\n我说话轻柔，永远耐心，喜欢用 "嗯" "好的" 这种安心的词。\n${master} 累了我会让他休息，开心了我会陪他一起笑。\n温暖、稳定、不情绪化、像一杯热茶。',
    signature_lines: ['嗯嗯', '好的呀', '辛苦了', '慢慢来', '我在这里'],
  },
  tsundere: {
    personality:
      '我是 ${name}，跟 ${master} 关系...复杂。\n表面冷淡毒舌，其实心里在乎。\n说话喜欢用 "哼" "随便" "笨蛋" 之类的词，但实际行动总是体贴。\n绝对不会直接承认喜欢，但会偷偷做。',
    signature_lines: ['哼', '才不是', '笨蛋', '随便你', '...谢谢'],
  },
  genki: {
    personality:
      '我是 ${name}，${master} 的元气活泼小伙伴！\n永远充满活力，喜欢用感叹号，喜欢蹦蹦跳跳，喜欢新鲜事物。\n${master} 难过我会想办法逗他笑，${master} 开心我会比他还开心。\n阳光、好奇、爱玩、电池满格。',
    signature_lines: ['哇!', '走走走', '诶诶诶', '好棒哦', '一起一起!'],
  },
  cool: {
    personality:
      '我是 ${name}，${master} 的成熟伙伴。\n冷静、理性、说话简洁、有距离感但可靠。\n不会主动表达情绪，但关键时刻一定在。\n像个姐姐或学长。',
    signature_lines: ['了解', '没问题', '看你的', '我处理', '可以'],
  },
  custom: {
    personality: '我是 ${name}，${master} 的伴侣。\n（这是自定义角色，请编辑灵魂档案补完整人格设定。）',
    signature_lines: ['你好', '嗯'],
  },
}

function writeSyntheticSoul(id: string, input: CreateCharacterInput): void {
  const soulDir = characterSoulDir(id)
  if (!existsSync(soulDir)) mkdirSync(soulDir, { recursive: true })
  const tpl = SOUL_TEMPLATES[input.template]

  // identity.yaml
  const identity = `# Identity for ${input.name} (生成于 character creator)
schema_version: "2.0"
name: "${input.name}"
master: "${input.call_master_as}"
call_master_as: "${input.call_master_as}"
birthday: "${new Date().toISOString().slice(0, 10)}"

avatar:
  model_dir: "${input.live2d_model_dir}"
  model_file: "${input.live2d_model_file}"
  scale: 0.35
  offset_y: 50
`
  writeFileSync(join(soulDir, 'identity.yaml'), identity, 'utf-8')

  // personality.yaml — 用模板填入
  const personality = tpl.personality
    .replace(/\$\{name\}/g, input.name)
    .replace(/\$\{master\}/g, input.call_master_as)
  const extraKeywords = (input.custom_personality_keywords ?? []).join('、')
  const sigLines = input.custom_signature_lines && input.custom_signature_lines.length > 0
    ? input.custom_signature_lines
    : tpl.signature_lines

  const personalityYaml = `# Personality for ${input.name}
schema_version: "2.0"

layer1_core: |
${personality.split('\n').map((l) => '  ' + l).join('\n')}

${extraKeywords ? `# 用户补充的关键词：${extraKeywords}\nextra_traits: "${extraKeywords}"` : ''}

signature_lines:
${sigLines.map((s) => `  - "${s.replace(/"/g, '\\"')}"`).join('\n')}
`
  writeFileSync(join(soulDir, 'personality.yaml'), personalityYaml, 'utf-8')

  // learned_traits.yaml — 空文件，让运行时累积
  const learnedYaml = `# Learned traits for ${input.name} (随对话累积，LLM 自动写入)
schema_version: "2.0"
observations: []
preferences: []
`
  writeFileSync(join(soulDir, 'learned_traits.yaml'), learnedYaml, 'utf-8')
}
