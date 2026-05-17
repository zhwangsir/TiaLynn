/**
 * Live2D 模型缩略图缓存（v0.10）
 *
 * 目录：~/.tialynn/thumbs/<character_id>.webp
 * Renderer 后台 worker pool off-screen 渲染每个模型 → webp → IPC 写盘
 * UI 卡片直接 file:// 读
 *
 * 失败标记：<character_id>.failed（空文件，避免重复尝试）
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from './paths'

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 天过期重生成
const MAX_SIZE_BYTES = 500 * 1024 // 500KB 上限（webp 通常 < 50KB）

function thumbsDir(): string {
  const dir = join(getPaths().userDataDir, 'thumbs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** safeId: character_id 用作文件名 — 净化非法字符防路径遍历 */
function safeId(characterId: string): string {
  // character_id 形如 "char:a3f2..." 或 "dir:..."；只允许 [a-zA-Z0-9:_-]
  return characterId.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 100)
}

export interface ThumbInfo {
  exists: boolean
  /** file:// URL，UI 直接 <img :src> */
  url?: string
  size_bytes?: number
  age_ms?: number
  failed?: boolean
}

export function getThumb(characterId: string): ThumbInfo {
  if (!characterId) return { exists: false }
  const id = safeId(characterId)
  const dir = thumbsDir()
  const webp = join(dir, `${id}.webp`)
  const failed = join(dir, `${id}.failed`)

  if (existsSync(failed)) {
    const fst = statSync(failed)
    const age = Date.now() - fst.mtimeMs
    if (age < MAX_AGE_MS) return { exists: false, failed: true }
    try { unlinkSync(failed) } catch { /* skip */ }
  }

  if (!existsSync(webp)) return { exists: false }
  const st = statSync(webp)
  const age = Date.now() - st.mtimeMs
  if (age > MAX_AGE_MS) {
    try { unlinkSync(webp) } catch { /* skip */ }
    return { exists: false }
  }
  return {
    exists: true,
    url: `file://${webp.replace(/\\/g, '/')}`,
    size_bytes: st.size,
    age_ms: age,
  }
}

/** Renderer 渲染完成后调 — base64 webp 写盘 */
export function saveThumb(characterId: string, webpBase64: string): { ok: boolean; reason?: string } {
  if (!characterId) return { ok: false, reason: 'empty character_id' }
  const buf = Buffer.from(webpBase64, 'base64')
  if (buf.length === 0) return { ok: false, reason: 'empty data' }
  if (buf.length > MAX_SIZE_BYTES) {
    return { ok: false, reason: `太大 ${(buf.length / 1024).toFixed(0)}KB > ${MAX_SIZE_BYTES / 1024}KB` }
  }
  // webp 文件头：RIFF....WEBP
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return { ok: false, reason: '不是有效 WEBP' }
  }
  const id = safeId(characterId)
  const dir = thumbsDir()
  writeFileSync(join(dir, `${id}.webp`), buf)
  // 如果之前标记过失败，清掉
  const failed = join(dir, `${id}.failed`)
  if (existsSync(failed)) try { unlinkSync(failed) } catch { /* skip */ }
  return { ok: true }
}

export function markFailed(characterId: string, reason: string): void {
  if (!characterId) return
  const id = safeId(characterId)
  const failed = join(thumbsDir(), `${id}.failed`)
  writeFileSync(failed, reason.slice(0, 200))
}

/** 列出 character_ids 中尚未有缩略图的（用于 Renderer worker 调度） */
export function listMissing(characterIds: string[]): string[] {
  const dir = thumbsDir()
  const have = new Set<string>()
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.webp')) have.add(f.slice(0, -5))
    else if (f.endsWith('.failed')) have.add(f.slice(0, -7)) // failed 也算 "处理过"
  }
  return characterIds.filter((cid) => !have.has(safeId(cid)))
}

/** 清整个缓存（用户在设置里点「重新生成所有缩略图」） */
export function clearAll(): { deleted: number } {
  const dir = thumbsDir()
  let n = 0
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.webp') || f.endsWith('.failed')) {
      try {
        unlinkSync(join(dir, f))
        n++
      } catch { /* skip */ }
    }
  }
  return { deleted: n }
}
