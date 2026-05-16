/**
 * Tool 审批 policy 持久化 ~/.tialynn/tool-policy.json
 *
 * 用户在审批 dialog 选「永远允许」/「永远拒绝」时写入此文件。
 * 下次同名工具调用时主进程直接根据 policy 决定。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolPolicy } from '@shared/tools'
import { getPaths } from '../paths'

let cached: ToolPolicy | null = null

function path(): string {
  return join(getPaths().userDataDir, 'tool-policy.json')
}

export function load(): ToolPolicy {
  if (cached) return cached
  const p = path()
  if (existsSync(p)) {
    try {
      cached = JSON.parse(readFileSync(p, 'utf-8')) as ToolPolicy
      return cached
    } catch (e) {
      console.warn('[tool-policy] parse failed:', e)
    }
  }
  cached = {}
  return cached
}

export function setPolicy(toolName: string, decision: 'always_allow' | 'always_deny' | null): void {
  const p = load()
  if (decision === null) delete p[toolName]
  else p[toolName] = decision
  cached = p
  try {
    writeFileSync(path(), JSON.stringify(p, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[tool-policy] save failed:', e)
  }
}

export function get(toolName: string): 'always_allow' | 'always_deny' | undefined {
  return load()[toolName]
}

export function clearAll(): void {
  cached = {}
  try {
    writeFileSync(path(), '{}', 'utf-8')
  } catch (e) {
    console.warn('[tool-policy] clear failed:', e)
  }
}
