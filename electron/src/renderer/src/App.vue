<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Live2DStage from './avatar/components/Live2DStage.vue'
import DialogBubble from './infra/ui/DialogBubble.vue'
import InputBar from './infra/ui/InputBar.vue'
import ContextMenu, { type MenuItem } from './infra/ui/ContextMenu.vue'
import SettingsPanel from './infra/ui/SettingsPanel.vue'
import ControlDock from './infra/ui/ControlDock.vue'
import ResourceStorePanel from './infra/ui/ResourceStorePanel.vue'
import ErrorBoundary from './infra/ui/ErrorBoundary.vue'
import ToastStack from './infra/ui/ToastStack.vue'
import ApprovalDialog from './infra/ui/ApprovalDialog.vue'
import MotionFactoryPanel from './infra/ui/MotionFactoryPanel.vue'
import OnboardingDialog from './infra/ui/OnboardingDialog.vue'
import CharacterStatusBar from './infra/ui/CharacterStatusBar.vue'
import CharacterPicker from './infra/ui/CharacterPicker.vue'
import { useCharacterStore } from './infra/stores/character'
import { iconChat, iconGear, iconMinus, iconPin, iconReload, iconX } from './infra/ui/icons'
import { useConfigStore } from './infra/stores/config'
import { useDialogStore } from './brain/stores/dialog'
import { useSpeechStore } from './presence/stores/speech'
import { useApprovalStore } from './hands/approval-store'
import { bus } from './infra/eventbus'

const cfg = useConfigStore()
const dialog = useDialogStore()
const speech = useSpeechStore()
const approval = useApprovalStore()
const character = useCharacterStore()

const ready = ref(false)
const settingsOpen = ref(false)
const motionFactoryOpen = ref(false)
const libraryOpen = ref(false)
const inputOpen = ref(false)
const pinned = ref(true)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const onboardingOpen = ref(false)
const characterPickerOpen = ref(false)
const characterCreatorOpen = ref(false)

// 任何模态打开时关闭穿透判定（避免点击被穿透到下层）
const passthroughEnabled = computed(
  () =>
    !settingsOpen.value &&
    !motionFactoryOpen.value &&
    !menuOpen.value &&
    !libraryOpen.value &&
    !onboardingOpen.value &&
    !characterPickerOpen.value &&
    !characterCreatorOpen.value,
)

const menuItems = computed<MenuItem[]>(() => [
  { id: 'chat', label: inputOpen.value ? '隐藏输入框' : '打开对话', icon: iconChat, shortcut: '↵' },
  { id: 'motion-factory', label: '🎬 动作工坊', icon: iconChat },
  { id: 'library', label: '🎁 资源商店', icon: iconChat },
  { id: 'settings', label: '设置', icon: iconGear },
  { id: 'reload', label: '重载模型 / 灵魂', icon: iconReload },
  { id: 'sep1', label: '', separator: true },
  { id: 'pin', label: pinned.value ? '取消置顶' : '置顶', icon: iconPin },
  { id: 'minimize', label: '收起', icon: iconMinus },
  { id: 'sep2', label: '', separator: true },
  { id: 'close', label: '关闭', danger: true, icon: iconX },
])

function openMenu(x: number, y: number): void {
  menuX.value = x
  menuY.value = y
  menuOpen.value = true
}
function closeMenu(): void {
  menuOpen.value = false
}

async function onMenuSelect(id: string): Promise<void> {
  switch (id) {
    case 'chat':
      inputOpen.value = !inputOpen.value
      break
    case 'settings':
      settingsOpen.value = true
      break
    case 'motion-factory':
      motionFactoryOpen.value = true
      break
    case 'library':
      libraryOpen.value = true
      break
    case 'reload':
      await cfg.rescanModels()
      await cfg.reloadSoul()
      break
    case 'pin':
      pinned.value = !pinned.value
      await window.api.window.togglePin(pinned.value)
      break
    case 'minimize':
      await window.api.window.minimize()
      break
    case 'close':
      await window.api.window.close()
      break
  }
}

function closeSettings(): void {
  settingsOpen.value = false
}

function closeInput(): void {
  inputOpen.value = false
}

let offCtxMenuFn: (() => void) | null = null
let offSoulFn: (() => void) | null = null
let offInstalledFn: (() => void) | null = null
let offAttentionPlanFn: (() => void) | null = null
const dragOver = ref(false)

