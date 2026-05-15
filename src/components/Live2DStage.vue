<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { TiaLynnRenderer } from '@/live2d/renderer'
import { startEyeBlink } from '@/live2d/eyeBlink'
import { startMouseFocus } from '@/live2d/focus'
import { registerCanvas } from '@/alpha/sampler'
import { startIdleBehavior } from '@/behavior/idle'
import { useSoulStore } from '@/stores/soul'
import { useEmotionStore } from '@/stores/emotion'
import { DEFAULT_EMOTION_PARAMS } from '@/emotion/mapping'

const canvasEl = ref<HTMLCanvasElement | null>(null)
const loadError = ref<string | null>(null)
let renderer: TiaLynnRenderer | null = null
let stopBlink: (() => void) | null = null
let stopFocus: (() => void) | null = null
let stopIdle: (() => void) | null = null

const soul = useSoulStore()
const emotion = useEmotionStore()

onMounted(async () => {
  if (!canvasEl.value) return
  if (!soul.config) {
    try {
      await soul.load()
    } catch (e) {
      loadError.value = `灵魂档案加载失败：${e}`
      return
    }
  }
  if (!soul.config) {
    loadError.value = '灵魂档案缺失，请检查 default.yaml'
    console.error('[Live2DStage]', loadError.value)
    return
  }

  registerCanvas(canvasEl.value)

  const modelDir = soul.config.appearance.live2d_model_dir
  const modelFile = soul.config.appearance.model_file
  // 走 vite middleware (/live2d/*)，跨 dev/prod 一致，避开 Tauri asset 协议解析空格相对路径的 bug
  const url = `/live2d/${encodeURIComponent(modelFile)}`

  try {
    renderer = new TiaLynnRenderer({
      canvas: canvasEl.value,
      modelUrl: url,
      scale: soul.config.appearance.anchor.scale,
    })
    await renderer.load()
    void modelDir // 保留变量供未来配置展示
  } catch (e) {
    loadError.value = `Live2D 渲染初始化失败：${e}`
    console.error('[Live2DStage]', loadError.value)
    renderer?.destroy()
    renderer = null
    return
  }

  // 启动自动眨眼 + 视线跟随 + idle 自主动作
  stopBlink = startEyeBlink(renderer)
  stopFocus = startMouseFocus(renderer)
  stopIdle = startIdleBehavior(renderer)

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
  >
    <div class="font-semibold mb-1 text-hutao-red">立绘加载失败</div>
    <div class="whitespace-pre-wrap break-words">{{ loadError }}</div>
    <div class="mt-2 text-xs text-hutao-dark/60">
      检查 HuTao-Live2D/ 目录是否在项目根，或修改 default.yaml 的 appearance.live2d_model_dir
    </div>
  </div>
</template>
