/**
 * 内置工具 —— TiaLynn 第一批安全工具。
 *
 * 安全：fs.* 受白名单根限制（~/.tialynn + ~/Documents/TiaLynn 默认）。
 * 用户可在 settings 增加额外根（v0.7）。
 */
import { Notification, shell } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { register } from './registry'
import { getPaths } from '../paths'

function allowedRoots(): string[] {
  const home = homedir()
  return [
    getPaths().userDataDir,
    join(home, 'Documents', 'TiaLynn'),
    // 项目根（dev 用）
    getPaths().projectRoot,
  ]
}

/** 把任意 path 解析为绝对 + 标准化，然后必须落在某个 allowed root 下 */
function safeResolve(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path 必须是非空字符串')
  }
  let expanded = input
  if (expanded.startsWith('~/')) expanded = join(homedir(), expanded.slice(2))
  const abs = isAbsolute(expanded) ? expanded : resolve(expanded)
  const normalized = normalize(abs)
  const roots = allowedRoots()
  const ok = roots.some((r) => normalized === r || normalized.startsWith(r + sep))
  if (!ok) {
    throw new Error(`拒绝访问：path 必须在以下根目录之一：\n${roots.join('\n')}`)
  }
  return normalized
}

export function registerBuiltins(): void {
  register(
    {
      name: 'fs.list_dir',
      description: '列出目录下的文件和子目录（最多 100 项）',
      risk: 'low',
      category: 'fs',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录绝对路径（~/ 会展开）' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const dir = safeResolve(input.path as string)
      if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`)
      const st = statSync(dir)
      if (!st.isDirectory()) throw new Error(`不是目录：${dir}`)
      const entries = readdirSync(dir).slice(0, 100)
      const lines = entries.map((name) => {
        try {
          const s = statSync(join(dir, name))
          return `${s.isDirectory() ? 'D' : 'F'}  ${name}  ${s.isFile() ? s.size + 'B' : ''}`
        } catch {
          return `?  ${name}`
        }
      })
      return `${dir}\n${lines.join('\n')}`
    },
  )

  register(
    {
      name: 'fs.read_file',
      description: '读取文本文件内容（最多 16KB；二进制不支持）',
      risk: 'low',
      category: 'fs',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const file = safeResolve(input.path as string)
      if (!existsSync(file)) throw new Error(`文件不存在：${file}`)
      const st = statSync(file)
      if (!st.isFile()) throw new Error(`不是文件：${file}`)
      if (st.size > 1024 * 1024) throw new Error(`文件超过 1MB，请用其他方式查看：${st.size} bytes`)
      return readFileSync(file, 'utf-8')
    },
  )

  register(
    {
      name: 'system.open_path',
      description: '用系统默认应用打开本地文件/文件夹',
      risk: 'medium',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要打开的路径' },
        },
        required: ['path'],
      },
    },
    async (input) => {
      const target = safeResolve(input.path as string)
      const err = await shell.openPath(target)
      if (err) throw new Error(err)
      return `已打开：${target}`
    },
  )

  register(
    {
      name: 'system.open_url',
      description: '在默认浏览器打开 URL（只允许 http/https）',
      risk: 'medium',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http/https URL' },
        },
        required: ['url'],
      },
    },
    async (input) => {
      const url = String(input.url ?? '')
      if (!/^https?:\/\//i.test(url)) throw new Error('只允许 http(s) URL')
      await shell.openExternal(url)
      return `已在浏览器打开：${url}`
    },
  )

  register(
    {
      name: 'system.notify',
      description: '发桌面通知',
      risk: 'low',
      category: 'system',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '通知标题' },
          body: { type: 'string', description: '通知正文' },
        },
        required: ['title'],
      },
    },
    async (input) => {
      const title = String(input.title ?? 'TiaLynn')
      const body = String(input.body ?? '')
      if (!Notification.isSupported()) throw new Error('当前系统不支持桌面通知')
      new Notification({ title, body }).show()
      return `已发送：${title}${body ? ' / ' + body : ''}`
    },
  )
}
