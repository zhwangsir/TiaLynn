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
    // 完整 > 不完整，按显示名 alphabetical
    const ac = a.meta?.complete ? 0 : 1
    const bc = b.meta?.complete ? 0 : 1
    if (ac !== bc) return ac - bc
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
  complete: boolean
  reason?: string
}

/**
 * 解析 Cubism 4 settings (.model3.json) — 验证 moc + textures + motions 都到位。
 * 完整 = has_core (moc3 存在) && has_motions (至少 1 个 motion)
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
    const mocOk = !!mocPath && existsSync(mocPath)
    if (!mocOk) reasons.push('moc3 缺失')

    const texturesOk =
      Array.isArray(refs.Textures) &&
      refs.Textures.length > 0 &&
      refs.Textures.some((t) => existsSync(resolve(base, t)))
    if (!texturesOk) reasons.push('texture 缺失')

    let motionCount = 0
    if (refs.Motions && typeof refs.Motions === 'object') {
      for (const arr of Object.values(refs.Motions)) {
        if (Array.isArray(arr)) {
          for (const m of arr) {
            if (m.File && existsSync(resolve(base, m.File))) motionCount++
          }
        }
      }
    }
    if (motionCount === 0) reasons.push('无动作')

    const expressionCount =
      Array.isArray(refs.Expressions)
        ? refs.Expressions.filter((e) => e.File && existsSync(resolve(base, e.File))).length
        : 0

    const hasPhysics = !!refs.Physics && existsSync(resolve(base, refs.Physics))

    const hasCore = mocOk && texturesOk
    const hasMotions = motionCount > 0
    return {
      has_core: hasCore,
      has_motions: hasMotions,
      has_expressions: expressionCount > 0,
      has_physics: hasPhysics,
      motion_count: motionCount,
      expression_count: expressionCount,
      complete: hasCore && hasMotions,
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
      complete: false,
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
      complete: mocOk && texturesOk && motionCount > 0,
    }
  } catch {
    return {
      has_core: false,
      has_motions: false,
      has_expressions: false,
      has_physics: false,
      motion_count: 0,
      expression_count: 0,
      complete: false,
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
