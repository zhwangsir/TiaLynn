/**
 * TiaLynn v0.6 — Electron 主入口。
 *
 * 五大域之 infra：起一个透明立绘窗口，挂上所有 IPC handler。
 * avatar/brain/hands/presence 由 renderer 实现，主进程只做：
 *   - 透明窗口 + NSPanel + 拖动 + 穿透
 *   - LLM provider 转发（避免 renderer 直接持密钥）
 *   - 文件系统访问（soul / models / config / TTS sidecar）
 */
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { createMainWindow } from './windows/main-window'
import { registerWindowControlIpc } from './ipc/window-control'
import { registerLlmIpc } from './ipc/llm'
import { registerSystemIpc } from './ipc/system'
import { getPaths } from './services/paths'

// macOS 透明窗口需要硬件加速正确工作
app.commandLine.appendSwitch('enable-features', 'Metal')
// 防止 mojibake
app.commandLine.appendSwitch('lang', 'zh-CN')
// dev 模式抑制 Electron 安全警告噪声（生产构建时自动不显示）
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('moe.tialynn')

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 提前确保数据目录存在
  getPaths()

  // 注册所有 IPC
  registerWindowControlIpc(getMainWindow)
  registerLlmIpc(getMainWindow)
  registerSystemIpc(getMainWindow)

  const preloadPath = join(__dirname, '../preload/index.mjs')
  mainWindow = createMainWindow({ preloadPath })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow({ preloadPath })
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  // 桌宠语义：所有窗口关闭仍保留 dock；macOS 习惯
  if (process.platform !== 'darwin') app.quit()
})
