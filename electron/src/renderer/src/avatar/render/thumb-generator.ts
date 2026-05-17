/**
 * Live2D 模型缩略图后台生成器（v0.10）
 *
 * 离屏 PIXI Application 加载每个模型 → 渲染一帧 → 截 WebP → IPC 写盘缓存。
 * 严格控制并发（默认 2），避免抢占主立绘的 GPU/CPU 影响交互流畅度。
 *
 * 失败的模型会标记 .failed，下次跳过避免重试浪费。
 */
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { ExtLive2DModel } from './live2d-types'

const THUMB_W = 240
const THUMB_H = 320
const FILL_RATIO = 0.85
const WEBP_QUALITY = 0.78
/** 单次加载上限（防 model 内部死循环 / 巨大资源拖死 worker） */
const PER_MODEL_TIMEOUT_MS = 20_000

export interface ThumbJob {
  /** character_id 用作 thumb 文件名 */
  character_id: string
  /** model.json 的 file:// URL */
  file_url: string
}

export interface ThumbProgress {
  total: number
  done: number
  failed: number
  current?: string
}

export type ProgressCallback = (p: ThumbProgress) => void

/** 单个模型 → webp base64。失败抛错由调用方处理 */
async function renderOneModel(fileUrl: string): Promise<string> {
  // 离屏 canvas（不挂 DOM，避免影响 layout）
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_W
  canvas.height = THUMB_H

  const app = new PIXI.Application({
    view: canvas,
    width: THUMB_W,
    height: THUMB_H,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false,
    preserveDrawingBuffer: true, // 必须保留 buffer 才能 toBlob
    resolution: 1, // thumb 不需要 retina
  })

  let model: Live2DModel | null = null
  try {
    model = await withTimeout(
      Live2DModel.from(fileUrl, { autoInteract: false }),
      PER_MODEL_TIMEOUT_MS,
      `加载超时: ${fileUrl}`,
    )
    if (!model) throw new Error('Live2DModel.from 返回 null')

    app.stage.addChild(model)
    model.anchor.set(0.5, 0.5)

    // 等价于 live2d-renderer 的 auto-fit：让 model 占 canvas FILL_RATIO
    const internal = (model as ExtLive2DModel).internalModel
    let modelW = Number(internal?.originalWidth) || 0
    let modelH = Number(internal?.originalHeight) || 0
    if (modelW <= 0 || modelH <= 0) {
      model.scale.set(1)
      const b = model.getLocalBounds()
      if (b.width > 0) modelW = b.width
      if (b.height > 0) modelH = b.height
    }
    if (modelW <= 0) modelW = 2048
    if (modelH <= 0) modelH = 2048
    const scale = Math.min((THUMB_W * FILL_RATIO) / modelW, (THUMB_H * FILL_RATIO) / modelH)
    model.scale.set(scale)
    model.x = THUMB_W / 2
    model.y = THUMB_H / 2 + 20 // 略下移，让头部居中

    // 等一帧确保模型 internalModel.update 跑过、texture 上传完
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // 再 force render 一次
    app.renderer.render(app.stage)
    // 第二帧 — 第一帧有时 texture 还没 upload，第二帧才稳定
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    app.renderer.render(app.stage)

    // 转 webp base64
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', WEBP_QUALITY)
    })
    if (!blob) throw new Error('canvas.toBlob 返回 null')
    const arrayBuf = await blob.arrayBuffer()
    // ArrayBuffer → base64
    const bytes = new Uint8Array(arrayBuf)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  } finally {
    // 严格清理：destroy children + texture（thumb 用完即弃，不共享 cache）
    try {
      if (model) model.destroy({ children: true, texture: true, baseTexture: true })
    } catch { /* skip */ }
    try {
      app.destroy(false, { children: true, texture: true, baseTexture: true })
    } catch { /* skip */ }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }).catch((e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

/**
 * 启动后台生成。可中途调用 cancel() 终止剩余任务。
 * 完成 / 失败逐个通过 onProgress 回调，UI 能实时刷新某张卡片。
 */
export class ThumbGenerator {
  private cancelled = false

  async run(
    jobs: ThumbJob[],
    onProgress: ProgressCallback,
    concurrency = 2,
  ): Promise<void> {
    if (jobs.length === 0) return
    const state: ThumbProgress = { total: jobs.length, done: 0, failed: 0 }
    onProgress({ ...state })

    let idx = 0
    const workers = Array(concurrency)
      .fill(0)
      .map(async () => {
        while (idx < jobs.length && !this.cancelled) {
          const myIdx = idx++
          const job = jobs[myIdx]!
          state.current = job.character_id
          onProgress({ ...state })
          try {
            const webp = await renderOneModel(job.file_url)
            const r = await window.api.thumbs.save({
              character_id: job.character_id,
              webp_base64: webp,
            })
            if (!r.ok) {
              await window.api.thumbs.markFailed({
                character_id: job.character_id,
                reason: r.reason ?? 'save 拒收',
              })
              state.failed++
            }
          } catch (e) {
            state.failed++
            try {
              await window.api.thumbs.markFailed({
                character_id: job.character_id,
                reason: String(e).slice(0, 200),
              })
            } catch { /* skip */ }
            console.warn(`[thumb] ${job.character_id} 失败:`, e)
          }
          state.done++
          onProgress({ ...state })
        }
      })
    await Promise.all(workers)
    delete state.current
    onProgress({ ...state })
  }

  cancel(): void {
    this.cancelled = true
  }
}
