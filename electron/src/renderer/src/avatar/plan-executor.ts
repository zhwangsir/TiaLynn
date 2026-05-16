/**
 * BehaviorPlan 执行器 — 在 renderer 把 plan.actions 序列依次落到立绘 / 对话 / TTS。
 *
 * 关键：plan 的执行是异步、可中断的（新 plan 来时取消旧的）。
 */
import { ref } from 'vue'
import type { BehaviorAction, BehaviorPlan } from '@shared/attention'
import type { Live2DRenderer } from './render/live2d-renderer'
import { bus } from '../infra/eventbus'
import { useDialogStore } from '../brain/stores/dialog'

interface ExecOpts {
  renderer: Live2DRenderer
  container: HTMLElement
}

/** 当前执行状态 */
export const currentPlan = ref<BehaviorPlan | null>(null)
let abortFlag = { aborted: false }

export async function executePlan(plan: BehaviorPlan, opts: ExecOpts): Promise<void> {
  // 取消旧的
  abortFlag.aborted = true
  abortFlag = { aborted: false }
  const myAbort = abortFlag
  currentPlan.value = plan

  for (const action of plan.actions) {
    if (myAbort.aborted) break
    try {
      await executeOne(action, opts)
    } catch (e) {
      console.warn('[plan-executor]', action.type, 'failed:', e)
    }
  }
  if (!myAbort.aborted) currentPlan.value = null
}

async function executeOne(action: BehaviorAction, opts: ExecOpts): Promise<void> {
  switch (action.type) {
    case 'glance_at_screen':
      return doGlance(action, opts)
    case 'look_back_to_master':
      return doLookBack(action, opts)
    case 'speak':
      return doSpeak(action)
    case 'play_motion':
      return doPlayMotion(action)
    case 'change_emotion':
      return doChangeEmotion(action)
    case 'idle_subtle':
      return new Promise((r) => setTimeout(r, action.duration_ms))
  }
}

/** 屏幕坐标 → 立绘 canvas 坐标 → setGaze */
async function doGlance(
  action: Extract<BehaviorAction, { type: 'glance_at_screen' }>,
  opts: ExecOpts,
): Promise<void> {
  // 窗口 bounds 主进程拿，转 canvas 局部
  const bounds = await window.api.window.getBounds()
  if (!bounds) return
  const localX = action.screen_x - bounds.x
  const localY = action.screen_y - bounds.y
  // canvas 中心相对值（设备坐标 → 立绘视线参数空间）
  const rect = opts.container.getBoundingClientRect()
  // 注意：localX/Y 可能为负或超 rect.width/height（鼠标在窗口外）
  // 转 setGaze 的"canvas 局部坐标" — setGaze 内会算 (cx, cy) → 视线归一化
  // 即便落在窗口外，也能驱动立绘向那个方向看（参数会被钳到 ±30）
  opts.renderer.setGaze(localX, localY)
  await new Promise((r) => setTimeout(r, action.duration_ms))
  void rect
}

async function doLookBack(
  action: Extract<BehaviorAction, { type: 'look_back_to_master' }>,
  opts: ExecOpts,
): Promise<void> {
  // 看向 canvas 中心 = 正面对主人
  const rect = opts.container.getBoundingClientRect()
  opts.renderer.setGaze(rect.width / 2, rect.height / 2)
  await new Promise((r) => setTimeout(r, action.duration_ms))
}

async function doSpeak(action: Extract<BehaviorAction, { type: 'speak' }>): Promise<void> {
  // 主动说话 — 注入 assistant turn
  const dialog = useDialogStore()
  dialog.injectAssistantUtterance(action.text, action.emotion, action.intensity)
  // TTS 由 speech store 自动接 reply-end 事件触发，所以也走 emit
  bus.emit('brain:reply-end', {
    stream_id: `proactive-${Date.now()}`,
    full_text: action.text,
    emotion: action.emotion,
    intensity: action.intensity,
  })
  bus.emit('brain:emotion-changed', { emotion: action.emotion, intensity: action.intensity })
}

async function doPlayMotion(
  action: Extract<BehaviorAction, { type: 'play_motion' }>,
): Promise<void> {
  if (action.source === 'library_template' && action.template_id) {
    const cfg = await import('../infra/stores/config').then((m) => m.useConfigStore())
    if (!cfg.soul) return
    const soulDir = cfg.soul.avatar.model_dir
    const opt = cfg.models.find((m) => m.dir === soulDir)
    if (!opt) return
    const modelDirAbs = opt.absolute_path.replace(/\/[^/]+\.model3\.json$/i, '')
    const r = await window.api.library.apply({
      template_id: action.template_id,
      model_dir: modelDirAbs,
    })
    if (r.ok && r.draft) {
      bus.emit('avatar:play-draft', { draft: r.draft })
    }
  }
  // entry_id 模式: v0.8.1 加（需要从 motion-engine 读 motion3 → 转 draft）
}

async function doChangeEmotion(
  action: Extract<BehaviorAction, { type: 'change_emotion' }>,
): Promise<void> {
  bus.emit('brain:emotion-changed', { emotion: action.emotion, intensity: action.intensity })
}