/** Plan 执行入口：从 Live2DStage 拿 renderer + container 引用 */
async function executePlanForCurrentStage(
  plan: import('@shared/attention').BehaviorPlan,
): Promise<void> {
  // 通过 bus 让 Live2DStage 接管（它持有 renderer + container）
  bus.emit('attention:execute-plan', { plan })
}

async function onReloadModelClick(): Promise<void> {
  await cfg.rescanModels()
  bus.emit('avatar:reload-model')
  bus.emit('ui:toast', { kind: 'success', message: '模型已重载', ttl_ms: 2000 })
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
function onDragLeave(e: DragEvent): void {
  // 仅当离开整个 root 时清除（避免子元素 leave 误触）
  if ((e.relatedTarget as Node | null)?.nodeType) return
  dragOver.value = false
}
async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  // Electron renderer: File.path 在 contextIsolation 下不可用
  // 用 webUtils.getPathForFile (Electron 32+) 或 fallback File.name
  const paths: string[] = []
  for (const f of files) {
    const p = f.path
    if (p) paths.push(p)
  }
  if (paths.length === 0) {
    bus.emit('ui:toast', {
      kind: 'warn',
      message: '拖入的文件没有路径信息；请用「设置 → 从目录安装」或「下载安装」按钮',
      ttl_ms: 6000,
    })
    return
  }
  const results = await window.api.market.installPaths(paths)
  const ok = results.filter((r) => r.ok)
  const fail = results.filter((r) => !r.ok)
  if (ok.length > 0) {
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已安装 ${ok.length} 个模型：${ok.map((r) => r.detected_name).filter(Boolean).join('，')}`,
      ttl_ms: 5000,
    })
  }
  if (fail.length > 0) {
    bus.emit('ui:toast', {
      kind: 'error',
      message: `${fail.length} 个安装失败：${fail.map((r) => r.reason).slice(0, 2).join('；')}`,
      ttl_ms: 8000,
    })
  }
  if (ok.length > 0) await cfg.rescanModels()
}

onMounted(async () => {
  await cfg.bootstrap()
  await character.bootstrap()           // v0.14: 先 load character
  await dialog.bootstrap()
  speech.bootstrap()
  approval.bootstrap()
  dialog.injectGreeting()
  ready.value = true

  // v0.14: 切角色时清空对话历史 + 重新 inject greeting
  bus.on('character:switched', async () => {
    await dialog.bootstrap()  // reload per-character history
    await cfg.reloadSoul()    // 新角色的灵魂
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已切换到 ${character.active?.name ?? '?'}`,
      ttl_ms: 2500,
    })
  })

  // v0.13 首次启动引导：LLM 未配置就弹出
  if (!cfg.config?.llm_endpoint || !cfg.config?.llm_model) {
    onboardingOpen.value = true
  }

  const handler = ({ x, y }: { x: number; y: number }): void => openMenu(x, y)
  bus.on('avatar:contextmenu', handler)
  offCtxMenuFn = () => bus.off('avatar:contextmenu', handler)

  // 主进程把 yaml 改了 → 自动重载 soul（保持 store 与磁盘一致）
  offSoulFn = window.api.soul.onChanged(() => {
    void cfg.reloadSoul()
  })

  // 模型安装完成 → 刷新模型列表
  offInstalledFn = window.api.market.onInstalled(() => {
    void cfg.rescanModels()
  })

  // v0.8 主体性架构：监听主进程 BehaviorPlan → 执行
  offAttentionPlanFn = window.api.attention.onPlan((plan) => {
    void executePlanForCurrentStage(plan)
  })

  // v0.8.2: dialog LLM 的 reply 也可能带 actions（同 BehaviorAction shape），让 plan-executor 跑
  const onReplyActions = (
    payload: { actions: import('@shared/attention').BehaviorAction[] },
  ): void => {
    void executePlanForCurrentStage({
      t: Date.now(),
      trigger: 'reply-actions',
      actions: payload.actions,
      reasoning: 'inline from dialog reply',
      llm_generated: true,
    })
  }
  bus.on('brain:reply-actions', onReplyActions)
})

onBeforeUnmount(() => {
  offCtxMenuFn?.()
  offSoulFn?.()
  offInstalledFn?.()
  offAttentionPlanFn?.()
})
</script>

