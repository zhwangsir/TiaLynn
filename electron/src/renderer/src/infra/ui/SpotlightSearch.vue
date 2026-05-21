<script setup lang="ts">
/**
 * UX R24: Cmd+K 全局 Spotlight 搜索。
 *
 * 4 类结果（按相关度排序）:
 *   ⚡ 命令  — 切换角色 / 打开设置 / 重载灵魂 / 清空对话 等
 *   🎭 角色  — 角色名称匹配
 *   📜 历史  — 对话内容子串
 *   ⚙️ 设置  — 设置项关键词
 *
 * 键盘:
 *   ↑↓ 选择
 *   Enter 执行
 *   Esc 关闭
 *
 * 不引依赖 — 用简单 substring + length-based score (越短匹配越优先)。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bus } from '../eventbus'
import { useCharacterStore } from '../stores/character'
import { useThemeMode } from './useThemeMode'
import type { Character } from '@shared/character'

interface ResultItem {
  /** 唯一 id 用于 key */
  key: string
  icon: string
  group: '命令' | '角色' | '历史' | '设置'
  title: string
  subtitle?: string
  /** R78: 快捷键 hint 显示在 group 标签前 */
  shortcut?: string
  /** 0~1 越高越前 */
  score: number
  /** 选中后执行 */
  action: () => void
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'open-settings'): void
  (e: 'open-character-picker'): void
  (e: 'open-soul-editor'): void
  (e: 'open-input'): void
  (e: 'open-onboarding'): void
  (e: 'reload-model'): void
  (e: 'clear-dialog'): void
}>()

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement>()

const characterStore = useCharacterStore()
const theme = useThemeMode()
const characters = ref<Character[]>([])
const historyTurns = ref<Array<{ id: string; text: string; role: string; ts: number }>>(
  [],
)

watch(
  () => props.open,
  async (now) => {
    if (now) {
      query.value = ''
      selected.value = 0
      await refreshSources()
      void nextTick(() => inputEl.value?.focus())
    }
  },
)

async function refreshSources(): Promise<void> {
  try {
    characters.value = await window.api.characters.list()
  } catch {
    characters.value = []
  }
  try {
    historyTurns.value = (await window.api.history.listRecent(200)).map((t) => ({
      id: t.id,
      text: t.text,
      role: t.role,
      ts: t.ts,
    }))
  } catch {
    historyTurns.value = []
  }
}

// ——— 命令源（始终可用，不需要 IPC）———
/** R78: platform 感知快捷键标签 */
const cmdKey: string = (() => {
  const uad = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
  const isMac = uad?.platform === 'macOS' || /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  return isMac ? '⌘' : 'Ctrl'
})()

interface Command {
  title: string
  hint: string
  /** R78: 已绑定的快捷键 hint, 显示在结果项右侧 */
  shortcut?: string
  do: () => void
}
const commands: Command[] = [
  { title: '打开设置', hint: '⚙️', do: () => emit('open-settings') },
  { title: '切换角色', hint: '🎭', do: () => emit('open-character-picker') },
  { title: '编辑灵魂', hint: '✏️', do: () => emit('open-soul-editor') },
  { title: '打开对话输入', hint: '💬', shortcut: 'Space', do: () => emit('open-input') },
  { title: '重载模型 / 灵魂', hint: '🔄', do: () => emit('reload-model') },
  { title: '清空对话历史', hint: '🧹', do: () => emit('clear-dialog') },
  { title: '重新打开引导 (Onboarding)', hint: '🪄', do: () => emit('open-onboarding') },
  { title: '主题：跟随系统', hint: '🌓', shortcut: `${cmdKey}+⇧T`, do: () => theme.setMode('auto') },
  { title: '主题：浅色模式', hint: '☀️', shortcut: `${cmdKey}+⇧T`, do: () => theme.setMode('light') },
  { title: '主题：深色模式', hint: '🌙', shortcut: `${cmdKey}+⇧T`, do: () => theme.setMode('dark') },
]

