/**
 * 立绘主窗口。
 *
 * 关键技巧：
 *   1. `type: 'panel'` —— macOS NSPanel 模式，跨 space + 不抢焦点
 *   2. `transparentWindowConfig()` —— 透明 + 无框 + 无阴影
 *   3. `setVisibleOnAllWorkspaces` —— 所有桌面都显示
 *   4. `setAlwaysOnTop` —— 浮在最前
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { platform, transparentWindowConfig } from './shared'
import { loadWindowState, saveNow, scheduleSave } from '../services/window-state-store'

export interface MainWindowOpts {
  preloadPath: string
  rendererUrl?: string // dev server URL
  rendererFile?: string // built index.html path
}

export function createMainWindow(opts: MainWindowOpts): BrowserWindow {
  const state = loadWindowState()

  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 240,
    minHeight: 360,
    // macOS NSPanel 模式：不抢焦点 + 跨 space
    ...(platform.isMacOS && { type: 'panel' as const }),
    alwaysOnTop: state.alwaysOnTop,
    resizable: true, // v0.6.3：允许调整立绘窗口大小
    show: false,
    // 关键：让 NSPanel 在非 active 状态下也立即响应第一次 mouse click（不只激活窗口）。
    // 默认 false 时桌宠点了"一下"只是激活窗口，第二下才触发 button。
    acceptFirstMouse: true,
    webPreferences: {
      preload: opts.preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
    ...transparentWindowConfig(),
  })

  // macOS：跨 space 全空间可见 + 在 fullscreen 上也可见
  if (platform.isMacOS) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // 浮在最前（screen-saver 是 Electron 中 alwaysOnTop 最高级别）
  if (state.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')

  // 拖/缩放后节流持久化；关闭前同步存
  const persist = (): void => {
    if (win.isDestroyed()) return
    scheduleSave({ bounds: win.getBounds(), alwaysOnTop: win.isAlwaysOnTop() })
  }
  win.on('move', persist)
  win.on('resize', persist)
  win.on('always-on-top-changed', persist)
  win.on('close', () => {
    if (win.isDestroyed()) return
    saveNow({ bounds: win.getBounds(), alwaysOnTop: win.isAlwaysOnTop() })
  })

  // v0.8.2: 默认 ignore=false，确保启动后 UI 按钮（设置/关闭/缩放）立刻可点。
  // cursor poll (50ms tick) 启动后会自动接管：鼠标在透明区 → 切 true 实现穿透；
  // 在 UI 或立绘 alpha 命中 → 切回 false。
  // 旧方案默认 true，启动头 500ms cursor poll 还没启时所有按钮都点不到，所以反过来。
  win.setIgnoreMouseEvents(false)

  win.once('ready-to-show', () => {
    win.show()
    // dev 模式自动开 devtools（airi 同款）
    if (process.env.NODE_ENV !== 'production' || process.env.MAIN_APP_DEBUG) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // 仅在 TIALYNN_DEBUG=1 时把 renderer console 转发到主进程 stdout
  // 平时关掉（生产噪声 + dev 时 devtools 已经能看）
  if (process.env.TIALYNN_DEBUG === '1') {
    win.webContents.on('console-message', (_event, level, message, line, source) => {
      const tag = ['LOG', 'WARN', 'ERROR', 'INFO'][level] ?? `L${level}`
      if (typeof source === 'string' && source.startsWith('devtools://')) return
      // eslint-disable-next-line no-console
      console.log(`[renderer:${tag}] ${message}${line ? ` (${source}:${line})` : ''}`)
    })
  }

  if (opts.rendererUrl) {
    win.loadURL(opts.rendererUrl)
  } else if (opts.rendererFile) {
    win.loadFile(opts.rendererFile)
  } else {
    // electron-vite 会在 dev 模式注入 ELECTRON_RENDERER_URL
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      win.loadURL(devUrl)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  return win
}
