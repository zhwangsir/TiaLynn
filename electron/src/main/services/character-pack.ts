/**
 * Character Pack — 打包 / 解包单个 character 完整数据 (P5)。
 *
 * Pack 内容（zip 结构）:
 *   meta.json                     pack 版本 + 来源 character info
 *   soul/identity.yaml            身份
 *   soul/personality.yaml         三层人格
 *   soul/learned_traits.yaml      [可选] 学习的偏好
 *   soul/core_memories.yaml       [可选] 关键回忆
 *   preferences.json              UI 偏好 (scale / offset_y)
 *   emotional-state.json          [可选] 情感状态 (含 topic_imprints / mood_history)
 *   thumb.webp                    [可选] 缩略图
 *
 * 不包含: history.sqlite (隐私敏感 — 用户隐式同意才能含；当前默认不含)
 *
 * 用例:
 *   - 用户分享自己调教好的 character 给朋友
 *   - 跨机器迁移 character (备份恢复)
 *   - 角色市场分发（社区分享 soul + 美化好的 emotional baseline）
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { Character } from '@shared/character'
import {
  charactersRoot,
  characterDir,
  characterSoulDir,
  characterPreferencesPath,
  createCharacter,
  getCharacter,
} from './character-store'

export const CHARACTER_PACK_VERSION = '1.0'

export interface CharacterPackMeta {
  version: string
  exported_at: number
  source_id: string
  source_name: string
  /** 创建时的 TiaLynn 版本，便于将来兼容性判断 */
  app_version?: string
  /** 包含的可选模块 */
  contents: {
    soul: boolean
    preferences: boolean
    emotional: boolean
    thumb: boolean
  }
}

export interface ExportOptions {
  /** 是否含 emotional state (默认 true) */
  includeEmotional?: boolean
  /** 是否含 thumb (默认 true) */
  includeThumb?: boolean
  appVersion?: string
}

export interface ExportResult {
  ok: boolean
  buffer?: Buffer
  meta?: CharacterPackMeta
  reason?: string
}

export interface ImportOptions {
  /** 新 character 名 (覆盖 pack 中的 source_name) */
  newName?: string
  /** 是否导入 emotional state (默认 true) */
  includeEmotional?: boolean
}

export interface ImportResult {
  ok: boolean
  character?: Character
  reason?: string
}

/** 打包指定 character → Buffer (zip) */
export function exportCharacterPack(
  characterId: string,
  opts: ExportOptions = {},
): ExportResult {
  const c = getCharacter(characterId)
  if (!c) return { ok: false, reason: 'character not found' }

  const dir = characterDir(characterId)
  if (!existsSync(dir)) return { ok: false, reason: 'character dir missing' }

  const zip = new AdmZip()

  // 1. soul/*.yaml
  let soulIncluded = false
  const soulDir = characterSoulDir(characterId)
  if (existsSync(soulDir)) {
    for (const f of readdirSync(soulDir)) {
      if (!/\.ya?ml$/i.test(f)) continue
      const buf = readFileSync(join(soulDir, f))
      zip.addFile(`soul/${f}`, buf)
      soulIncluded = true
    }
  }

  // 2. preferences.json
  let prefsIncluded = false
  const prefsPath = characterPreferencesPath(characterId)
  if (existsSync(prefsPath)) {
    zip.addFile('preferences.json', readFileSync(prefsPath))
    prefsIncluded = true
  }

  // 3. emotional-state.json (可选)
  let emotionalIncluded = false
  if (opts.includeEmotional !== false) {
    const esPath = join(dir, 'emotional-state.json')
    if (existsSync(esPath)) {
      zip.addFile('emotional-state.json', readFileSync(esPath))
      emotionalIncluded = true
    }
  }

  // 4. thumb (可选) — 缩略图在 thumbs 目录而非 character dir
  let thumbIncluded = false
  if (opts.includeThumb !== false) {
    // 缩略图位置见 thumb-store: ~/.tialynn/thumbs/<character_id>.webp
    const thumbPath = join(charactersRoot(), '..', 'thumbs', `${characterId}.webp`)
    if (existsSync(thumbPath)) {
      zip.addFile('thumb.webp', readFileSync(thumbPath))
      thumbIncluded = true
    }
  }

  // 5. meta.json
  const meta: CharacterPackMeta = {
    version: CHARACTER_PACK_VERSION,
    exported_at: Date.now(),
    source_id: characterId,
    source_name: c.name,
    ...(opts.appVersion ? { app_version: opts.appVersion } : {}),
    contents: {
      soul: soulIncluded,
      preferences: prefsIncluded,
      emotional: emotionalIncluded,
      thumb: thumbIncluded,
    },
  }
  zip.addFile('meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'))

  return { ok: true, buffer: zip.toBuffer(), meta }
}

