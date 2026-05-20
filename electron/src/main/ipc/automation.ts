/**
 * Agent 自动化 IPC handlers — TiaLynn 操控鼠标 / 键盘 / 截屏
 *
 * 审计 C2：
 * - agent:run-task 整个 task 一次性审批（goal 显示给用户确认）
 * - 其他 agent:* 原语（click/type/key 等）只允许主窗口 sender 调（webview/子窗口拒绝）
 * - 原语本意是 agent-loop 内部 service 调用，renderer 直调路径用 sender 校验防 XSS 利用
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import * as auto from '../services/automation'
import { findOnScreen, findAndClick } from '../services/automation/vision-grounding'
import { runAgentTask, type AgentStep } from '../services/automation/agent-loop'
import type { BrowserWindow } from 'electron'
import { requestAgentTaskApproval } from './tools'

export function registerAutomationIpc(getWindow?: () => BrowserWindow | null): void {
  /** C2: 只允许主窗口 sender — webview/iframe/子窗口拒绝。XSS 即使在主窗口也只能在此 webContents */
  const checkSender = (evt: IpcMainInvokeEvent): boolean => {
    const win = getWindow?.()
    if (!win || win.isDestroyed()) return false
    return evt.sender.id === win.webContents.id
  }
  const REJECT_SENDER = { ok: false as const, error: 'untrusted sender (sender check failed)' }

  ipcMain.handle('agent:halt', (evt, on: boolean) => {
    if (!checkSender(evt)) return REJECT_SENDER
    auto.setHalted(on)
    return { halted: auto.isHalted() }
  })
  ipcMain.handle('agent:is-halted', (evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return { halted: auto.isHalted() }
  })

  // 只读 IPC（cursor-pos / screen-size）也加 sender check 防 fingerprint
  ipcMain.handle('agent:cursor-pos', async (evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return auto.getCursorPosition()
  })
  ipcMain.handle('agent:screen-size', async (evt) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return auto.screenSize()
  })

  ipcMain.handle('agent:move', async (evt, p: { x: number; y: number; duration_ms?: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.move(p.x, p.y, p.duration_ms); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:click', async (evt, p: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.click(p.x, p.y, p.button); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:double-click', async (evt, p: { x: number; y: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.doubleClick(p.x, p.y); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:scroll', async (evt, p: { dy: number; dx?: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.scroll(p.dy, p.dx); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:drag', async (evt, p: { from_x: number; from_y: number; to_x: number; to_y: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.drag(p.from_x, p.from_y, p.to_x, p.to_y); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:type', async (evt, p: { text: string }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.type(p.text); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:key', async (evt, p: { combo: string[] }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.key(p.combo); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:click-and-type', async (evt, p: { x: number; y: number; text: string }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try { await auto.clickAndType(p.x, p.y, p.text); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:screenshot', async (evt, region?: { x: number; y: number; w: number; h: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    try {
      const r = await auto.screenshot(region)
      return { ok: true, base64: r.base64, width: r.width, height: r.height }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // === Vision Grounding：看图找位置 ===
  ipcMain.handle('agent:find', async (evt, p: { description: string }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return findOnScreen(p.description)
  })
  ipcMain.handle('agent:find-and-click', async (evt, p: { description: string }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    return findAndClick(p.description)
  })

  // === Agent Loop：目标驱动的循环（goal 走用户审批） ===
  ipcMain.handle('agent:run-task', async (evt, p: { goal: string; max_steps?: number }) => {
    if (!checkSender(evt)) return REJECT_SENDER
    // C2: prompt injection → plan-executor agent_task action 可能携带恶意 goal，
    // 弹窗让用户看清 goal 后才开始 agent loop
    const approved = await requestAgentTaskApproval(getWindow ?? null, p.goal, p.max_steps ?? 10)
    if (!approved) {
      return { ok: false, goal: p.goal, steps: [], reason: '用户拒绝了 agent 任务' }
    }
    return runAgentTask(p.goal, {
      ...(p.max_steps != null ? { maxSteps: p.max_steps } : {}),
      onStep: (step: AgentStep) => {
        const win = getWindow?.()
        if (win && !win.isDestroyed()) {
          win.webContents.send('agent:step', step)
        }
      },
    })
  })
}
