<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { TiaLynnRenderer } from '@/live2d/renderer'
import { startEyeBlink } from '@/live2d/eyeBlink'
import { startMouseFocus } from '@/live2d/focus'
import { registerCanvas } from '@/alpha/sampler'
import { registerMaskCanvas, startMaskPush, stopMaskPush } from '@/alpha/mask'
import { startIdleBehavior } from '@/behavior/idle'
import { useSoulStore } from '@/stores/soul'
import { useEmotionStore } from '@/stores/emotion'
import { useConfigStore } from '@/stores/config'
import { DEFAULT_EMOTION_PARAMS } from '@/emotion/mapping'

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loadError = ref<string | null>(null)
let renderer: TiaLynnRenderer | null = null
let stopBlink: (() => void) | null = null
let stopFocus: (() => void) | null = null
let stopIdle: (() => void) | null = null

const soul = useSoulStore()
const emotion = useEmotionStore()
const config = useConfigStore()

onMounted(async () => {
  if (!canvasEl.value) return
  try {
    if (!soul.config) await soul.load()
    if (!config.config) await config.load()
  } catch (e) {
    loadError.value = `配置加载失败：${e}`
    return
  }
  if (!soul.config) {
    loadError.value = '灵魂档案缺失，请检查 default.yaml'
    return
  }

  registerCanvas(canvasEl.value)
  registerMaskCanvas(canvasEl.value)
  await loadModel()
  startMaskPush()
})

async function loadModel(): Promise<void> {
  if (!canvasEl.value) return
  // 配置优先于 yaml
  const modelDir =
    config.config?.live2d_model_dir ?? soul.config!.appearance.live2d_model_dir
  const modelFile =
    config.config?.live2d_model_file ?? soul.config!.appearance.model_file
  const scale = config.config?.live2d_scale ?? soul.config!.appearance.anchor.scale
  const offsetY = config.config?.live2d_offset_y ?? 50

  // URL: /live2d/<model_dir>/<file>
  const url = `/live2d/${encodeURIComponent(modelDir)}/${encodeURIComponent(modelFile)}`

  // 拆掉旧的 renderer + behaviors
  stopBlink?.()
  stopFocus?.()
  stopIdle?.()
  renderer?.destroy()
  renderer = null

  loadError.value = null
  try {
    renderer = new TiaLynnRenderer({
      canvas: canvasEl.value,
      modelUrl: url,
      scale,
      offsetY,
    })
    await renderer.load()
  } catch (e) {
    loadError.value = `Live2D 渲染初始化失败（${modelDir}/${modelFile}）：${e}`
    console.error('[Live2DStage]', loadError.value)
    renderer?.destroy()
    renderer = null
    return
  }

  stopBlink = startEyeBlink(renderer)
  stopFocus = startMouseFocus(renderer)
  stopIdle = startIdleBehavior(renderer, {
    minIntervalMs: (config.config?.idle_min_sec ?? 8) * 1000,
    maxIntervalMs: (config.config?.idle_max_sec ?? 15) * 1000,
  })

  applyEmotion()

  ;(window as any).__tialynn_renderer__ = renderer
  if (import.meta.env.DEV) {
    console.info('[Live2D] loaded:', modelDir, modelFile, 'params=', renderer.enumerateParams())
  }
}

// 模型 / 缩放 / 偏移 / idle 间隔变化时 reload
watch(
  () => [
    config.config?.live2d_model_dir,
    config.config?.live2d_model_file,
  ],
  () => {
    loadModel()
  },
)
watch(
  () => [config.config?.live2d_scale, config.config?.live2d_offset_y],
  () => {
    renderer?.setScaleAndOffset(
      config.config?.live2d_scale ?? 0.35,
      config.config?.live2d_offset_y ?? 50,
    )
  },
)
watch(
  () => [config.config?.idle_min_sec, config.config?.idle_max_sec],
  () => {
    if (!renderer) return
    stopIdle?.()
    stopIdle = startIdleBehavior(renderer, {
      minIntervalMs: (config.config?.idle_min_sec ?? 8) * 1000,
      maxIntervalMs: (config.config?.idle_max_sec ?? 15) * 1000,
    })
  },
)
watch(
  () => emotion.current,
  () => applyEmotion(),
)

function applyEmotion(): void {
  if (!renderer) return
  const id = emotion.current
  const fromSoul = soul.config?.emotions?.states?.[id]
  const fallback = DEFAULT_EMOTION_PARAMS[id]
  renderer.applyEmotion(fromSoul ?? fallback)
}

onBeforeUnmount(() => {
  stopMaskPush()
  stopBlink?.()
  stopFocus?.()
  stopIdle?.()
  renderer?.destroy()
  renderer = null
})
</script>

<template>
  <canvas ref="canvasEl" class="live2d-stage" />
  <div
    v-if="loadError"
    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[80%] p-4 rounded-xl bg-white/95 border border-hutao-red/40 shadow-xl text-sm text-hutao-dark pointer-events-auto"
    data-uichrome="1"
  >
    <div class="font-semibold mb-1 text-hutao-red">立绘加载失败</div>
    <div class="whitespace-pre-wrap break-words">{{ loadError }}</div>
    <div class="mt-2 text-xs text-hutao-dark/60">
      在设置 → 外观/模型 中切换模型，或把 Live2D Cubism 4 模型放入
      ~/.tialynn/models/
    </div>
  </div>
</template>
