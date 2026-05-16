/**
 * 立绘主窗口。
 *
 * 关键技巧：
 *   1. `type: 'panel'` —— macOS NSPanel 模式，跨 space + 不抢焦点
 *   2. `transparentWindowConfig()` —— 透明 + 无框 + 无阴影
 *   3. `setVisibleOnAllWorkspaces` —— 所有桌面都显示
 *   4. `setAlwaysOnTop` —— 浮在最前
 */
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { platform, transparentWindowConfig } from './shared'

const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 720

export interface MainWindowOpts {
  preloadPath: string
  rendererUrl?: string // dev server URL
  rendererFile?: string // built index.html path
}

export function createMainWindow(opts: MainWindowOpts): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = display.workAreaSize
  const x = sw - DEFAULT_WIDTH - 40
  const y = sh - DEFAULT_HEIGHT - 20

  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x,
    y,
    minWidth: 240,
    minHeight: 360,
    // macOS NSPanel 模式：不抢焦点 + 跨 space
    type: platform.isMacOS ? 'panel' : undefined,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: opts.preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // 允许 file:// 读取 Live2D 资源（更严格的 CSP 之后再加）
      backgroundThrottling: false,
    },
    ...transparentWindowConfig(),
  })

  // macOS：跨 space 全空间可见 + 在 fullscreen 上也可见
  if (platform.isMacOS) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // 浮在最前（screen-saver 是 Electron 中 alwaysOnTop 最高级别）
  win.setAlwaysOnTop(true, 'screen-saver')

  // 默认就是穿透状态（透明区不响应鼠标），但保留 forward 让 webview 仍能收到
  // mousemove 以便切回非穿透模式。这正是 Tauri 缺的关键能力。
  win.setIgnoreMouseEvents(true, { forward: true })

  win.once('ready-to-show', () => {
    win.show()
    // dev 模式自动开 devtools（airi 同款）
    if (process.env.NODE_ENV !== 'production' || process.env.MAIN_APP_DEBUG) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // 把 renderer 的 console 中继到主进程 stdout，方便从 dev 终端看 Live2D / IPC 状态
  if (process.env.NODE_ENV !== 'production') {
    win.webContents.on('console-message', (_event, level, message, line, source) => {
      const tag = ['LOG', 'WARN', 'ERROR', 'INFO'][level] ?? `L${level}`
      // 静默 devtools 自己产生的噪声
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
