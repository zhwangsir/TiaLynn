/**
 * 立绘主窗口。
 *
 * 关键技巧：
 *   1. `type: 'panel'` —— macOS NSPanel 模式，跨 space + 不抢焦点
 *   2. `transparentWindowConfig()` —— 透明 + 无框 + 无阴影
 *   3. `setVisibleOnAllWorkspaces` —— 所有桌面都显示
 *   4. `setAlwaysOnTop` —— 浮在最前
 */
import { BrowserWindow, shell, session } from 'electron'
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
      // H1 (audit): webSecurity 现在保持默认 true — 所有跨目录资源走 tialynn-asset://
      // protocol handler (registerAssetProtocol)，handler 内部做路径白名单校验
      backgroundThrottling: false,
    },
    ...transparentWindowConfig(),
  })

  // macOS：跨 space 全空间可见 + 在 fullscreen 上也可见
  //   skipTransformProcessType: true — 关键。setVisibleOnAllWorkspaces 默认会把 process
  //   从 accessory 转回 regular（导致 Dock 图标重新出现 + Cmd+Tab 重新出现）。
  //   传 true 阻止这次副作用，配合 app.setActivationPolicy('accessory') 保持真桌宠态。
  if (platform.isMacOS) {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
  }

  // 浮在最前（screen-saver 是 Electron 中 alwaysOnTop 最高级别 — 盖菜单栏/Dock/全屏视频）
  // v0.17：默认就是 true，不再让 state.alwaysOnTop=false 也尊重 — 桌宠不浮就不叫桌宠了
  win.setAlwaysOnTop(true, 'screen-saver', 1)

  // v0.17 macOS：NSPanel 用 webContents 调一次 inspect 把 hidesOnDeactivate 关掉
  //   Electron BrowserWindow 没有直接 API，但 type:'panel' 默认就是 hidesOnDeactivate=NO
  //   留作记录 — 验证过 NSPanel 子类默认行为符合需求
  void state.alwaysOnTop

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

  // v0.13 Security defense-in-depth (audit Security CRITICAL C1 mitigation):
  // 即使 webSecurity:false 让 SOP 失效，下面 3 道防线阻止 XSS 实质危害。

  // 1. 阻止 window.open — renderer 永远不应该开新窗口。任何 window.open 用系统默认浏览器打开。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 2. 阻止 renderer 跳到非本地 URL（renderer 始终在 file:// 或 vite localhost 或 tialynn-asset://）
  win.webContents.on('will-navigate', (event, url) => {
    const isLocal =
      url.startsWith('file://') ||
      url.startsWith('tialynn-asset://') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('http://127.0.0.1:')
    if (!isLocal) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  // 3. 注入 CSP header — H1 修紧后：
  //    - 删 script-src 'unsafe-inline' （index.html 无 inline script，仅 src 引用）
  //    - 保留 'unsafe-eval' （PIXI 内部用 eval，删了直接挂）
  //    - 保留 style-src 'unsafe-inline' （index.html 有 <style> 块 + Vue scoped style）
  //    - 所有 src 加 tialynn-asset: 让自定义协议资源能加载
  //    - 仍然允许 file: 因为 vite/electron 主页面用 file:// 加载
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self' file: tialynn-asset: blob: data:",
            "script-src 'self' file: 'unsafe-eval' blob:",
            "style-src 'self' file: 'unsafe-inline'",
            "img-src 'self' file: tialynn-asset: data: blob: https:",
            "media-src 'self' file: tialynn-asset: blob: data:",
            "font-src 'self' file: data:",
            "connect-src 'self' file: tialynn-asset: data: blob: https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        ],
      },
    })
  })

  win.once('ready-to-show', () => {
    win.show()
    // v0.17：默认不打开 devtools — detach 窗口会让 macOS 把 process 转回 regular，
    // Dock 图标会重新出现破坏桌宠原生态。要看 devtools 显式设 TIALYNN_DEBUG=1。
    if (process.env.TIALYNN_DEBUG === '1' || process.env.MAIN_APP_DEBUG === '1') {
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