<template>
  <ErrorBoundary>
    <div
      class="root"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <Live2DStage v-if="ready" :passthrough-enabled="passthroughEnabled" />
      <CharacterStatusBar v-if="ready" @open-picker="characterPickerOpen = true" />
      <ControlDock
        v-if="ready"
        @open-settings="settingsOpen = true"
        @open-picker="characterPickerOpen = true"
        @reload-model="onReloadModelClick"
      />
      <DialogBubble v-if="ready" />
      <InputBar v-if="ready && inputOpen" @close="closeInput" />
      <ContextMenu
        :open="menuOpen"
        :x="menuX"
        :y="menuY"
        :items="menuItems"
        @select="onMenuSelect"
        @close="closeMenu"
      />
      <SettingsPanel v-if="settingsOpen" @close="closeSettings" />
      <MotionFactoryPanel v-if="motionFactoryOpen" @close="motionFactoryOpen = false" />
      <ResourceStorePanel v-if="libraryOpen" @close="libraryOpen = false" />
      <OnboardingDialog v-if="onboardingOpen" @close="onboardingOpen = false" />
      <CharacterPicker
        v-if="characterPickerOpen"
        @close="characterPickerOpen = false"
        @open-creator="() => { characterPickerOpen = false; characterCreatorOpen = true }"
      />
      <ApprovalDialog />
      <ToastStack />
      <div v-if="!ready" class="boot-hint">
        <span class="boot-heart">♡</span>
        <span class="boot-text">召唤 TiaLynn 中…</span>
      </div>
      <div v-else class="hint" key="ready-hint">右键人物可以打开菜单</div>
      <transition name="drop">
        <div v-if="dragOver" class="drop-overlay">
          <div class="drop-card">
            <div class="drop-icon">📦</div>
            <div class="drop-title">松开安装 Live2D 模型</div>
            <div class="drop-sub">支持 .zip 或解压后的模型目录</div>
          </div>
        </div>
      </transition>
    </div>
  </ErrorBoundary>
</template>

<style scoped>
.root {
  position: relative;
  width: 100%;
  height: 100%;
  background: transparent;
  pointer-events: auto;
}
.boot-hint,
.hint {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
}
.boot-hint {
  display: flex;
  align-items: center;
  gap: 8px;
}
.boot-heart {
  color: var(--color-accent);
  font-size: 14px;
  line-height: 1;
  animation: heart-beat 1.4s var(--ease-in-out) infinite;
}
.boot-text {
  font-weight: 500;
}
@keyframes heart-beat {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  20% { transform: scale(1.25); opacity: 1; }
  40% { transform: scale(1); opacity: 0.85; }
  60% { transform: scale(1.15); opacity: 1; }
}
.hint {
  opacity: 0;
  animation: hint-show 6s var(--ease-out-expo) forwards;
}
@keyframes hint-show {
  0% { opacity: 0; transform: translate(-50%, 10px); }
  10% { opacity: 0.95; transform: translateX(-50%); }
  85% { opacity: 0.85; transform: translateX(-50%); }
  100% { opacity: 0; transform: translate(-50%, 10px); }
}

.drop-overlay {
  position: absolute;
  inset: 0;
  background: oklch(0% 0 0 / 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1900;
  pointer-events: none;
  backdrop-filter: blur(8px) saturate(1.2);
  -webkit-backdrop-filter: blur(8px) saturate(1.2);
}
.drop-card {
  background: var(--color-bubble);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-lg);
  padding: 32px 40px;
  text-align: center;
  box-shadow: var(--shadow-lg);
  color: var(--color-bubble-text);
  max-width: 80%;
  animation: drop-pulse 1.8s var(--ease-in-out) infinite;
}
@keyframes drop-pulse {
  0%, 100% { transform: scale(1); border-color: var(--color-accent); }
  50% { transform: scale(1.02); border-color: var(--color-accent-hover); }
}
.drop-icon {
  font-size: 52px;
  margin-bottom: 10px;
  animation: drop-bounce 1.5s var(--ease-in-out) infinite;
}
@keyframes drop-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.drop-title {
  font-size: var(--text-lg);
  font-weight: 700;
  margin-bottom: 4px;
}
.drop-sub {
  font-size: var(--text-sm);
  color: var(--color-muted);
}
.drop-enter-active,
.drop-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out-expo);
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
}
</style>
