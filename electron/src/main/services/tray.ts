/**
 * macOS / Windows 系统状态栏（Tray）— v0.17 P3
 *
 * 在 macOS 顶部菜单栏（或 Windows 系统托盘）显示 🎀 图标。
 * 点击展开 native menu，菜单项跟右键菜单同步（所有功能入口）。
 *
 * 动作：tray 菜单点击 → webContents.send('tray:action', id) → renderer 执行对应分支。
 * Renderer 的 ContextMenu onMenuSelect 已经覆盖所有 id，复用即可。
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

let tray: Tray | null = null

interface TrayActionItem {
  id: string
  label: string
  separator?: boolean
}

const TRAY_MENU: TrayActionItem[] = [
  { id: 'show', label: '显示 TiaLynn 窗口' },
  { id: 'sep0', label: '', separator: true },
  { id: 'chat', label: '💬 打开对话' },
  { id: 'pick-character', label: '🎭 切换角色' },
  { id: 'soul-editor', label: '✏️ 编辑灵魂' },
  { id: 'sep1', label: '', separator: true },
  { id: 'library', label: '🎁 资源商店' },
  { id: 'creator-studio', label: '🎨 创作工坊' },
  { id: 'health-dashboard', label: '🔬 模型健康仪表盘' },
  { id: 'reload', label: '🔄 重载模型 / 灵魂' },
  { id: 'sep2', label: '', separator: true },
  { id: 'zoom-in', label: '🔍 放大立绘' },
  { id: 'zoom-out', label: '🔎 缩小立绘' },
  { id: 'zoom-reset', label: '↻ 复原立绘大小' },
  { id: 'sep3a', label: '', separator: true },
  { id: 'ui-zoom-in', label: '🔍+ 放大 UI 面板（⌘=）' },
  { id: 'ui-zoom-out', label: '🔎− 缩小 UI 面板（⌘-）' },
  { id: 'ui-zoom-reset', label: '↻ 复原 UI 大小（⌘0）' },
  { id: 'sep3', label: '', separator: true },
  { id: 'settings', label: '⚙️ 设置' },
  { id: 'sep4', label: '', separator: true },
  { id: 'pin', label: '📍 置顶切换' },
  { id: 'minimize', label: '— 收起窗口' },
  { id: 'sep5', label: '', separator: true },
  { id: 'quit', label: '退出 TiaLynn' },
]

function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const items: MenuItemConstructorOptions[] = TRAY_MENU.map((it) => {
    if (it.separator) return { type: 'separator' as const }
    return {
      label: it.label,
      click: (): void => {
        const win = getWindow()
        if (it.id === 'show') {
          if (win) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
          }
          return
        }
        if (it.id === 'quit') {
          app.quit()
          return
        }
        // 其他动作转发给 renderer
        if (win && !win.isDestroyed()) {
          win.webContents.send('tray:action', it.id)
          // 顺便保证窗口可见
          if (!win.isVisible()) win.show()
        }
      },
    }
  })
  return Menu.buildFromTemplate(items)
}

export function startTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return
  try {
    // macOS: 用空图 + setTitle(emoji)，避免找 icon 文件
    tray = new Tray(nativeImage.createEmpty())
    if (process.platform === 'darwin') {
      tray.setTitle('🎀')
    }
    tray.setToolTip('TiaLynn — 灵魂女友')
    tray.setContextMenu(buildMenu(getWindow))
    // 左键点击 macOS 通常打开菜单 / Windows 唤起窗口
    tray.on('click', () => {
      const win = getWindow()
      if (!win) return
      if (process.platform !== 'darwin') {
        if (win.isVisible()) win.hide()
        else { win.show(); win.focus() }
      }
    })
    console.log('[tray] started')
  } catch (e) {
    console.warn('[tray] failed to start:', e)
  }
}

export function stopTray(): void {
  if (tray) {
    try { tray.destroy() } catch { /* skip */ }
    tray = null
  }
}
