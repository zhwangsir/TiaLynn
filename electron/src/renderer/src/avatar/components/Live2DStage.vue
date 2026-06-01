<script setup lang="ts">
/**
 * Live2DStage — 立绘舞台「协调器」(RFC 0002 Round Q1)。
 *
 * Q1 重构:渲染逻辑全部下沉到 Live2DInstance。Stage 只负责:
 *   - 持有窗口级 WindowInteraction(穿透 / 拖动 / 右键)— Electron BrowserWindow
 *     级单例,不可 per-character 拆(RFC §3.4)
 *   - 接收 instance 上报的 sampler/renderer 装配 WindowInteraction
 *   - passthrough 模态切换转发给 interaction
 *
 * Q1 阶段只渲染 1 个 instance(active character)。Q2 改 v-for(mounted)。
 *
 * 注意:容器 class 必须保留 `live2d-stage` — window-interaction.ts 的
 * isOverUiElement() 靠它判定"非 UI 区"放行穿透(见该文件 line 130)。
 */
import { onBeforeUnmount, ref, watch, computed } from 'vue'
import type { Live2DRenderer } from '../render/live2d-renderer'
import type { AlphaSampler } from '../interaction/alpha-hit'
import { WindowInteraction } from '../interaction/window-interaction'
import { useCharacterStore } from '../../infra/stores/character'
import Live2DInstance from './Live2DInstance.vue'

const props = defineProps<{
  passthroughEnabled?: boolean
}>()

const character = useCharacterStore()
const containerRef = ref<HTMLDivElement | null>(null)

let interaction: WindowInteraction | null = null

const passthrough = computed(() => props.passthroughEnabled !== false)

/** instance 渲染就绪 → 装配窗口级 WindowInteraction */
function onInstanceReady(payload: { renderer: Live2DRenderer; sampler: AlphaSampler }): void {
  if (!containerRef.value) return
  // Q1 单实例只会 ready 一次;防御性销毁旧的(Q2 多实例切换 active sampler 时复用此路径)。
  // reviewer Q1-Point2 提示:destroy() 必须先完成(它 set destroyed=true + 停 cursor poll)
  // 再用新 sampler — 否则旧 poll tick 可能命中已 destroy 的 sampler。Q2 hot-swap 时此顺序 load-bearing。
  interaction?.destroy()
  interaction = new WindowInteraction({
    container: containerRef.value,
    sampler: payload.sampler,
    renderer: payload.renderer,
    passthroughEnabled: () => passthrough.value,
  })
}

watch(passthrough, (on) => {
  interaction?.forceInteractive(!on)
})

onBeforeUnmount(() => {
  interaction?.destroy()
  interaction = null
})
</script>

<template>
  <div ref="containerRef" class="live2d-stage">
    <Live2DInstance
      :character-id="character.active?.id ?? ''"
      :is-active="true"
      @ready="onInstanceReady"
    />
  </div>
</template>

<style scoped>
.live2d-stage {
  position: absolute;
  inset: 0;
  background: transparent;
}
</style>
