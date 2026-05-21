/**
 * useFocusTrap — overlay dialog 的 a11y composable (R29)。
 *
 * 功能:
 *   1. 打开时 focus 容器内第一个可聚焦元素
 *   2. Tab / Shift+Tab 循环困在容器内
 *   3. 关闭时把 focus 还给打开前激活的元素
 *
 * 使用:
 *   const containerRef = ref<HTMLElement | null>(null)
 *   useFocusTrap(containerRef, () => props.open)
 *
 * 不监听 Escape — 各组件已有自己的 Esc 处理逻辑（避免冲突）。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  isActive: () => boolean,
): void {
  const previouslyFocused = ref<HTMLElement | null>(null)

  function getFocusable(): HTMLElement[] {
    const root = containerRef.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
    )
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!isActive() || e.key !== 'Tab') return
    const root = containerRef.value
    if (!root) return
    // 仅当 focus 还在容器内时才劫持 (允许其他全局快捷键照旧)
    if (!root.contains(document.activeElement)) return
    const focusable = getFocusable()
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  watch(isActive, (now) => {
    if (now) {
      previouslyFocused.value = document.activeElement as HTMLElement | null
      // 等容器挂载后再 focus
      void Promise.resolve().then(() => {
        const focusable = getFocusable()
        focusable[0]?.focus()
      })
      window.addEventListener('keydown', onKeydown, true)
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      previouslyFocused.value?.focus?.()
      previouslyFocused.value = null
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
    previouslyFocused.value?.focus?.()
  })
}
