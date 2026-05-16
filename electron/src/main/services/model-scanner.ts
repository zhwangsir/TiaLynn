/**
 * 扫描 Live2D 模型 —— 在 modelSearchPaths 下找所有 *.model3.json (Cubism 4) / *.model.json (Cubism 2)。
 *
 * v0.6.9: 解析每个 .model3.json 验证完整度（moc + textures + motions），
 * 只把"完整可用"的暴露给 UI 默认选项。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { ModelInfo } from '@shared/types'
import { getPaths } from './paths'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'out',
  'src',
  'src-tauri',
  'electron',
  'sidecar',
  'public',
  'docs',
  'scripts',
  'example_voice',
  'icons',
])

const MAX_DEPTH = 3

export function scanModels(): ModelInfo[] {
  const paths = getPaths()
  const results: ModelInfo[] = []
  const seen = new Set<string>()

  for (const root of paths.modelSearchPaths) {
    if (!existsSync(root)) continue
    walk(root, 0, (modelFile, modelDir, depth) => {
      const abs = join(modelDir, modelFile)
      if (seen.has(abs)) return
      seen.add(abs)
      const cubism = modelFile.endsWith('.model3.json') ? 'cubism4' : 'cubism2'
      const dirName = basename(modelDir)
      const source = root === paths.projectRoot ? 'builtin' : 'user'

      const meta = cubism === 'cubism4' ? probeModel3(abs) : probeModel2(abs)

      // builtin + 完整 → 推荐
      if (meta) meta.recommended = source === 'builtin' && meta.complete

      results.push({
        dir: dirName,
        model_file: modelFile,
        absolute_path: abs,
        source,
        cubism,
        display: dirName,
        root_id: `${source}:${depth}:${dirName}`,
        meta,
      })
    })
  }

  return results.sort((a, b) => {
    // 推荐 > 完整 > 不完整，组内按显示名 alphabetical
    const score = (m: ModelInfo): number => {
      if (m.meta?.recommended) return 0
      if (m.meta?.complete) return 1
      return 2
    }
    const sa = score(a)
    const sb = score(b)
    if (sa !== sb) return sa - sb
    return a.display.localeCompare(b.display)
  })
}

interface ModelMeta {
  has_core: boolean
  has_motions: boolean
  has_expressions: boolean
  has_physics: boolean
  motion_count: number
  expression_count: number
  moc_kb: number
  texture_kb: number
  complete: boolean
  recommended: boolean
  reason?: string
}

/** 过滤阈值：低于这些值通常是占位/不完整模型 */
const MIN_MOC_KB = 50
const MIN_TEXTURE_KB = 200
const MIN_MOTIONS = 1

/**
 * pixi-live2d-display 内部用 new URL(relPath, baseUrl) 解析资源，
 * `#` 会被 URL 标准当成 fragment 分隔符 → 路径被截断 → 加载失败。
 * 同理 `?` 是 search 分隔符。这种文件名我们无法用 file:// 加载。
 *
 * 检测引用字符串本身是否含这些字符（路径里有空格、中文 OK；只防 # 和 ?）。
 */
function isUrlSafe(ref: string): boolean {
  return !ref.includes('#') && !ref.includes('?')
}

/**
 * 解析 Cubism 4 settings (.model3.json) — 验证 moc + textures + motions 都到位。
 * 完整 = has_core (moc3 存在 + texture 引用全部 URL-safe) && has_motions
 */
