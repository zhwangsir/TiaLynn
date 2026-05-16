<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { TiaLynnRenderer } from '@/avatar/render/renderer'
import { startEyeBlink } from '@/avatar/animation/eyeBlink'
import { startMouseFocus } from '@/avatar/animation/focus'
import { registerCanvas } from '@/avatar/interaction/drag'
import { useSoulStore } from '@/brain/stores/soul'
import { useEmotionStore } from '@/brain/stores/emotion'
import { useConfigStore } from '@/infra/stores/config'
import { DEFAULT_EMOTION_PARAMS } from '@/avatar/emotion-params/mapping'

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loadError = ref<string | null>(null)
let renderer: TiaLynnRenderer | null = null
let stopBlink: (() => void) | null = null
let stopFocus: (() => void) | null = null

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
    loadError.value = '灵魂档案缺失，请检查 soul/ 目录'
    return
  }

  registerCanvas(canvasEl.value)
  await loadModel()
})

async function loadModel(): Promise<void> {
  if (!canvasEl.value) return
  // 模型路径完全从 soul（v0.4 起）
  const modelDir = soul.config!.appearance.live2d_model_dir
  const modelFile = soul.config!.appearance.model_file
  const scale = soul.config!.appearance.anchor.scale
  // offset_y 不在旧 schema 里，给默认值
  const offsetY = 50

  const url = `/live2d/${encodeURIComponent(modelDir)}/${encodeURIComponent(modelFile)}`

  // 清理旧资源
  stopBlink?.()
  stopFocus?.()
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

  applyEmotion()

  ;(window as any).__tialynn_renderer__ = renderer
  if (import.meta.env.DEV) {
    console.info('[Live2D] loaded:', modelDir, modelFile)
  }
}

// soul 改变（如热重载） → 重新加载
watch(
  () => [soul.config?.appearance?.live2d_model_dir, soul.config?.appearance?.model_file],
  () => loadModel(),
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
  stopBlink?.()
  stopFocus?.()
  renderer?.destroy()
  renderer = null
})

void config
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
      在设置 → 外观/模型 切换，或编辑 soul/identity.yaml
    </div>
  </div>
</template>
