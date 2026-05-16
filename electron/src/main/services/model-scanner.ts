/**
 * 扫描 Live2D 模型 —— 在 modelSearchPaths 下找所有 *.model3.json (Cubism 4) / *.model.json (Cubism 2)。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
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
      results.push({
        dir: dirName,
        model_file: modelFile,
        absolute_path: abs,
        source,
        cubism,
        display: dirName,
        root_id: `${source}:${depth}:${dirName}`,
      })
    })
  }

  return results.sort((a, b) => a.display.localeCompare(b.display))
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

  if (foundHere) return // 找到模型的目录不再深入

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

/** 把绝对路径转成 renderer 用的 file:// URL。Electron renderer 直接消费。 */
export function toFileUrl(absolute: string): string {
  // Electron 在 macOS 也能读 file:// + 含空格（需要转义）
  const normalized = absolute.split(sep).map(encodeURIComponent).join('/')
  return `file:///${normalized.replace(/^\//, '')}`
}
