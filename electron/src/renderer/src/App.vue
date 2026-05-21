<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Live2DStage from './avatar/components/Live2DStage.vue'
import DialogBubble from './infra/ui/DialogBubble.vue'
import InputBar from './infra/ui/InputBar.vue'
import ContextMenu, { type MenuItem } from './infra/ui/ContextMenu.vue'
import SettingsPanel from './infra/ui/SettingsPanel.vue'
// v0.17: ControlDock 已移除 — 功能迁到右键菜单
import ResourceStorePanel from './infra/ui/ResourceStorePanel.vue'
import ErrorBoundary from './infra/ui/ErrorBoundary.vue'
import ToastStack from './infra/ui/ToastStack.vue'
import ApprovalDialog from './infra/ui/ApprovalDialog.vue'
import CreatorStudioPanel from './infra/ui/CreatorStudioPanel.vue'
import OnboardingDialog from './infra/ui/OnboardingDialog.vue'
import ServiceStatusPill from './infra/ui/ServiceStatusPill.vue'
import KeyboardHelpCard from './infra/ui/KeyboardHelpCard.vue'
import SpotlightSearch from './infra/ui/SpotlightSearch.vue'
import BootSplash from './infra/ui/BootSplash.vue'
import { useThemeMode } from './infra/ui/useThemeMode'
// v0.17: CharacterStatusBar 已移除 — 角色信息收到右键菜单 "切换角色" 项
import CharacterPicker from './infra/ui/CharacterPicker.vue'
import CharacterCreator from './infra/ui/CharacterCreator.vue'
import SoulEditor from './infra/ui/SoulEditor.vue'
import ModelHealthDashboard from './infra/ui/ModelHealthDashboard.vue'
import SceneBackground from './infra/ui/SceneBackground.vue'
import EmotionParticles from './infra/ui/EmotionParticles.vue'
import StickerOverlay from './avatar/components/StickerOverlay.vue'
import { useCharacterStore } from './infra/stores/character'
import { iconChat, iconGear, iconMinus, iconPin, iconReload, iconX } from './infra/ui/icons'
import { useConfigStore } from './infra/stores/config'
import { useDialogStore } from './brain/stores/dialog'
import { useSpeechStore } from './presence/stores/speech'
import { useApprovalStore } from './hands/approval-store'
import { bus } from './infra/eventbus'

const cfg = useConfigStore()
const dialog = useDialogStore()
// R33: 主题模式初始化 (auto/light/dark) — composable 自管 DOM 写入
const theme = useThemeMode()
const speech = useSpeechStore()
const approval = useApprovalStore()
const character = useCharacterStore()

const ready = ref(false)
const settingsOpen = ref(false)
const keyboardHelpOpen = ref(false)
const spotlightOpen = ref(false)
const creatorStudioOpen = ref(false)
const libraryOpen = ref(false)
const inputOpen = ref(false)
const pinned = ref(true)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const onboardingOpen = ref(false)
const characterPickerOpen = ref(false)
const characterCreatorOpen = ref(false)
const soulEditorOpen = ref(false)
const healthDashboardOpen = ref(false)

// 任何模态打开时关闭穿透判定（避免点击被穿透到下层）
const passthroughEnabled = computed(
  () =>
    !settingsOpen.value &&
    !creatorStudioOpen.value &&
    !menuOpen.value &&
    !libraryOpen.value &&
    !onboardingOpen.value &&
    !characterPickerOpen.value &&
    !characterCreatorOpen.value &&
    !soulEditorOpen.value &&
    !healthDashboardOpen.value &&
    !inputOpen.value,
)

