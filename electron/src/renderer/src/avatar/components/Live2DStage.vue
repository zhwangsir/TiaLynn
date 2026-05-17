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

// v0.8.2: 接收强制 reload — 动作工坊保存 / Heal 后用
const onReloadModel = (): void => {
  if (renderer) void pickAndLoad()
}
bus.on('avatar:reload-model', onReloadModel)

// v0.9: 立绘缩放（dock 上 ⊕⊖ 按钮）+ 节流持久化
let lastSavedCharId: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const onZoom = (payload: { delta: number; reset?: boolean }): void => {
  if (!renderer) return
  let next: number
  if (payload.reset) {
    next = 1.0
  } else {
    next = renderer.getScaleHint() + payload.delta
  }
  renderer.applyScaleHint(next)
  // 持久化（节流 500ms）
  const currentDir = cfg.soul?.avatar.model_dir
  const found = currentDir
    ? cfg.models.find((m) => m.dir === currentDir)
    : null
  const charId = found?.meta?.character_id ?? null
  if (!charId) return
  lastSavedCharId = charId
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!renderer || !lastSavedCharId) return
    void window.api.models.setPreference({
      character_id: lastSavedCharId,
      scale: renderer.getScaleHint(),
      offset_y: 0,
    })
  }, 500)
}
bus.on('avatar:zoom', onZoom)

async function pickAndLoad(): Promise<void> {
  if (!renderer) return
  status.value = 'loading'
  try {
    if (cfg.models.length === 0) await cfg.rescanModels()

    const wanted = cfg.soul?.avatar.model_dir
    const wantedFile = cfg.soul?.avatar.model_file

    const exact =
      cfg.models.find(
        (m) => m.dir === wanted && (!wantedFile || m.model_file === wantedFile),
      ) ?? cfg.models.find((m) => m.dir === wanted)

    // v0.6.11: 优先级 = ⭐ builtin 推荐 > 完整 cubism4 > 任意 cubism4 > 报错
    const recommended = cfg.models.filter((m) => m.meta?.recommended)
    const completeC4 = cfg.models.filter(
      (m) => m.cubism === 'cubism4' && m.meta?.complete,
    )
    const anyC4 = cfg.models.filter((m) => m.cubism === 'cubism4')
    const fallbackChain = [...recommended, ...completeC4.filter((m) => !recommended.includes(m)), ...anyC4]
    let found = exact

    // 选了 cubism2 → fallback
    if (found && found.cubism !== 'cubism4') {
      const fallback = fallbackChain[0]
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${found.dir}」是 Cubism 2 格式，当前不支持。已自动切到「${fallback.dir}」`,
          ttl_ms: 6000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        found = fallback
      } else {
        status.value = 'error'
        errorMsg.value = `「${found.dir}」是 Cubism 2 格式，当前版本不支持；也没有任何 Cubism 4 (*.model3.json) 模型可用`
        bus.emit('ui:toast', { kind: 'error', message: errorMsg.value, ttl_ms: 8000 })
        return
      }
    }

    // 选了 cubism4 但缺关键资源（moc/texture）→ fallback
    if (found && found.cubism === 'cubism4' && found.meta && !found.meta.has_core) {
      const fallback = fallbackChain.find((m) => m.dir !== found?.dir)
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${found.dir}」缺失关键文件（${found.meta.reason ?? '未知'}）。已自动切到「${fallback.dir}」`,
          ttl_ms: 6000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        found = fallback
      }
    }

    if (!found) found = fallbackChain[0] ?? cfg.models[0]

    if (!found) {
      status.value = 'error'
      errorMsg.value = '未找到任何 Live2D 模型。请把模型放到 ~/.tialynn/models 或项目根目录。'
      console.warn('[live2d] no model found at all')
      return
    }

    if (found.cubism !== 'cubism4') {
      status.value = 'error'
      errorMsg.value = '只找到 Cubism 2 模型，当前版本仅支持 Cubism 4 (*.model3.json)'
      bus.emit('ui:toast', { kind: 'error', message: errorMsg.value, ttl_ms: 8000 })
      return
    }

    // v0.9: 优先用 model 的 per-character preference（user 调过的 scale）
    // 没存过就走 auto-fit (scale=1.0 即完全占满 85% canvas)
    let userHint = 1.0
    let offsetY = 0
    const charId = found.meta?.character_id
    if (charId) {
      const pref = await window.api.models.getPreference(charId)
      if (pref) {
        userHint = pref.scale
        offsetY = pref.offset_y
      }
    }
    await renderer.loadModel(found.file_url, { scale: userHint, offsetY })
    status.value = 'ready'
    bus.emit('avatar:model-loaded', {
      model_path: found.absolute_path,
      cubism: found.cubism,
    })
    // v0.6.11 运行时验证：加载 1.5s 后若 alpha sampler 检测画面没有任何不透明像素
    // → 模型加载了但渲染失败（黑屏/全透明）→ 自动 fallback 到推荐
    const loadedDir = found.dir
    setTimeout(() => {
      if (!sampler || !renderer) return
      if (status.value !== 'ready') return
      // 当前 cfg.soul 还是 loadedDir 才检查（用户已经手动切走就别管）
      if (cfg.soul?.avatar.model_dir !== loadedDir) return
      if (sampler.isReady() && !sampler.hasOpaque()) {
        const fallback = recommended[0] ?? completeC4.find((m) => m.dir !== loadedDir)
        if (fallback && fallback.dir !== loadedDir) {
          bus.emit('ui:toast', {
            kind: 'warn',
            message: `「${loadedDir}」加载后没有渲染出任何像素（可能模型损坏/不兼容）。已自动切到「${fallback.dir}」`,
            ttl_ms: 8000,
          })
          void cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        } else {
          bus.emit('ui:toast', {
            kind: 'error',
            message: `「${loadedDir}」加载后空白；没有可用的备用模型可切换`,
            ttl_ms: 8000,
          })
        }
      }
    }, 1500)
  } catch (e) {
    console.error('[live2d] load failed', e)
    status.value = 'error'
    errorMsg.value = String(e)
    bus.emit('ui:toast', { kind: 'error', message: `立绘加载失败：${String(e)}`, ttl_ms: 8000 })
    bus.emit('avatar:model-error', { reason: String(e) })
  }
}

onBeforeUnmount(() => {
  bus.off('avatar:reload-model', onReloadModel)
  bus.off('avatar:zoom', onZoom)
  if (saveTimer) clearTimeout(saveTimer)
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
  /* v0.8.2: canvas pointer-events: none，让上层 UI（ControlDock/DialogBubble）能正常 hit-test。
     立绘鼠标命中由主进程 cursor poll + alpha-hit sampler 处理，不依赖 canvas 自己接事件。 */
  pointer-events: none;
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
