/**
 * Agent 自动化 IPC handlers — TiaLynn 操控鼠标 / 键盘 / 截屏
 * 注：renderer 可直接调；planner LLM 通过 control_input action 间接触发。
 */
import { ipcMain } from 'electron'
import * as auto from '../services/automation'
import { findOnScreen, findAndClick } from '../services/automation/vision-grounding'
import { runAgentTask, type AgentStep } from '../services/automation/agent-loop'
import type { BrowserWindow } from 'electron'

export function registerAutomationIpc(getWindow?: () => BrowserWindow | null): void {
  ipcMain.handle('agent:halt', (_e, on: boolean) => {
    auto.setHalted(on)
    return { halted: auto.isHalted() }
  })
  ipcMain.handle('agent:is-halted', () => ({ halted: auto.isHalted() }))

  ipcMain.handle('agent:cursor-pos', async () => auto.getCursorPosition())
  ipcMain.handle('agent:screen-size', async () => auto.screenSize())

  ipcMain.handle('agent:move', async (_e, p: { x: number; y: number; duration_ms?: number }) => {
    try { await auto.move(p.x, p.y, p.duration_ms); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:click', async (_e, p: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) => {
    try { await auto.click(p.x, p.y, p.button); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:double-click', async (_e, p: { x: number; y: number }) => {
    try { await auto.doubleClick(p.x, p.y); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:scroll', async (_e, p: { dy: number; dx?: number }) => {
    try { await auto.scroll(p.dy, p.dx); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:drag', async (_e, p: { from_x: number; from_y: number; to_x: number; to_y: number }) => {
    try { await auto.drag(p.from_x, p.from_y, p.to_x, p.to_y); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:type', async (_e, p: { text: string }) => {
    try { await auto.type(p.text); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:key', async (_e, p: { combo: string[] }) => {
    try { await auto.key(p.combo); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:click-and-type', async (_e, p: { x: number; y: number; text: string }) => {
    try { await auto.clickAndType(p.x, p.y, p.text); return { ok: true } }
    catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle('agent:screenshot', async (_e, region?: { x: number; y: number; w: number; h: number }) => {
    try {
      const r = await auto.screenshot(region)
      return { ok: true, base64: r.base64, width: r.width, height: r.height }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // === Vision Grounding：看图找位置 ===
  ipcMain.handle('agent:find', async (_e, p: { description: string }) => findOnScreen(p.description))
  ipcMain.handle('agent:find-and-click', async (_e, p: { description: string }) =>
    findAndClick(p.description),
  )

  // === Agent Loop：目标驱动的循环 ===
  ipcMain.handle('agent:run-task', async (_e, p: { goal: string; max_steps?: number }) => {
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
