/**
 * 窗口控制 IPC handler。
 *
 * 关键：
 *   - `start-drag`: 调用 electron-click-drag-plugin 触发 native 拖动
 *     （Tauri 的 start_dragging 跨 IPC 拖动时 NSEvent 过期，这是它的硬伤）
 *   - `set-ignore-mouse`: 在透明区 / 立绘区切换穿透状态
 *     带 `forward: true` 让 webview 仍能收到 mousemove（关键魔法）
 */
import { BrowserWindow, ipcMain } from 'electron'
import { platform } from '../windows/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clickDragPlugin: any = null

async function loadClickDragPlugin(): Promise<unknown> {
  if (clickDragPlugin) return clickDragPlugin
  try {
    // 仅 macOS / Windows 可用；Linux 上 fallback 到原生 window.startDrag
    if (!platform.isMacOS && !platform.isWindows) return null
    const mod = await import('electron-click-drag-plugin')
    clickDragPlugin = (mod as { default?: unknown }).default ?? mod
    return clickDragPlugin
  } catch (e) {
    console.warn('[window-control] electron-click-drag-plugin not available:', e)
    return null
  }
}

export function registerWindowControlIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('window:start-drag', async () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' }
    const plugin = await loadClickDragPlugin()
    if (!plugin) {
      // fallback: Electron 内置的 startDrag 仅支持文件拖拽，没有窗口拖拽 native API
      // 这种情况下渲染层会 fallback 到 mousemove + setPosition 软件模拟
      return { ok: false, reason: 'plugin-missing' }
    }
    try {
      const handle = win.getNativeWindowHandle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(plugin as any).startDrag(handle)
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  })

  // 软件 fallback：渲染层每 16ms 发送一次屏幕坐标，主进程 setPosition
  ipcMain.on('window:soft-drag', (_evt, payload: { x: number; y: number }) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return
    win.setPosition(Math.round(payload.x), Math.round(payload.y))
  })

  /**
   * 切换鼠标穿透。
   * @param ignore true = 鼠标穿透（透明区点击穿过到下层桌面）
   *               false = 鼠标响应（点立绘 / 设置按钮）
   * @param forward 必须 true：穿透状态下仍把 mousemove 转发到 webview，
   *                让前端 alpha 检测能知道何时切回非穿透。
   */
  ipcMain.handle(
    'window:set-ignore-mouse',
    (_evt, payload: { ignore: boolean; forward?: boolean }) => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return { ok: false }
      try {
        const ignore = !!payload.ignore
        const forward = payload.forward !== false
        win.setIgnoreMouseEvents(ignore, ignore ? { forward } : undefined)
        return { ok: true, ignore, forward }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    },
  )

  ipcMain.handle('window:get-bounds', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return null
    return win.getBounds()
  })

  ipcMain.handle('window:set-bounds', (_evt, bounds: Partial<Electron.Rectangle>) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return { ok: false }
    try {
      win.setBounds({ ...win.getBounds(), ...bounds })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  })

  ipcMain.handle('window:close', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.close()
  })

  ipcMain.handle('window:minimize', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.minimize()
  })

  ipcMain.handle('window:toggle-pin', (_evt, pin: boolean) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(!!pin, 'screen-saver')
  })
}