// ——— 设置索引（静态关键词 → 跳设置）———
interface SettingHit {
  keyword: string
  detail: string
}
const settingsKeywords: SettingHit[] = [
  { keyword: 'LLM endpoint 模型', detail: '配置 LLM 后端' },
  { keyword: 'TTS sidecar 语音', detail: 'TTS 服务地址' },
  { keyword: 'Vision 视觉 截图', detail: '启用视觉感知' },
  { keyword: 'Memory 记忆 长期', detail: '长期记忆 / RAG' },
  { keyword: 'MCP 工具', detail: '外部 MCP 工具服务器' },
  { keyword: '主题 颜色 dark light', detail: '配色主题' },
  { keyword: '快捷键 按键', detail: '查看快捷键 (按 ?)' },
]

/** R46: 命令使用频次记忆 — localStorage 持久化让常用命令上浮 */
const USAGE_STORAGE_KEY = 'tialynn-spotlight-cmd-usage'

function loadUsage(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 安全 — 仅保留 string→number 项
      const safe: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) safe[k] = v
      }
      return safe
    }
    return {}
  } catch {
    return {}
  }
}

function bumpUsage(title: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const usage = loadUsage()
    usage[title] = (usage[title] ?? 0) + 1
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage))
  } catch {
    // localStorage 满 / 隐私 — 静默
  }
}

/** R49-fix (HIGH): 接受已读出的 usage map, 避免 computed 内 n 次 JSON.parse */
function usageBoostFromMap(usage: Record<string, number>, title: string): number {
  const count = usage[title] ?? 0
  if (count === 0) return 0
  // 平方根衰减 — 用 10 次 ≈ +0.31, 用 100 次 ≈ +1.0 (天花板)
  return Math.min(1, Math.sqrt(count) / 10)
}

function scoreMatch(text: string, q: string): number {
  if (!q) return 0
  const lt = text.toLowerCase()
  const lq = q.toLowerCase()
  const idx = lt.indexOf(lq)
  if (idx === -1) return 0
  // 开头匹配最高分；越短越准
  const startBoost = idx === 0 ? 0.3 : 0
  const lenBoost = Math.max(0, 1 - lt.length / 200) * 0.2
  return 0.5 + startBoost + lenBoost
}

