<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import { TiaLynnRenderer } from '@/live2d/renderer'
import { startEyeBlink } from '@/live2d/eyeBlink'
import { startMouseFocus } from '@/live2d/focus'
import { registerCanvas } from '@/alpha/sampler'
import { useSoulStore } from '@/stores/soul'
import { useEmotionStore } from '@/stores/emotion'
import { DEFAULT_EMOTION_PARAMS } from '@/emotion/mapping'

const canvasEl = ref<HTMLCanvasElement | null>(null)
let renderer: TiaLynnRenderer | null = null
let stopBlink: (() => void) | null = null
let stopFocus: (() => void) | null = null

const soul = useSoulStore()
const emotion = useEmotionStore()

onMounted(async () => {
  if (!canvasEl.value) return
  if (!soul.config) await soul.load()
  if (!soul.config) {
    console.error('[Live2DStage] soul config missing')
    return
  }

  registerCanvas(canvasEl.value)

  const modelDir = soul.config.appearance.live2d_model_dir
  const modelFile = soul.config.appearance.model_file

  // 通过 Rust 端 command 拿到模型在用户数据目录里的绝对路径，
  // 然后用 convertFileSrc 转 file:// URL 供 fetch。
  const absPath = await invoke<string>('soul_resolve_asset', {
    dir: modelDir,
    file: modelFile,
  })
  const url = convertFileSrc(absPath)

  renderer = new TiaLynnRenderer({
    canvas: canvasEl.value,
    modelUrl: url,
    scale: soul.config.appearance.anchor.scale,
  })
  await renderer.load()

  // 启动自动眨眼 + 视线跟随
  stopBlink = startEyeBlink(renderer)
  stopFocus = startMouseFocus(renderer)

  // 初始情绪
  applyEmotion()

  // 把 renderer 暴露到全局供 lipSync / 其他模块使用
  ;(window as any).__tialynn_renderer__ = renderer

  // 调试：打印参数列表
  if (import.meta.env.DEV) {
    console.info('[Live2D] params =', renderer.enumerateParams())
  }
})

watch(
  () => emotion.current,
  () => applyEmotion(),
)

function applyEmotion() {
  if (!renderer) return
  const id = emotion.current
  const fromSoul = soul.config?.emotions?.states?.[id]
  const fallback = DEFAULT_EMOTION_PARAMS[id]
  renderer.applyEmotion(fromSoul ?? fallback)
}

onBeforeUnmount(() => {
  stopBlink?.()
  stopFocus?.()
  renderer?.destroy()
  renderer = null
})

// suppress unused warning for resolveResource (kept for future use)
void resolveResource
</script>

<template>
  <canvas ref="canvasEl" class="live2d-stage" />
</template>