const menuItems = computed<MenuItem[]>(() => [
  { id: 'chat', label: inputOpen.value ? '隐藏输入框' : '💬 打开对话', icon: iconChat, shortcut: '↵' },
  { id: 'sep0', label: '', separator: true },
  // 角色
  { id: 'pick-character', label: `🎭 切换角色${character.active ? ` (当前: ${character.active.name})` : ''}`, icon: iconChat },
  { id: 'soul-editor', label: '✏️ 编辑灵魂', icon: iconChat },
  { id: 'sep-char', label: '', separator: true },
  // 模型与资源
  { id: 'library', label: '🎁 资源商店', icon: iconChat },
  { id: 'creator-studio', label: '🎨 创作工坊', icon: iconChat },
  { id: 'health-dashboard', label: '🔬 模型健康仪表盘', icon: iconChat },
  { id: 'reload', label: '🔄 重载模型 / 灵魂', icon: iconReload },
  { id: 'sep-model', label: '', separator: true },
  // 立绘缩放
  { id: 'zoom-in', label: '🔍 放大立绘 (+)' },
  { id: 'zoom-out', label: '🔎 缩小立绘 (−)' },
  { id: 'zoom-reset', label: '↻ 复原大小（auto-fit）' },
  { id: 'sep-zoom', label: '', separator: true },
  // 设置
  { id: 'settings', label: '⚙️ 设置', icon: iconGear },
  {
    id: 'theme-cycle',
    label: `🎨 主题：${theme.mode.value === 'auto' ? '跟随系统' : theme.mode.value === 'light' ? '浅色' : '深色'}`,
  },
  { id: 'keyboard-help', label: '⌨️ 快捷键帮助 (?)', icon: iconGear },
  { id: 'sep-sys', label: '', separator: true },
  // 窗口
  { id: 'pin', label: pinned.value ? '📌 取消置顶' : '📍 置顶', icon: iconPin },
  { id: 'minimize', label: '— 收起', icon: iconMinus },
  { id: 'sep-end', label: '', separator: true },
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
    case 'keyboard-help':
      keyboardHelpOpen.value = true
      break
    case 'theme-cycle':
      theme.cycle()
      bus.emit('ui:toast', {
        kind: 'info',
        message: `主题：${theme.mode.value === 'auto' ? '跟随系统' : theme.mode.value === 'light' ? '浅色模式' : '深色模式'}`,
        ttl_ms: 2500,
      })
      break
    case 'creator-studio':
      creatorStudioOpen.value = true
      break
    case 'library':
      libraryOpen.value = true
      break
    case 'pick-character':
      characterPickerOpen.value = true
      break
    case 'soul-editor':
      soulEditorOpen.value = true
      break
    case 'health-dashboard':
      healthDashboardOpen.value = true
      break
    case 'zoom-in':
      bus.emit('avatar:zoom', { delta: 0.15 })
      break
    case 'zoom-out':
      bus.emit('avatar:zoom', { delta: -0.15 })
      break
    case 'zoom-reset':
      bus.emit('avatar:zoom', { delta: 0, reset: true })
      break
    case 'ui-zoom-in':
      applyUIScale(Math.min(1.6, Math.round((uiScale.value + 0.1) * 10) / 10))
      break
    case 'ui-zoom-out':
      applyUIScale(Math.max(0.7, Math.round((uiScale.value - 0.1) * 10) / 10))
      break
    case 'ui-zoom-reset':
      applyUIScale(1)
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
let offTrayFn: (() => void) | null = null
let offCharSwitchedFn: (() => void) | null = null
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
  // R34: 按扩展名分流 — yaml/png 给针对性引导，其他走默认 Live2D 安装
  const ymls = paths.filter((p) => /\.(ya?ml)$/i.test(p))
  const imgs = paths.filter((p) => /\.(png|jpe?g|webp|gif)$/i.test(p))
  if (ymls.length > 0 && ymls.length === paths.length) {
    bus.emit('ui:toast', {
      kind: 'info',
      message: `检测到 ${ymls.length} 个 yaml 文件 — 灵魂编辑用「右键 → ✏️ 编辑灵魂」直接粘贴内容会更安全`,
      ttl_ms: 8000,
    })
    soulEditorOpen.value = true
    return
  }
  if (imgs.length > 0 && imgs.length === paths.length) {
    bus.emit('ui:toast', {
      kind: 'info',
      message: `检测到 ${imgs.length} 张图片 — 头像 / 场景背景请在「角色管理」或「场景」设置里上传`,
      ttl_ms: 7000,
    })
    return
  }
  // 走默认 Live2D 模型 zip / 目录安装
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
  const charSwitchedHandler = async (): Promise<void> => {
    await dialog.bootstrap()  // reload per-character history
    await cfg.reloadSoul()    // 新角色的灵魂
    bus.emit('ui:toast', {
      kind: 'success',
      message: `已切换到 ${character.active?.name ?? '?'}`,
      ttl_ms: 2500,
    })
  }
  bus.on('character:switched', charSwitchedHandler)
  offCharSwitchedFn = () => bus.off('character:switched', charSwitchedHandler)

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
  // v0.17 P3: tray 菜单点击 → 走 renderer 同一套 onMenuSelect 分支
  offTrayFn = window.api.system.onTrayAction((id) => { void onMenuSelect(id) })

  // v0.17 (二次)：全局 UI 缩放快捷键 Cmd/Ctrl + = / - / 0
  //   用 transform: scale 通过 :root --ui-scale，应用在 global.css 的 panel selector 上。
  //   不像之前 .ui-overlay-layer + zoom 那样会破坏 fixed children 事件路径。
  const persisted = Number(localStorage.getItem('ui-scale') ?? '1') || 1
  applyUIScale(Math.min(1.6, Math.max(0.7, persisted)))
  window.addEventListener('keydown', onScaleKey)
})

const uiScale = ref(1)

function applyUIScale(s: number): void {
  uiScale.value = s
  document.documentElement.style.setProperty('--ui-scale', String(s))
  localStorage.setItem('ui-scale', String(s))
}

