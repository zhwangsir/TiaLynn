/**
 * 把 soul 配置改动写回 ~/.tialynn/soul/<file>.yaml。
 *
 * 策略：avatar 字段写到 identity.yaml（如果不存在则创建）；
 * 不破坏文件里的其他字段（merge-then-write）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import type { SoulConfig } from '@shared/types'
import { getPaths } from './paths'

type Mutable = Record<string, unknown>

/** 把 partial avatar 写回 identity.yaml（用户数据目录优先） */
export function saveAvatar(avatar: Partial<SoulConfig['avatar']>): { ok: boolean; path: string; reason?: string } {
  const paths = getPaths()
  // 用户数据目录优先，源 soulDir 是 fallback
  const targetDir = join(paths.userDataDir, 'soul')
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const targetFile = join(targetDir, 'identity.yaml')

  let current: Mutable = {}
  if (existsSync(targetFile)) {
    try {
      const raw = readFileSync(targetFile, 'utf-8')
      // v0.13 security: JSON_SCHEMA 防 !!js/* 注入
      const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA })
      if (parsed && typeof parsed === 'object') current = parsed as Mutable
    } catch (e) {
      return { ok: false, path: targetFile, reason: `parse failed: ${String(e)}` }
    }
  }

  const prevAvatar = (current.avatar ?? {}) as Mutable
  const nextAvatar: Mutable = { ...prevAvatar, ...avatar }
  const next: Mutable = { ...current, avatar: nextAvatar }

  try {
    const dir = dirname(targetFile)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(targetFile, yaml.dump(next, { indent: 2, lineWidth: 100 }), 'utf-8')
    return { ok: true, path: targetFile }
  } catch (e) {
    return { ok: false, path: targetFile, reason: String(e) }
  }
}