function probeModel3(modelPath: string): ModelMeta {
  const reasons: string[] = []
  const base = dirname(modelPath)
  try {
    const raw = readFileSync(modelPath, 'utf-8')
    const json = JSON.parse(raw) as {
      FileReferences?: {
        Moc?: string
        Textures?: string[]
        Motions?: Record<string, Array<{ File?: string }>>
        Expressions?: Array<{ File?: string }>
        Physics?: string
      }
    }
    const refs = json.FileReferences ?? {}
    const mocPath = refs.Moc ? resolve(base, refs.Moc) : null
    const mocOk = !!mocPath && existsSync(mocPath) && (refs.Moc ? isUrlSafe(refs.Moc) : false)
    if (!mocOk) {
      if (refs.Moc && !isUrlSafe(refs.Moc)) reasons.push('moc 文件名含 # 或 ?')
      else reasons.push('moc3 缺失')
    }

    const mocKb = mocPath && existsSync(mocPath) ? Math.round(statSync(mocPath).size / 1024) : 0

    const textures = Array.isArray(refs.Textures) ? refs.Textures : []
    const hasAnyTexture = textures.length > 0 && textures.some((t) => existsSync(resolve(base, t)))
    const allTexturesUrlSafe = textures.every(isUrlSafe)
    const texturesOk = hasAnyTexture && allTexturesUrlSafe
    if (!hasAnyTexture) reasons.push('texture 缺失')
    else if (!allTexturesUrlSafe) reasons.push('texture 文件名含 # 或 ?')

    let textureKb = 0
    for (const t of textures) {
      const tp = resolve(base, t)
      if (existsSync(tp)) textureKb += Math.round(statSync(tp).size / 1024)
    }

    let motionCount = 0
    let motionsAllUrlSafe = true
    if (refs.Motions && typeof refs.Motions === 'object') {
      for (const arr of Object.values(refs.Motions)) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m.File && existsSync(resolve(base, m.File))) {
              if (!isUrlSafe(m.File)) motionsAllUrlSafe = false
              else motionCount++
            }
          }
        }
      }
    }
    if (motionCount === 0) reasons.push('无动作')
    if (!motionsAllUrlSafe) reasons.push('motion 文件名含 # 或 ?')

    const expressionCount =
      Array.isArray(refs.Expressions)
        ? refs.Expressions.filter(
            (e) => e.File && existsSync(resolve(base, e.File)) && isUrlSafe(e.File),
          ).length
        : 0

    const hasPhysics =
      !!refs.Physics && existsSync(resolve(base, refs.Physics)) && isUrlSafe(refs.Physics)

    if (mocKb > 0 && mocKb < MIN_MOC_KB) reasons.push(`moc3 仅 ${mocKb}KB（疑似占位）`)
    if (textureKb > 0 && textureKb < MIN_TEXTURE_KB) reasons.push(`texture 仅 ${textureKb}KB（疑似纯色块）`)

    const hasCore = mocOk && texturesOk
    const hasMotions = motionCount >= MIN_MOTIONS && motionsAllUrlSafe
    const sizesOk = mocKb >= MIN_MOC_KB && textureKb >= MIN_TEXTURE_KB
    const complete = hasCore && hasMotions && sizesOk
    return {
      has_core: hasCore,
      has_motions: hasMotions,
      has_expressions: expressionCount > 0,
      has_physics: hasPhysics,
      motion_count: motionCount,
      expression_count: expressionCount,
      moc_kb: mocKb,
      texture_kb: textureKb,
      complete,
      recommended: false, // 由 scanModels() 根据 source 标
      reason: reasons.length > 0 ? reasons.join('；') : undefined,
    }
  } catch (e) {
    return {
      has_core: false,
      has_motions: false,
      has_expressions: false,
      has_physics: false,
      motion_count: 0,
      expression_count: 0,
      moc_kb: 0,
      texture_kb: 0,
      complete: false,
      recommended: false,
      reason: `model3.json 解析失败: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * 解析 Cubism 2 settings (.model.json) — 简化：我们当前不支持 cubism2，
 * 但仍提供基本完整度判断，便于 UI 显示信息。
 */
function probeModel2(modelPath: string): ModelMeta {
  const base = dirname(modelPath)
  try {
    const raw = readFileSync(modelPath, 'utf-8')
    const json = JSON.parse(raw) as {
      model?: string
      textures?: string[]
      motions?: Record<string, Array<{ file?: string }>>
      expressions?: Array<{ file?: string }>
      physics?: string
    }
    const mocOk = !!json.model && existsSync(resolve(base, json.model))
    const texturesOk =
      Array.isArray(json.textures) &&
      json.textures.length > 0 &&
      json.textures.some((t) => existsSync(resolve(base, t)))
    let motionCount = 0
    if (json.motions) {
      for (const arr of Object.values(json.motions)) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m.file && existsSync(resolve(base, m.file))) motionCount++
          }
        }
      }
    }
    const expressionCount =
      Array.isArray(json.expressions)
        ? json.expressions.filter((e) => e.file && existsSync(resolve(base, e.file))).length
        : 0
    return {
      has_core: mocOk && texturesOk,
      has_motions: motionCount > 0,
      has_expressions: expressionCount > 0,
      has_physics: !!json.physics && existsSync(resolve(base, json.physics)),
      motion_count: motionCount,
      expression_count: expressionCount,
      moc_kb: 0,
      texture_kb: 0,
      complete: mocOk && texturesOk && motionCount > 0,
      recommended: false,
    }
  } catch {
    return {
      has_core: false,
      has_motions: false,
      has_expressions: false,
      has_physics: false,
      motion_count: 0,
      expression_count: 0,
      moc_kb: 0,
      texture_kb: 0,
      complete: false,
      recommended: false,
    }
  }
}

function walk(
  dir: string,
  depth: number,
  onFound: (modelFile: string, modelDir: string, depth: number) => void,
): void {
  if (depth > MAX_DEPTH) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  let foundHere = false
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isFile() && (entry.endsWith('.model3.json') || entry.endsWith('.model.json'))) {
      onFound(entry, dir, depth)
      foundHere = true
    }
  }

  if (foundHere) return

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        walk(full, depth + 1, onFound)
      }
    } catch {
      /* ignore */
    }
  }
}

export function toFileUrl(absolute: string): string {
  const normalized = absolute.split(sep).map(encodeURIComponent).join('/')
  return `file:///${normalized.replace(/^\//, '')}`
}