function onScaleKey(e: KeyboardEvent): void {
  // UX R23: ? 唤起快捷键卡（不需要修饰键 — 但要避免在 input/textarea 内触发）
  if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const t = e.target as HTMLElement | null
    const tag = t?.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !t?.isContentEditable) {
      e.preventDefault()
      keyboardHelpOpen.value = !keyboardHelpOpen.value
      return
    }
  }
  // R23: Esc 关闭帮助卡
  if (e.key === 'Escape' && keyboardHelpOpen.value) {
    e.preventDefault()
    keyboardHelpOpen.value = false
    return
  }
  if (!e.metaKey && !e.ctrlKey) return
  // UX R24: Cmd/Ctrl + K 唤起全局 Spotlight 搜索
  if (e.key === 'k' || e.key === 'K') {
    e.preventDefault()
    spotlightOpen.value = !spotlightOpen.value
    return
  }
  // R33: Cmd/Ctrl + Shift + T 循环切主题 (auto → light → dark)
  if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault()
    theme.cycle()
    bus.emit('ui:toast', {
      kind: 'info',
      message: `主题：${theme.mode.value === 'auto' ? '跟随系统' : theme.mode.value === 'light' ? '浅色模式' : '深色模式'}`,
      ttl_ms: 2000,
    })
    return
  }
  const cur = uiScale.value
  if (e.key === '=' || e.key === '+') {
    e.preventDefault()
    applyUIScale(Math.min(1.6, Math.round((cur + 0.1) * 10) / 10))
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    applyUIScale(Math.max(0.7, Math.round((cur - 0.1) * 10) / 10))
  } else if (e.key === '0') {
    e.preventDefault()
    applyUIScale(1)
  }
}

onBeforeUnmount(() => {
  offCtxMenuFn?.()
  offSoulFn?.()
  offInstalledFn?.()
  offAttentionPlanFn?.()
  offTrayFn?.()
  offCharSwitchedFn?.()
  window.removeEventListener('keydown', onScaleKey)
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
      <SceneBackground v-if="ready" />
      <Live2DStage v-if="ready" :passthrough-enabled="passthroughEnabled" />
      <EmotionParticles v-if="ready" />
      <!-- v0.17：桌面减法 — 移除 CharacterStatusBar 和 ControlDock
           功能全部迁到右键菜单（menuItems）+ 系统状态栏 Tray (P3)。
           桌面只保留：背景 / Live2D 立绘 / 情绪粒子 / 对话气泡 / 贴纸 / 输入框 -->
      <DialogBubble v-if="ready" />
      <StickerOverlay v-if="ready" />
      <InputBar v-if="ready && inputOpen" @close="closeInput" />
      <ContextMenu
        :open="menuOpen"
        :x="menuX"
        :y="menuY"
        :items="menuItems"
        @select="onMenuSelect"
        @close="closeMenu"
      />
      <ErrorBoundary scope="panel" label="设置面板">
        <SettingsPanel v-if="settingsOpen" @close="closeSettings" />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="创作工坊">
        <CreatorStudioPanel v-if="creatorStudioOpen" @close="creatorStudioOpen = false" />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="资源商店">
        <ResourceStorePanel v-if="libraryOpen" @close="libraryOpen = false" />
      </ErrorBoundary>
      <OnboardingDialog v-if="onboardingOpen" @close="onboardingOpen = false" />
      <ServiceStatusPill v-if="ready" @open-settings="settingsOpen = true" />
      <KeyboardHelpCard :open="keyboardHelpOpen" @close="keyboardHelpOpen = false" />
      <SpotlightSearch
        :open="spotlightOpen"
        @close="spotlightOpen = false"
        @open-settings="settingsOpen = true"
        @open-character-picker="characterPickerOpen = true"
        @open-soul-editor="soulEditorOpen = true"
        @open-input="inputOpen = true"
        @reload-model="bus.emit('avatar:reload-model')"
        @clear-dialog="dialog.clear()"
      />
      <ErrorBoundary scope="panel" label="角色选择器">
        <CharacterPicker
          v-if="characterPickerOpen"
          @close="characterPickerOpen = false"
          @open-creator="() => { characterPickerOpen = false; characterCreatorOpen = true }"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="角色创建">
        <CharacterCreator
          v-if="characterCreatorOpen"
          @close="characterCreatorOpen = false"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="灵魂编辑器">
        <SoulEditor
          v-if="soulEditorOpen"
          @close="soulEditorOpen = false"
        />
      </ErrorBoundary>
      <ErrorBoundary scope="panel" label="模型健康仪表">
        <ModelHealthDashboard
          v-if="healthDashboardOpen"
          @close="healthDashboardOpen = false"
        />
      </ErrorBoundary>
      <ApprovalDialog />
      <ToastStack />
      <BootSplash :ready="ready" />
      <div v-if="ready" class="hint" key="ready-hint">右键人物可以打开菜单 · 按 ? 看快捷键</div>
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
