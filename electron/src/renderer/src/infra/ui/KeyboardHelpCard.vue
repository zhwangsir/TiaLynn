<script setup lang="ts">
/**
 * UX R23: 键盘快捷键帮助卡片。
 *
 * 按 "?" 唤起 — 平台感知（mac 显 ⌘，其他显 Ctrl）。
 * 让用户不用看 README 就能发现功能。
 */
import { computed, ref, toRefs } from 'vue'
import { useFocusTrap } from './useFocusTrap'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const cardRef = ref<HTMLElement | null>(null)
const { open: openRef } = toRefs(props)
useFocusTrap(cardRef, openRef)

/** R23-fix: navigator.platform 已弃用，优先 userAgentData; fallback userAgent (Electron 上没 userAgentData 但 userAgent 总有) */
const isMac = computed(() => {
  const uad = (navigator as unknown as {
    userAgentData?: { platform?: string }
  }).userAgentData
  if (uad?.platform) return uad.platform === 'macOS'
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
})
const cmdKey = computed(() => (isMac.value ? '⌘' : 'Ctrl'))

interface Shortcut {
  keys: string[]
  label: string
}
interface Section {
  title: string
  items: Shortcut[]
}

const sections = computed<Section[]>(() => [
  {
    title: '对话',
    items: [
      { keys: ['Space'], label: '展开 / 收起对话输入' },
      { keys: ['Esc'], label: '关闭对话 / 弹窗' },
      { keys: ['Enter'], label: '发送消息' },
      { keys: ['Shift', 'Enter'], label: '换行' },
      { keys: ['↑', '↓'], label: '浏览历史消息（光标在首/末位时）' },
      { keys: [cmdKey.value, '.'], label: '中止正在生成的回复' },
    ],
  },
  {
    title: '界面',
    items: [
      { keys: [cmdKey.value, '='], label: '放大 UI（不影响立绘）' },
      { keys: [cmdKey.value, '-'], label: '缩小 UI' },
      { keys: [cmdKey.value, '0'], label: '恢复默认 UI 缩放' },
      { keys: [cmdKey.value, 'K'], label: '全局搜索（命令 / 角色 / 历史）' },
      { keys: [cmdKey.value, 'Shift', 'T'], label: '循环切换主题（自动/浅/深）' },
      { keys: ['?'], label: '打开本帮助卡' },
    ],
  },
  {
    title: '立绘',
    items: [
      { keys: ['右键'], label: '弹出主菜单（角色 / 设置 / 灵魂 / 健康）' },
      { keys: ['拖动'], label: '移动桌宠位置' },
      { keys: ['滚轮'], label: '缩放立绘大小' },
      { keys: ['双击'], label: '触发互动动作' },
    ],
  },
  {
    title: '调试',
    items: [
      { keys: [cmdKey.value, 'Alt', 'I'], label: '打开 DevTools（需 TIALYNN_DEBUG=1）' },
    ],
  },
])

function onBackdrop(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('overlay')) {
    emit('close')
  }
}
</script>

<template>
  <transition name="help">
    <div v-if="open" class="overlay" @click="onBackdrop">
      <div ref="cardRef" class="card" role="dialog" aria-modal="true" aria-label="键盘快捷键">
        <header>
          <h2>键盘快捷键</h2>
          <button class="close-btn" aria-label="关闭" @click="emit('close')">✕</button>
        </header>
        <div class="body">
          <section v-for="sec in sections" :key="sec.title" class="sec">
            <h3>{{ sec.title }}</h3>
            <ul>
              <li v-for="it in sec.items" :key="it.label">
                <span class="keys">
                  <kbd v-for="k in it.keys" :key="k" class="kbd">{{ k }}</kbd>
                </span>
                <span class="label">{{ it.label }}</span>
              </li>
            </ul>
          </section>
        </div>
        <footer>
          <span class="tip">按 ? 随时唤起本卡 · 按 Esc 关闭</span>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: oklch(0% 0 0 / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  backdrop-filter: blur(4px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 560px;
  max-height: 82vh;
  overflow: auto;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-bubble-border);
}
h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
}
.close-btn {
  background: transparent;
  color: var(--color-muted);
  font-size: var(--text-sm);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.close-btn:hover {
  background: var(--color-bubble-surface-hover);
  color: var(--color-bubble-text);
}
.body {
  padding: 16px 20px 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
@media (max-width: 520px) {
  .body {
    grid-template-columns: 1fr;
  }
}
.sec h3 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sec ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sec li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-sm);
  line-height: 1.4;
}
.keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: var(--color-bubble-surface);
  border: 1px solid var(--color-bubble-border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-bubble-text);
  box-shadow: 0 1px 0 oklch(0% 0 0 / 0.08);
}
.label {
  color: var(--color-muted);
  text-align: right;
  flex: 1;
}
footer {
  padding: 12px 20px;
  border-top: 1px solid var(--color-bubble-border);
  text-align: center;
}
.tip {
  font-size: 11px;
  color: var(--color-muted);
}

.help-enter-active,
.help-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.help-enter-from,
.help-leave-to {
  opacity: 0;
}
.help-enter-active .card,
.help-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.help-enter-from .card,
.help-leave-to .card {
  transform: scale(0.95) translateY(8px);
}
</style>
