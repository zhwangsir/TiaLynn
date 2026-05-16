<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { Live2DRenderer } from '../render/live2d-renderer'
import { AlphaSampler } from '../interaction/alpha-hit'
import { WindowInteraction } from '../interaction/window-interaction'
import { useConfigStore } from '../../infra/stores/config'
import { bus } from '../../infra/eventbus'

const props = defineProps<{
  passthroughEnabled?: boolean
}>()

const cfg = useConfigStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMsg = ref<string>('')

let renderer: Live2DRenderer | null = null
let sampler: AlphaSampler | null = null
let interaction: WindowInteraction | null = null

const passthrough = computed(() => props.passthroughEnabled !== false)

onMounted(async () => {
  if (!canvasRef.value || !containerRef.value) return
  const { offsetWidth: w, offsetHeight: h } = containerRef.value
  renderer = new Live2DRenderer({ canvas: canvasRef.value, width: w, height: h })

  await pickAndLoad()

  if (!renderer) return
  sampler = new AlphaSampler(renderer)
  interaction = new WindowInteraction({
    container: containerRef.value,
    sampler,
    renderer,
    passthroughEnabled: () => passthrough.value,
  })

  // 嘴型驱动 —— 监听总线
  bus.on('avatar:lipsync', ({ value }) => {
    renderer?.setLipsync(value)
  })

  // 窗口尺寸响应（节流）
  const onResize = (): void => {
    if (!renderer || !containerRef.value) return
    renderer.resize(containerRef.value.offsetWidth, containerRef.value.offsetHeight)
  }
  window.addEventListener('resize', onResize)
})

watch(
  () => cfg.soul?.avatar.model_dir,
  async (dir, prev) => {
    if (!renderer) return
    if (!dir || dir === prev) return
    await pickAndLoad()
  },
)

watch(passthrough, (on) => {
  interaction?.forceInteractive(!on)
})

async function pickAndLoad(): Promise<void> {
  if (!renderer) return
  status.value = 'loading'
  try {
    if (cfg.models.length === 0) await cfg.rescanModels()
    const wanted = cfg.soul?.avatar.model_dir
    const wantedFile = cfg.soul?.avatar.model_file
    const found =
      cfg.models.find(
        (m) => m.dir === wanted && (!wantedFile || m.model_file === wantedFile),
      ) ??
      cfg.models.find((m) => m.dir === wanted) ??
      cfg.models[0]
    if (!found) {
      status.value = 'error'
      errorMsg.value = '未找到任何 Live2D 模型。请把模型放到 ~/.tialynn/models 或项目根目录。'
      console.warn('[live2d] no model found at all')
      return
    }
    await renderer.loadModel(found.file_url, {
      scale: cfg.soul?.avatar.scale ?? 0.35,
      offsetY: cfg.soul?.avatar.offset_y ?? 50,
    })
    status.value = 'ready'
    bus.emit('avatar:model-loaded', {
      model_path: found.absolute_path,
      cubism: found.cubism,
    })
  } catch (e) {
    console.error('[live2d] load failed', e)
    status.value = 'error'
    errorMsg.value = String(e)
    bus.emit('avatar:model-error', { reason: String(e) })
  }
}

onBeforeUnmount(() => {
  interaction?.destroy()
  sampler?.destroy()
  renderer?.destroy()
  renderer = null
  sampler = null
  interaction = null
})
</script>

<template>
  <div ref="containerRef" class="live2d-stage" :data-state="status">
    <canvas ref="canvasRef" class="live2d-canvas" />
    <div v-if="status === 'loading'" class="overlay">
      <span class="dot" />正在召唤……
    </div>
    <div v-else-if="status === 'error'" class="overlay error">
      <span>{{ errorMsg }}</span>
    </div>
  </div>
</template>

<style scoped>
.live2d-stage {
  position: absolute;
  inset: 0;
  background: transparent;
}
.live2d-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
}
.overlay {
  position: absolute;
  inset: auto 16px 16px 16px;
  padding: 8px 12px;
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.overlay.error {
  background: oklch(95% 0.05 25 / 0.95);
  color: oklch(40% 0.12 25);
}
.dot {
  width: 6px;
  height: 6px;
  background: var(--color-accent);
  border-radius: 999px;
  animation: pulse 1s var(--ease-out-expo) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}
</style>
