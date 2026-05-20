/**
 * ComfyUI IPC handlers — Phase 2「创作工坊」
 *
 * Renderer 可调能力：
 *   - comfyui:status                          探活
 *   - comfyui:list-checkpoints                动态列 ComfyUI 当前 checkpoint
 *   - comfyui:list-loras                      列 LoRA
 *   - comfyui:list-samplers                   列 sampler
 *   - comfyui:list-schedulers                 列 scheduler
 *   - comfyui:list-video-models               列 Wan2 文生视频 model 枚举
 *   - comfyui:upload-image  { srcPath }       复制到 ~/.tialynn/uploads/ 并上传 ComfyUI
 *   - comfyui:generate-image                  通用 T2I（替代/补充 sticker/background）
 *   - comfyui:generate-i2i                    图生图
 *   - comfyui:generate-video-t2v              文生视频
 *   - comfyui:generate-video-i2v              图生视频
 *   - comfyui:generate-sticker                旧 Phase 1（保留）
 *   - comfyui:generate-background             旧 Phase 1（保留）
 *   - comfyui:list-recent                     最近生成的所有文件
 *   - comfyui:cancel                          中断
 *
 * 进度事件：webContents.send('comfyui:progress', {kind, state, ...})
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { ComfyClient, ComfyError, type ComfyOutputImage } from '../services/comfyui/client'
import {
  buildBackgroundWorkflow,
  buildI2IWorkflow,
  buildImageWorkflow,
  buildStickerWorkflow,
  buildVideoI2VWorkflow,
  buildVideoT2VWorkflow,
  type BackgroundParams,
  type I2IGenParams,
  type ImageGenParams,
  type StickerParams,
  type VideoI2VParams,
  type VideoT2VParams,
} from '../services/comfyui/workflows'
import { loadConfig } from '../services/config-store'
import { getPaths } from '../services/paths'

let activeClient: ComfyClient | null = null

function getClient(): ComfyClient {
  const cfg = loadConfig()
  const endpoint = cfg.comfyui_endpoint?.trim()
  if (!endpoint) {
    throw new ComfyError('ComfyUI endpoint 未配置（Settings → comfyui_endpoint）')
  }
  if (!activeClient || activeClient.endpoint !== endpoint) {
    activeClient = new ComfyClient({ endpoint })
  }
  return activeClient
}

function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}
function stickersDir(): string { return ensureDir(join(getPaths().userDataDir, 'stickers')) }
function backgroundsDir(): string { return ensureDir(join(getPaths().userDataDir, 'backgrounds')) }
function imagesDir(): string { return ensureDir(join(getPaths().userDataDir, 'images')) }
function videosDir(): string { return ensureDir(join(getPaths().userDataDir, 'videos')) }
function uploadsDir(): string { return ensureDir(join(getPaths().userDataDir, 'uploads')) }

interface GenerateOutput {
  ok: boolean
  prompt_id?: string
  files?: string[]
  error?: string
}

/** 把生成结果（图/视频）下载到本地目录 */
async function downloadAll(
  client: ComfyClient,
  images: ComfyOutputImage[],
  destDir: string,
  prefix: string,
): Promise<string[]> {
  const saved: string[] = []
  for (const img of images) {
    const ext = extname(img.filename) || '.png'
    const fname = `${prefix}_${Date.now()}_${basename(img.filename)}`
    const dest = join(destDir, fname)
    try {
      await client.downloadImage(img.filename, img.subfolder, img.type, dest)
      saved.push(dest)
    } catch (e) {
      console.warn('[comfyui] download skipped', img.filename, e)
    }
    void ext
  }
  return saved
}

function progressEmitter(getWindow: () => BrowserWindow | null, kind: string, extra: Record<string, unknown> = {}) {
  return (state: 'queued' | 'running' | 'done'): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('comfyui:progress', { kind, state, ...extra })
    }
  }
}

