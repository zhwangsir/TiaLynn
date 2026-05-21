/**
 * 内置工具 —— TiaLynn 第一批安全工具。
 *
 * 安全：fs.* 受白名单根限制（~/.tialynn + ~/Documents/TiaLynn 默认）。
 * 用户可在 settings 增加额外根（v0.7）。
 *
 * M7 创造统一（v0.21）：
 *   - 新增 creative_generate_sticker —— 让 LLM 在 dialog 路径里调 ComfyUI 出图。
 *     和 BehaviorPlanner 的 `generate_sticker` action 走同一个 workflow，
 *     但调用方是 dialog LLM 而不是 attention LLM。
 *   - 出图后 emit `comfyui:progress {kind:'sticker', state:'done'}` 给 renderer，
 *     StickerOverlay 自动浮在桌面上。
 */
import { Notification, shell, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { register } from './registry'
import { ensureDir, getPaths } from '../paths'
import { getSharedComfyClient } from '../comfyui/client'
import { buildStickerWorkflow, type StickerParams } from '../comfyui/workflows'
import { addMemoryForActive } from '../memory-store'

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

// v0.21:ComfyClient 单例 + ensureDir 全部来自 services/comfyui/client + paths
// 不再本地各持一份(消重 + 解决 endpoint 切换时 stale 问题)

/**
 * Reviewer HIGH-1: 派生自 StickerParams['emotion'] —— workflows.ts 加新 emotion 时
 * TypeScript 立刻报错;不再手写 8 个字符串可能 drift。
 */
type StickerEmotion = StickerParams['emotion']
const VALID_EMOTIONS: readonly StickerEmotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'shy',
  'tease',
  'sleepy',
  'surprise',
] as const
// 编译期保险:若 StickerParams 加新 emotion,下面 satisfies 强制 VALID_EMOTIONS 覆盖完整
// (TS 看不出"缺哪个",但 StickerEmotion[] 是 union 类型,完整集合即可通过)
const _emotionExhaustiveCheck: ReadonlyArray<StickerEmotion> = VALID_EMOTIONS
void _emotionExhaustiveCheck

function isValidEmotion(s: string): s is StickerEmotion {
  return (VALID_EMOTIONS as readonly string[]).includes(s)
}

/**
 * M7：注册 creative_generate_sticker 让 dialog LLM 主动出图。
 * 跟 BehaviorPlanner 的 `generate_sticker` action 复用 buildStickerWorkflow。
 * 生成后通过 webContents.send 给 renderer，StickerOverlay 自动浮窗。
 */
function registerCreativeTools(getWindow: () => BrowserWindow | null): void {
  register(
    {
      name: 'creative_generate_sticker',
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

      const client = getSharedComfyClient()
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
          console.warn('[creative_generate_sticker] download skipped', img.filename, e)
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

      // v0.21 Round D:M7 闭环 — 写 per-character memory.db,让 LLM 在下次
      // 对话能回忆"我画过什么"。
      //
      // ⚠️ v0.21 当前限制(reviewer MEDIUM-2):embedding 用空数组占位,
      // memory-store.searchMemories 计算 cosine 时 length 不等返 0,
      // 该条 event 记忆**对 RAG 不可检索**,只供 listMemories UI 展示。
      // M7 "LLM 回忆画过什么"的目标实质上在 v0.22 加 embedding endpoint 调用后
      // 才会真正成立。当前不破坏,日后修补即可。
      //
      // importance 0.6 中高:创作行为相对稀疏(30 分钟最多 1-2 次),每次值得记。
      // (TODO v0.22:抽 MEMORY_IMPORTANCE_CREATIVE 常量;reviewer LOW-1)
      // (TODO v0.22:同 emotion 重复画去重;当前无 RAG 影响,留 reviewer LOW-2)
      try {
        const memResult = addMemoryForActive({
          kind: 'event',
          text: `我画了一张「${emotion}」${extraDesc}贴纸送给主人,已浮在桌面上`,
          embedding: [],
          importance: 0.6,
          source: 'creative_generate_sticker',
        })
        // reviewer MEDIUM-1:addMemoryForActive 无 active character 时返 null
        // 不抛错,try/catch 触发不到 — 显式日志保可观测性
        if (!memResult) {
          console.warn(
            '[creative_generate_sticker] no active character, memory write skipped',
          )
        }
      } catch (e) {
        // 写记忆失败不影响主流程,只警告(addMemory 内部 SQLite 错才会到这里)
        console.warn('[creative_generate_sticker] memory 写入失败:', e)
      }

      return `已画好一张「${emotion}」${extraDesc}贴纸送主人，已浮在桌面上 ❤️`
    },
  )
}

/**
 * Reviewer MEDIUM-5: getWindow 必选 — creative tools 是 always-on,
 * 若调用方忘传会静默不注册,排错成本高。强制传入避免静默失效。
 */
export function registerBuiltins(getWindow: () => BrowserWindow | null): void {
  register(
    {
      name: 'fs_list_dir',
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
      name: 'fs_read_file',
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
      name: 'system_open_path',
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
      name: 'system_open_url',
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
      name: 'system_notify',
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

  // M7：注册 creative.* 工具（getWindow 必传,见函数签名 doc）
  registerCreativeTools(getWindow)
}
