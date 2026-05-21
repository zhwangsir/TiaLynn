/**
 * Character store (v0.14 + v0.21 Round M) — 当前 active character + 列表 + 切换 action。
 *
 * Round M:加 mounted state(M8 灵魂社会前置)。"mounted" 跟 active 区分:
 *   - active = GUI 焦点单选(立绘渲染哪个/对话历史用哪个 db)
 *   - mounted = 代码层并行存活集合(每个有独立 planner / memory)
 * mounted 总含 active(后端自动补)。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Character, CreateCharacterInput } from '@shared/character'
import { bus } from '../eventbus'

export const useCharacterStore = defineStore('character', () => {
  const active = ref<Character | null>(null)
  const all = ref<Character[]>([])
  const switching = ref(false)

  /** Round M:mounted 状态(M8 灵魂社会 UI 层入口) */
  const mounted = ref<Character[]>([])
  const mountedIds = computed(() => mounted.value.map((c) => c.id))
  /**
   * Round M(reviewer MEDIUM-3): toggle 进行中的 id,防止 sub-30ms 双击造成
   * stale-snapshot 竞争(两个 IPC 请求基于相同 pre-mutation 基线构造 next 集合)。
   * 对齐既有 `switching` 模式。
   */
  const toggleMounting = ref<string | null>(null)

  async function bootstrap(): Promise<void> {
    try {
      const [a, list, mountedList] = await Promise.all([
        window.api.characters.active(),
        window.api.characters.list(),
        window.api.characters.listMounted(),
      ])
      active.value = a
      all.value = list
      mounted.value = mountedList
    } catch (e) {
      console.error('[character] bootstrap failed', e)
    }
    // 监听主进程切角色通知
    window.api.characters.onSwitched((c) => {
      active.value = c
      bus.emit('character:switched', { character: c })
      // active 切换时 mounted 后端会自动补 active 到首位,前端同步刷
      void refreshMounted()
    })
    // 监听对话结束 → 刷新当前 character (拿最新 intimacy / last_chat_at)
    bus.on('brain:reply-end', () => {
      void refreshActive()
    })
  }

  async function refreshActive(): Promise<void> {
    try {
      const a = await window.api.characters.active()
      if (a) active.value = a
    } catch {
      /* skip */
    }
  }

  async function refreshMounted(): Promise<void> {
    try {
      mounted.value = await window.api.characters.listMounted()
    } catch (e) {
      console.warn('[character] refreshMounted failed', e)
    }
  }

  async function refresh(): Promise<void> {
    try {
      all.value = await window.api.characters.list()
      active.value = await window.api.characters.active()
      await refreshMounted()
    } catch (e) {
      console.warn('[character] refresh failed', e)
    }
  }

  async function switchTo(id: string): Promise<{ ok: boolean; reason?: string }> {
    if (switching.value) return { ok: false, reason: 'already-switching' }
    switching.value = true
    try {
      const r = await window.api.characters.switch(id)
      if (r.ok && r.character) {
        active.value = r.character
        await refresh()
      }
      return r
    } finally {
      switching.value = false
    }
  }

  async function create(input: CreateCharacterInput): Promise<
    { ok: true; character: Character } | { ok: false; reason: string }
  > {
    const r = await window.api.characters.create(input)
    if (r.ok) await refresh()
    return r
  }

  async function remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const r = await window.api.characters.delete(id)
    if (r.ok) await refresh()
    return r
  }

  async function clone(
    sourceId: string,
    newName?: string,
  ): Promise<{ ok: boolean; character?: Character; reason?: string }> {
    const r = await window.api.characters.clone({
      source_id: sourceId,
      ...(newName ? { new_name: newName } : {}),
    })
    if (r.ok) await refresh()
    return r
  }

  /**
   * Round M:切换 mount 状态。
   * - active 不能 unmount(backend 也会自动补回,前端先拒掉给好的 toast)
   * - 后端做去重 + 自动补 active + 16 个上限,前端只透传
   * - reviewer MEDIUM-3:in-flight 锁防 sub-30ms 多卡片连击 stale 竞争
   */
  async function toggleMount(
    id: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (toggleMounting.value) {
      return { ok: false, reason: 'busy' }
    }
    const isCurrentlyMounted = mountedIds.value.includes(id)
    if (id === active.value?.id && isCurrentlyMounted) {
      return { ok: false, reason: 'cannot_unmount_active' }
    }
    const cur = new Set(mountedIds.value)
    if (isCurrentlyMounted) cur.delete(id)
    else cur.add(id)
    const next = Array.from(cur)
    toggleMounting.value = id
    try {
      const r = await window.api.characters.setMounted(next)
      if (r.ok) {
        mounted.value = r.mounted
        return { ok: true }
      }
      return { ok: false, reason: r.reason }
    } catch (e) {
      console.warn('[character] toggleMount failed', e)
      return { ok: false, reason: String(e).slice(0, 200) }
    } finally {
      toggleMounting.value = null
    }
  }

  function isMounted(id: string): boolean {
    return mountedIds.value.includes(id)
  }

  return {
    active,
    all,
    switching,
    mounted,
    mountedIds,
    toggleMounting,
    bootstrap,
    refresh,
    refreshMounted,
    switchTo,
    create,
    remove,
    clone,
    toggleMount,
    isMounted,
  }
})
