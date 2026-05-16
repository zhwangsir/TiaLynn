<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Live2DStage from './avatar/components/Live2DStage.vue'
import DialogBubble from './infra/ui/DialogBubble.vue'
import InputBar from './infra/ui/InputBar.vue'
import ContextMenu, { type MenuItem } from './infra/ui/ContextMenu.vue'
import SettingsPanel from './infra/ui/SettingsPanel.vue'
import ErrorBoundary from './infra/ui/ErrorBoundary.vue'
import ToastStack from './infra/ui/ToastStack.vue'
import { iconChat, iconGear, iconMinus, iconPin, iconReload, iconX } from './infra/ui/icons'
import { useConfigStore } from './infra/stores/config'
import { useDialogStore } from './brain/stores/dialog'
import { useSpeechStore } from './presence/stores/speech'
import { bus } from './infra/eventbus'

const cfg = useConfigStore()
const dialog = useDialogStore()
const speech = useSpeechStore()

const ready = ref(false)
const settingsOpen = ref(false)
const inputOpen = ref(false)
const pinned = ref(true)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)

// 任何模态打开时关闭穿透判定（避免点击被穿透到下层）
const passthroughEnabled = computed(() => !settingsOpen.value && !menuOpen.value)

const menuItems = computed<MenuItem[]>(() => [
  { id: 'chat', label: inputOpen.value ? '隐藏输入框' : '打开对话', icon: iconChat, shortcut: '↵' },
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

onMounted(async () => {
  await cfg.bootstrap()
  dialog.bootstrap()
  speech.bootstrap()
  dialog.injectGreeting()
  ready.value = true

  const handler = ({ x, y }: { x: number; y: number }): void => openMenu(x, y)
  bus.on('avatar:contextmenu', handler)
  offCtxMenuFn = () => bus.off('avatar:contextmenu', handler)

  // 主进程把 yaml 改了 → 自动重载 soul（保持 store 与磁盘一致）
  offSoulFn = window.api.soul.onChanged(() => {
    void cfg.reloadSoul()
  })
})

onBeforeUnmount(() => {
  offCtxMenuFn?.()
  offSoulFn?.()
})
</script>

<template>
  <ErrorBoundary>
    <div class="root">
      <Live2DStage v-if="ready" :passthrough-enabled="passthroughEnabled" />
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
      <ToastStack />
      <div v-if="!ready" class="boot-hint">召唤 TiaLynn 中…</div>
      <div v-else class="hint" key="ready-hint">右键人物可以打开菜单</div>
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
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  font-size: var(--text-xs);
  color: var(--color-muted);
  background: var(--color-bubble);
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  white-space: nowrap;
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
</style>
