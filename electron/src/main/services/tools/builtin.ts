/**
 * 内置工具 —— TiaLynn 第一批安全工具。
 *
 * 安全：fs.* 受白名单根限制（~/.tialynn + ~/Documents/TiaLynn 默认）。
 * 用户可在 settings 增加额外根（v0.7）。
 *
 * M7 创造统一（v0.21）：
 *   - 新增 creative.generate_sticker —— 让 LLM 在 dialog 路径里调 ComfyUI 出图。
 *     和 BehaviorPlanner 的 `generate_sticker` action 走同一个 workflow，
 *     但调用方是 dialog LLM 而不是 attention LLM。
 *   - 出图后 emit `comfyui:progress {kind:'sticker', state:'done'}` 给 renderer，
 *     StickerOverlay 自动浮在桌面上。
 */
import { Notification, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { register } from './registry'
import { getPaths } from '../paths'
import { ComfyClient, ComfyError } from '../comfyui/client'
import { buildStickerWorkflow } from '../comfyui/workflows'
import { loadConfig } from '../config-store'

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

/** ComfyUI client 单例（dialog tool 路径用，跟 ipc/comfyui.ts 各持一份生命周期独立） */
let toolComfyClient: ComfyClient | null = null
function getComfyClient(): ComfyClient {
  const cfg = loadConfig()
  const endpoint = cfg.comfyui_endpoint?.trim()
  if (!endpoint) {
    throw new ComfyError('ComfyUI endpoint 未配置（Settings → ComfyUI endpoint）')
  }
  if (!toolComfyClient || toolComfyClient.endpoint !== endpoint) {
    toolComfyClient = new ComfyClient({ endpoint })
  }
  return toolComfyClient
}

function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}

const VALID_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'tease',
  'sleepy',
  'surprise',
] as const
type StickerEmotion = (typeof VALID_EMOTIONS)[number]

function isValidEmotion(s: string): s is StickerEmotion {
  return (VALID_EMOTIONS as readonly string[]).includes(s)
}

/**
 * M7：注册 creative.generate_sticker 让 dialog LLM 主动出图。
 * 跟 BehaviorPlanner 的 `generate_sticker` action 复用 buildStickerWorkflow。
 * 生成后通过 webContents.send 给 renderer，StickerOverlay 自动浮窗。
 */
function registerCreativeTools(getWindow: () => BrowserWindow | null): void {
  register(
    {
      name: 'creative.generate_sticker',
      description:
        '画一张表情贴纸送主人（通过 ComfyUI）。当主人说想看你画的东西、或想给主人惊喜时调用。' +
        '生成后会自动浮在桌面上，不需要再额外发文件路径给主人。一次只生成 1 张。' +
        '调用频繁会让主人烦（每张需 6-30 秒），合适场景再用。',
      risk: 'medium',
      category: 'creative',
      input_schema: {
        type: 'object',
        properties: {
          emotion: {
            type: 'string',
            description: '贴纸主题情绪',
            enum: [...VALID_EMOTIONS],
          },
          extra_prompt: {
            type: 'string',
            description:
              '可选额外英文描述（如 "fireworks, celebration", "holding a gift", "starry night sky"）',
          },
        },
        required: ['emotion'],
      },
    },
    async (input) => {
      const emotionRaw = String(input.emotion ?? 'happy')
      if (!isValidEmotion(emotionRaw)) {
        throw new Error(
          `emotion 必须是 ${VALID_EMOTIONS.join(' / ')} 之一，收到：${emotionRaw}`,
        )
      }
      const emotion = emotionRaw
      const extraRaw = input.extra_prompt
      const extraPrompt =
        typeof extraRaw === 'string' && extraRaw.trim().length > 0 ? extraRaw.trim() : undefined

      const client = getComfyClient()
      const wf = buildStickerWorkflow({
        emotion,
        ...(extraPrompt !== undefined ? { extraPrompt } : {}),
      })

      // 通知 renderer 开始（让 StickerOverlay 知道有任务在跑，可显 spinner）
      const win0 = getWindow()
      if (win0 && !win0.isDestroyed()) {
        win0.webContents.send('comfyui:progress', { kind: 'sticker', state: 'queued', emotion })
      }

      const r = await client.generate(wf, {
        onProgress: (state) => {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('comfyui:progress', { kind: 'sticker', state, emotion })
          }
        },
      })

      // 下载到 ~/.tialynn/stickers/
      const destDir = ensureDir(join(getPaths().userDataDir, 'stickers'))
      const saved: string[] = []
      for (const img of r.images) {
        const fname = `sticker_${emotion}_${Date.now()}_${basename(img.filename)}`
        const dest = join(destDir, fname)
        try {
          await client.downloadImage(img.filename, img.subfolder, img.type, dest)
          saved.push(dest)
        } catch (e) {
          console.warn('[creative.generate_sticker] download skipped', img.filename, e)
        }
      }

      // emit done — StickerOverlay 会调 listRecent 拿最新一张浮窗
      const winEnd = getWindow()
      if (winEnd && !winEnd.isDestroyed()) {
        winEnd.webContents.send('comfyui:progress', { kind: 'sticker', state: 'done', emotion })
      }

      if (saved.length === 0) {
        throw new Error('ComfyUI 没返回任何图片')
      }
      const extraDesc = extraPrompt ? `(${extraPrompt})` : ''
      return `已画好一张「${emotion}」${extraDesc}贴纸送主人，已浮在桌面上 ❤️`
    },
  )
}

export function registerBuiltins(getWindow?: () => BrowserWindow | null): void {
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

  // M7：注册 creative.* 工具（需要 getWindow 才能 emit comfyui:progress 给 renderer）
  if (getWindow) {
    registerCreativeTools(getWindow)
  }
}