export function registerComfyuiIpc(getWindow: () => BrowserWindow | null): void {
  // ============ 基础 ============

  ipcMain.handle('comfyui:status', async () => {
    try {
      const client = getClient()
      const r = await client.status()
      return { ok: r.ok, endpoint: client.endpoint, detail: r.detail, error: r.error }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 动态列资源 ============

  ipcMain.handle('comfyui:list-checkpoints', async () => {
    try {
      const info = await getClient().objectInfo('CheckpointLoaderSimple') as Record<string, { input?: { required?: Record<string, unknown> } }>
      const enumList = (info.CheckpointLoaderSimple?.input?.required?.ckpt_name as unknown[])?.[0] as string[] | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:list-loras', async () => {
    try {
      const info = await getClient().objectInfo('LoraLoader') as Record<string, { input?: { required?: Record<string, unknown> } }>
      const enumList = (info.LoraLoader?.input?.required?.lora_name as unknown[])?.[0] as string[] | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:list-samplers', async () => {
    try {
      const info = await getClient().objectInfo('KSampler') as Record<string, { input?: { required?: Record<string, unknown> } }>
      const samplers = (info.KSampler?.input?.required?.sampler_name as unknown[])?.[0] as string[] | undefined
      const schedulers = (info.KSampler?.input?.required?.scheduler as unknown[])?.[0] as string[] | undefined
      return { ok: true, samplers: samplers ?? [], schedulers: schedulers ?? [] }
    } catch (e) {
      return { ok: false, samplers: [], schedulers: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:list-video-models', async () => {
    try {
      const info = await getClient().objectInfo('Wan2TextToVideoApi') as Record<string, { input?: { required?: Record<string, unknown> } }>
      const enumList = (info.Wan2TextToVideoApi?.input?.required?.model as unknown[])?.[0] as string[] | undefined
      return { ok: true, items: enumList ?? [] }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 图片上传 ============

  ipcMain.handle('comfyui:upload-image', async (_evt, payload: { srcPath: string }) => {
    try {
      // 1) 复制到 ~/.tialynn/uploads/<ts>_<basename>
      const src = payload.srcPath
      if (!existsSync(src)) throw new Error(`源文件不存在: ${src}`)
      const dest = join(uploadsDir(), `${Date.now()}_${basename(src)}`)
      await copyFile(src, dest)
      // 2) 上传到 ComfyUI 的 input/
      const client = getClient()
      const r = await client.uploadImage({ path: dest })
      console.log(`[comfyui] upload-image: ${basename(src)} → ${r.name} (uploads cache: ${dest})`)
      return { ok: true, localCachePath: dest, comfyName: r.name, subfolder: r.subfolder, type: r.type }
    } catch (e) {
      console.error('[comfyui] upload-image failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 生成 endpoints ============

  ipcMain.handle('comfyui:generate-image', async (_evt, payload: ImageGenParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'image', { prompt: payload.prompt.slice(0, 60) })
    try {
      const client = getClient()
      const wf = buildImageWorkflow(payload)
      console.log(`[comfyui] generate-image checkpoint=${payload.checkpoint} prompt="${payload.prompt.slice(0, 80)}"`)
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, imagesDir(), 'image')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-image failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:generate-i2i', async (_evt, payload: I2IGenParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'i2i', { prompt: payload.prompt.slice(0, 60) })
    try {
      const client = getClient()
      const wf = buildI2IWorkflow(payload)
      console.log(`[comfyui] generate-i2i input=${payload.inputImage} denoise=${payload.denoise ?? 0.55}`)
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, imagesDir(), 'i2i')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-i2i failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:generate-video-t2v', async (_evt, payload: VideoT2VParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'video-t2v', { prompt: payload.prompt.slice(0, 60), model: payload.model })
    try {
      const client = getClient()
      const wf = buildVideoT2VWorkflow(payload)
      console.log(`[comfyui] generate-video-t2v model=${payload.model}`)
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 15 * 60_000 })
      const files = await downloadAll(client, r.images, videosDir(), 't2v')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-video-t2v failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:generate-video-i2v', async (_evt, payload: VideoI2VParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'video-i2v', { input: payload.inputImage })
    try {
      const client = getClient()
      const wf = buildVideoI2VWorkflow(payload)
      console.log(`[comfyui] generate-video-i2v input=${payload.inputImage} length=${payload.length ?? 81}`)
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 15 * 60_000 })
      const files = await downloadAll(client, r.images, videosDir(), 'i2v')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      console.error('[comfyui] generate-video-i2v failed', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 旧 Phase 1（保留兼容） ============

  ipcMain.handle('comfyui:generate-sticker', async (_evt, payload: StickerParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'sticker', { emotion: payload.emotion })
    try {
      const client = getClient()
      const wf = buildStickerWorkflow(payload)
      const r = await client.generate(wf, { onProgress: progress })
      const files = await downloadAll(client, r.images, stickersDir(), `sticker_${payload.emotion}`)
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('comfyui:generate-background', async (_evt, payload: BackgroundParams): Promise<GenerateOutput> => {
    const progress = progressEmitter(getWindow, 'background', { theme: payload.theme })
    try {
      const client = getClient()
      const wf = buildBackgroundWorkflow(payload)
      const r = await client.generate(wf, { onProgress: progress, maxWaitMs: 10 * 60_000 })
      const files = await downloadAll(client, r.images, backgroundsDir(), 'bg')
      return { ok: true, prompt_id: r.promptId, files }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ============ 历史 + 中断 ============

  ipcMain.handle('comfyui:list-recent', (_evt, kind?: 'sticker' | 'background' | 'image' | 'video' | 'all') => {
    const k = kind ?? 'all'
    const out: Array<{ kind: string; path: string; mtime: number; size: number }> = []
    const dirs: Array<[string, string]> = []
    if (k === 'all' || k === 'sticker') dirs.push(['sticker', stickersDir()])
    if (k === 'all' || k === 'background') dirs.push(['background', backgroundsDir()])
    if (k === 'all' || k === 'image') dirs.push(['image', imagesDir()])
    if (k === 'all' || k === 'video') dirs.push(['video', videosDir()])
    for (const [tag, d] of dirs) {
      if (!existsSync(d)) continue
      for (const name of readdirSync(d)) {
        if (!/\.(png|jpg|jpeg|webp|gif|mp4|mov|webm)$/i.test(name)) continue
        const p = join(d, name)
        try {
          const st = statSync(p)
          out.push({ kind: tag, path: p, mtime: st.mtimeMs, size: st.size })
        } catch { /* ignore */ }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out.slice(0, 80)
  })

  ipcMain.handle('comfyui:cancel', async () => {
    try {
      await getClient().interrupt()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

// hint to TS: keep mkdir imported (used via ensureDir variant if needed in future)
void mkdir
