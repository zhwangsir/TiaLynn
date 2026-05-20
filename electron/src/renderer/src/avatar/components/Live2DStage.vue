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
// v0.15 A3: 当前情绪，驱动 CSS 呼吸节奏
const currentEmotion = ref<string>('neutral')
const currentIntensity = ref(0.5)

let renderer: Live2DRenderer | null = null
let sampler: AlphaSampler | null = null
let interaction: WindowInteraction | null = null
/** v0.17: 在 onMounted 内注册的 bus.on 清理列表 — onBeforeUnmount 统一调用，防 listener 泄漏 */
const cleanupHandlers: Array<() => void> = []

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
  const lipsyncHandler = ({ value }: { value: number }): void => {
    renderer?.setLipsync(value)
  }
  bus.on('avatar:lipsync', lipsyncHandler)

  // Phase 1 W3: AEIOU 元音权重驱动 ParamMouthForm + 多参数（VRoid 风格）
  const vowelHandler = (w: { A: number; E: number; I: number; O: number; U: number }): void => {
    renderer?.setVowelWeights(w)
  }
  bus.on('avatar:vowel-weights', vowelHandler)

  // v0.15 A3: 情绪变化驱动 stage 整体呼吸节奏
  // P5: 同时尝试切换 Live2D expression — 若模型有匹配的 expression，
  // 立刻播让情绪在脸上"看得到"。intensity > 0.3 才触发避免微调闪烁
  const emotionHandler = ({ emotion, intensity }: { emotion: string; intensity: number }): void => {
    currentEmotion.value = emotion
    currentIntensity.value = intensity
    if (renderer && intensity > 0.3) {
      void import('../render/expression-matcher').then(({ matchExpression }) => {
        const available = renderer!.listExpressions()
        const matched = matchExpression(emotion, available)
        if (matched) {
          renderer!.setExpression(matched)
        }
      })
    }
  }
  bus.on('brain:emotion-changed', emotionHandler)

  // v0.17：鼠标 hover 立绘像素时的微反应 — 让她"感受到"主人
  //   - 鼠标进入 alpha 命中区（不是只进窗口）→ 12 秒冷却内 35% 概率触发一次小动作
  //   - 随机选 FlickLeft/FlickRight/Tap 之一，配 shy/happy emotion
  //   - 冷却 12 秒避免来回 hover 时疯狂触发
  let lastHoverReactAt = 0
  const HOVER_REACT_COOLDOWN_MS = 12_000
  const HOVER_REACT_GROUPS = ['FlickLeft', 'FlickRight', 'Tap', 'FlickUp']
  const HOVER_REACT_EMOTIONS: Array<'shy' | 'happy' | 'tease'> = ['shy', 'happy', 'tease']
  const hoverHandler = ({ inside }: { inside: boolean }): void => {
    if (!inside) return
    if (!renderer) return
    const now = Date.now()
    if (now - lastHoverReactAt < HOVER_REACT_COOLDOWN_MS) return
    if (Math.random() > 0.35) return
    lastHoverReactAt = now
    const group = HOVER_REACT_GROUPS[Math.floor(Math.random() * HOVER_REACT_GROUPS.length)]!
    const emo = HOVER_REACT_EMOTIONS[Math.floor(Math.random() * HOVER_REACT_EMOTIONS.length)]!
    renderer.playMotionGroup(group)
    bus.emit('brain:emotion-changed', { emotion: emo, intensity: 0.5 })
  }
  bus.on('avatar:mouse-inside', hoverHandler)
  cleanupHandlers.push(() => {
    bus.off('avatar:lipsync', lipsyncHandler)
    bus.off('avatar:vowel-weights', vowelHandler)
    bus.off('brain:emotion-changed', emotionHandler)
    bus.off('avatar:mouse-inside', hoverHandler)
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

/** v0.17：记录加载失败的 dir，下次 pickAndLoad 跳过它 */
const failedDirs = new Set<string>()
const MAX_FALLBACK_ATTEMPTS = 3

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

    // diagnostic：让 main log 能看到 wanted vs 是否有匹配
    console.warn(
      `[live2d] PICK wanted="${wanted}" file="${wantedFile}" exact=${exact ? 'HIT' : 'MISS'} totalModels=${cfg.models.length}`,
    )
    if (!exact && wanted) {
      const partial = cfg.models.filter((m) => m.dir.includes(wanted ?? '') || (wanted ?? '').includes(m.dir))
      console.warn(`[live2d] PICK partial matches:`, partial.slice(0, 3).map((m) => ({ dir: m.dir, file: m.model_file })))
    }

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
    // v0.6.11 运行时验证：加载 1.5s 后 alpha sampler 检查
    // 修订：不再自动 fallback —— 调试期间隐藏错误成本太高，宁可白屏让用户看到
    const loadedDir = found.dir
    setTimeout(() => {
      if (!sampler || !renderer) return
      if (status.value !== 'ready') return
      if (cfg.soul?.avatar.model_dir !== loadedDir) return
      if (sampler.isReady() && !sampler.hasOpaque()) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${loadedDir}」加载后画面全透明（模型加载成功但 PIXI 渲染 0 像素）。打开 DevTools (Cmd+Opt+I) 看 console 错误`,
          ttl_ms: 15000,
        })
        console.warn('[live2d] alpha sampler: 0 opaque pixels for', loadedDir, found.file_url)
      }
    }, 1500)
  } catch (e) {
    console.error('[live2d] load failed', e)
    const failedDir = cfg.soul?.avatar.model_dir
    if (failedDir) failedDirs.add(failedDir)
    // v0.17：自动 fallback 到第一个可用且未失败的模型，最多 3 次
    if (failedDirs.size < MAX_FALLBACK_ATTEMPTS) {
      const fallback = cfg.models.find(
        (m) => m.cubism === 'cubism4' && m.meta?.has_core && !failedDirs.has(m.dir),
      )
      if (fallback) {
        bus.emit('ui:toast', {
          kind: 'warn',
          message: `「${failedDir}」加载失败，自动切到「${fallback.dir}」`,
          ttl_ms: 5000,
        })
        await cfg.saveAvatar({ model_dir: fallback.dir, model_file: fallback.model_file })
        return pickAndLoad()
      }
    }
    status.value = 'error'
    errorMsg.value = String(e)
    bus.emit('ui:toast', { kind: 'error', message: `立绘加载失败：${String(e)}`, ttl_ms: 8000 })
    bus.emit('avatar:model-error', { reason: String(e) })
  }
}

onBeforeUnmount(() => {
  bus.off('avatar:reload-model', onReloadModel)
  bus.off('avatar:zoom', onZoom)
  // v0.17: 清理所有 onMounted 内注册的 bus handler（lipsync / brain:emotion-changed / avatar:mouse-inside）
  for (const cleanup of cleanupHandlers) cleanup()
  cleanupHandlers.length = 0
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
  <div
    ref="containerRef"
    class="live2d-stage"
    :data-state="status"
    :data-emotion="currentEmotion"
    :style="{ '--emotion-intensity': currentIntensity }"
  >
    <canvas ref="canvasRef" class="live2d-canvas" />
    <!-- v0.15 A2: 切换 character 时的 shimmer 过渡层 -->
    <transition name="shimmer">
      <div v-if="status === 'loading'" class="shimmer-veil">
        <div class="shimmer-pulse"></div>
      </div>
    </transition>
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
  /* v0.15 A3: 整体呼吸 — transform-origin: bottom 让脚下不动头/胸前后微浮 */
  transform-origin: 50% 90%;
  animation: stage-breath 2.4s var(--ease-in-out) infinite;
}
/* 不同 emotion 不同呼吸节奏 + 振幅 — 用 emotion-intensity 0-1 调强度 */
.live2d-stage[data-emotion='happy'] {
  animation-duration: 1.6s; /* 兴奋呼吸快 */
}
.live2d-stage[data-emotion='angry'] {
  animation-duration: 1.2s; /* 怒气呼吸最快 */
}
.live2d-stage[data-emotion='surprise'] {
  animation-duration: 1.3s;
}
.live2d-stage[data-emotion='shy'],
.live2d-stage[data-emotion='tease'] {
  animation-duration: 2.0s;
}
.live2d-stage[data-emotion='sad'] {
  animation-duration: 3.2s; /* 难过呼吸长 */
}
.live2d-stage[data-emotion='sleepy'] {
  animation-duration: 4.0s; /* 困了呼吸最慢 */
}
@keyframes stage-breath {
  /* scale 振幅基础 0.6% × intensity */
  0%, 100% { transform: scale(calc(1 - var(--emotion-intensity, 0.5) * 0.006)); }
  50% { transform: scale(calc(1 + var(--emotion-intensity, 0.5) * 0.006)); }
}
.live2d-stage[data-state='loading'] {
  animation: none; /* loading 时不呼吸 */
}
.live2d-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: transparent;
  /* v0.8.2: canvas pointer-events: none，让上层 UI（ControlDock/DialogBubble）能正常 hit-test。
     立绘鼠标命中由主进程 cursor poll + alpha-hit sampler 处理，不依赖 canvas 自己接事件。 */
  pointer-events: none;
  /* v0.15 A2: loading 时 canvas 整体淡出 */
  transition: opacity var(--duration-normal) var(--ease-in-out);
  /* v0.17：立绘 drop-shadow — 让她"贴"在桌面而不是漂浮 panel 里。
     filter: drop-shadow 比 box-shadow 强 — 跟随 alpha 形状（非矩形），真正像影子。 */
  filter: drop-shadow(0 12px 24px oklch(0% 0 0 / 0.28))
          drop-shadow(0 4px 8px oklch(0% 0 0 / 0.18));
}
.live2d-stage[data-state='loading'] .live2d-canvas {
  opacity: 0.3;
}

/* v0.15 A2: shimmer 切换过渡 — 切角色时柔和过渡而非硬切 */
.shimmer-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  overflow: hidden;
}
.shimmer-pulse {
  position: absolute;
  inset: 20% 25%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--color-accent-soft) 0%,
    transparent 70%
  );
  animation: shimmer-breath 1.5s var(--ease-in-out) infinite;
  filter: blur(20px);
  opacity: 0.5;
}
@keyframes shimmer-breath {
  0%, 100% { transform: scale(0.85); opacity: 0.3; }
  50% { transform: scale(1.05); opacity: 0.7; }
}

.shimmer-enter-active,
.shimmer-leave-active {
  transition: opacity var(--duration-normal) var(--ease-in-out);
}
.shimmer-enter-from,
.shimmer-leave-to {
  opacity: 0;
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