/** 解包 → 创建新 character */
export function importCharacterPack(
  buffer: Buffer,
  opts: ImportOptions = {},
): ImportResult {
  let zip: AdmZip
  try {
    zip = new AdmZip(buffer)
  } catch (e) {
    return { ok: false, reason: `不是有效的 zip: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 1. 读 meta.json
  const metaEntry = zip.getEntry('meta.json')
  if (!metaEntry) return { ok: false, reason: 'meta.json 缺失（不是 character pack）' }
  let meta: CharacterPackMeta
  try {
    meta = JSON.parse(metaEntry.getData().toString('utf-8'))
  } catch (e) {
    return { ok: false, reason: `meta.json 解析失败: ${e}` }
  }
  if (!meta.version || !meta.source_name) {
    return { ok: false, reason: 'meta 缺 version 或 source_name' }
  }

  // 2. 读 soul/identity.yaml 拿 live2d 配置
  const identityEntry = zip.getEntry('soul/identity.yaml')
  if (!identityEntry) {
    return { ok: false, reason: 'soul/identity.yaml 缺失（无法确定 live2d 模型）' }
  }
  const identityRaw = identityEntry.getData().toString('utf-8')
  // 简易 yaml 解析: 只拉关键 line（不引 js-yaml 避免循环 import）
  // 真实场景调用方应该用 js-yaml 解析，这里只需要 model_dir / model_file
  const modelDirMatch = identityRaw.match(/model_dir:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
  const modelFileMatch = identityRaw.match(/model_file:\s*['"]?([^'"\n]+?)['"]?\s*$/m)
  const callMasterMatch = identityRaw.match(/call_master_as:\s*['"]?([^'"\n]+?)['"]?\s*$/m)

  // 3. 创建新 character (自动生成新 id 避免与现有冲突)
  const newName = opts.newName ?? meta.source_name
  let created: Character
  try {
    created = createCharacter({
      name: newName,
      call_master_as: callMasterMatch?.[1] ?? '主人',
      live2d_model_dir: modelDirMatch?.[1] ?? 'HuTao-Live2D',
      live2d_model_file: modelFileMatch?.[1] ?? 'Hu Tao.model3.json',
      // template 用 'custom' (SoulTemplate 不含 'imported')；createCharacter 会先写
      // 一份合成 soul，下面 step 4 会被 pack 内真实 soul/*.yaml 覆盖
      template: 'custom',
    })
  } catch (e) {
    return { ok: false, reason: `创建 character 失败: ${e}` }
  }

  // 4. 写 soul/*.yaml (覆盖 createCharacter 写入的合成 soul)
  const soulDir = characterSoulDir(created.id)
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith('soul/') && /\.ya?ml$/i.test(entry.entryName)) {
      const filename = entry.entryName.slice('soul/'.length)
      writeFileSync(join(soulDir, filename), entry.getData())
    }
  }

  // 5. 写 preferences.json (覆盖默认)
  const prefsEntry = zip.getEntry('preferences.json')
  if (prefsEntry) {
    writeFileSync(characterPreferencesPath(created.id), prefsEntry.getData())
  }

  // 6. 写 emotional-state.json (可选)
  if (opts.includeEmotional !== false) {
    const esEntry = zip.getEntry('emotional-state.json')
    if (esEntry) {
      try {
        // 反序列化 + 重写 character_id（防 source id 残留）
        const es = JSON.parse(esEntry.getData().toString('utf-8'))
        es.character_id = created.id
        writeFileSync(
          join(characterDir(created.id), 'emotional-state.json'),
          JSON.stringify(es, null, 2),
        )
      } catch (e) {
        console.warn('[character-pack] emotional-state import failed (skipped):', e)
      }
    }
  }

  // 7. thumb (可选 — 写到 thumbs 目录)
  const thumbEntry = zip.getEntry('thumb.webp')
  if (thumbEntry) {
    const thumbDir = join(charactersRoot(), '..', 'thumbs')
    // ensureDir
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      fs.mkdirSync(thumbDir, { recursive: true })
      fs.writeFileSync(join(thumbDir, `${created.id}.webp`), thumbEntry.getData())
    } catch (e) {
      console.warn('[character-pack] thumb import failed (skipped):', e)
    }
  }

  return { ok: true, character: created }
}