const results = computed<ResultItem[]>(() => {
  const q = query.value.trim()
  const out: ResultItem[] = []
  // R49-fix: 一次性读 usage map, 循环内 O(1) lookup
  const usageMap = loadUsage()

  // 命令 — R46 加 usageBoost 让常用项排前
  for (const c of commands) {
    const matchScore = q ? scoreMatch(c.title, q) : 0.5
    if (q && matchScore === 0) continue
    out.push({
      key: `cmd-${c.title}`,
      icon: c.hint,
      group: '命令',
      title: c.title,
      ...(c.shortcut !== undefined && { shortcut: c.shortcut }),
      score: matchScore + 0.1 + usageBoostFromMap(usageMap, c.title),
      action: () => {
        bumpUsage(c.title)
        emit('close')
        c.do()
      },
    })
  }

  // 角色
  for (const c of characters.value) {
    const s = q ? scoreMatch(c.name, q) : 0.4
    if (q && s === 0) continue
    out.push({
      key: `char-${c.id}`,
      icon: '🎭',
      group: '角色',
      title: c.name,
      ...(c.template !== undefined && { subtitle: `template: ${c.template}` }),
      score: s,
      action: () => {
        emit('close')
        void characterStore.switchTo(c.id)
      },
    })
  }

  // 历史（只在有 query 时显示，避免噪音）
  if (q && q.length >= 2) {
    for (const t of historyTurns.value) {
      const s = scoreMatch(t.text, q)
      if (s === 0) continue
      out.push({
        key: `his-${t.id}`,
        icon: t.role === 'user' ? '🧑' : '💬',
        group: '历史',
        title: t.text.slice(0, 80),
        subtitle: new Date(t.ts).toLocaleString('zh-CN'),
        score: s - 0.1, // 历史略后
        action: () => {
          emit('close')
          bus.emit('ui:toast', {
            kind: 'info',
            message: '历史定位功能待加 — 已复制到剪贴板',
            ttl_ms: 3000,
          })
          void navigator.clipboard.writeText(t.text).catch(() => {})
        },
      })
    }
  }

  // 设置关键词
  for (const k of settingsKeywords) {
    const s = q ? scoreMatch(k.keyword, q) : 0
    if (q && s === 0) continue
    out.push({
      key: `set-${k.keyword}`,
      icon: '⚙️',
      group: '设置',
      title: k.keyword,
      subtitle: k.detail,
      score: s,
      action: () => {
        emit('close')
        emit('open-settings')
      },
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 18)
})

// 重置选中索引
watch(results, () => {
  selected.value = 0
})

function onKey(e: KeyboardEvent): void {
  if (!props.open) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = Math.min(selected.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = Math.max(selected.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value[selected.value]
    if (item) item.action()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
})

function onBackdrop(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('overlay')) {
    emit('close')
  }
}
</script>

<template>
  <transition name="spot">
    <div v-if="open" class="overlay" @click="onBackdrop">
      <div class="card" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div class="input-row">
          <span class="search-icon">🔍</span>
          <input
            ref="inputEl"
            v-model="query"
            class="search-input"
            type="text"
            placeholder="搜命令 / 角色 / 历史 / 设置… (Esc 关闭)"
            spellcheck="false"
            autocomplete="off"
          />
          <span class="kbd-hint">↑↓ ↵ Esc</span>
        </div>
        <ul class="results" role="listbox">
          <li
            v-for="(r, i) in results"
            :key="r.key"
            :class="['item', { active: i === selected }]"
            role="option"
            :aria-selected="i === selected"
            @click="r.action()"
            @mouseenter="selected = i"
          >
            <span class="item-icon">{{ r.icon }}</span>
            <div class="item-main">
              <div class="item-title">{{ r.title }}</div>
              <div v-if="r.subtitle" class="item-sub">{{ r.subtitle }}</div>
            </div>
            <span v-if="r.shortcut" class="item-shortcut">{{ r.shortcut }}</span>
            <span class="item-group">{{ r.group }}</span>
          </li>
          <li v-if="results.length === 0" class="empty">
            {{ query ? `没有匹配 "${query}"` : '输入关键字搜索…' }}
          </li>
        </ul>
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
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 2200;
  backdrop-filter: blur(6px);
}
.card {
  background: var(--color-bubble);
  color: var(--color-bubble-text);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 92%;
  max-width: 620px;
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-bubble-border);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
}
.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-bubble-border);
}
.search-icon {
  font-size: 16px;
  color: var(--color-muted);
}
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-bubble-text);
  font-size: var(--text-base);
  font-family: inherit;
}
.search-input::placeholder {
  color: var(--color-muted);
}
.kbd-hint {
  font-size: 10px;
  color: var(--color-muted);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.results {
  list-style: none;
  padding: 6px;
  margin: 0;
  overflow-y: auto;
  flex: 1;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast);
}
.item.active {
  background: var(--color-accent-soft);
}
.item-icon {
  width: 24px;
  text-align: center;
  font-size: 14px;
  flex-shrink: 0;
}
.item-main {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-size: var(--text-sm);
  color: var(--color-bubble-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-sub {
  font-size: 11px;
  color: var(--color-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* R78: 已绑定快捷键 hint */
.item-shortcut {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-bubble);
  border: 1px solid var(--color-bubble-border);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--color-muted);
  flex-shrink: 0;
}
.item.active .item-shortcut {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.item-group {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-bubble-surface);
  color: var(--color-muted);
  flex-shrink: 0;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--color-muted);
  font-size: var(--text-sm);
}

.spot-enter-active,
.spot-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out-expo);
}
.spot-enter-from,
.spot-leave-to {
  opacity: 0;
}
.spot-enter-active .card,
.spot-leave-active .card {
  transition: transform var(--duration-normal) var(--ease-out-back);
}
.spot-enter-from .card,
.spot-leave-to .card {
  transform: translateY(-12px) scale(0.97);
}
</style>
