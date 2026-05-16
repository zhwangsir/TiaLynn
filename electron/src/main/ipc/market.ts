/**
 * 模型市场 IPC handlers.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { installFromPath, installFromUrl, installFromZip } from '../services/model-market'
import type { InstallResult } from '../services/model-market'

export function registerMarketIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('market:install-zip', async (_evt, zipPath: string): Promise<InstallResult> => {
    return installFromZip(zipPath)
  })

  ipcMain.handle('market:install-url', async (_evt, url: string): Promise<InstallResult> => {
    return installFromUrl(url)
  })

  ipcMain.handle('market:install-path', async (_evt, path: string): Promise<InstallResult> => {
    return installFromPath(path)
  })

  // 用于拖拽：renderer 拿到 file path 后送过来
  ipcMain.handle('market:install-paths', async (_evt, paths: string[]): Promise<InstallResult[]> => {
    const results: InstallResult[] = []
    for (const p of paths) {
      results.push(await installFromPath(p))
    }
    // 安装成功后让 renderer 知道
    const win = getWindow()
    if (win && !win.isDestroyed() && results.some((r) => r.ok)) {
      win.webContents.send('market:installed', results.filter((r) => r.ok))
    }
    return results
  })
}
