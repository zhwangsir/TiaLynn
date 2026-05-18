/**
 * 在线资源商店 IPC handlers (v0.12)。
 * v0.13: 从 ipc/system.ts 剥离 (audit architecture HIGH god-file 拆分)。
 *
 * 浏览 HuggingFace + GitHub 真实 repo 的 RVC 音色 / Live2D 立绘资源，
 * 支持下载安装 + AbortController 中断。
 */
import { ipcMain } from 'electron'

export function registerOnlineIpc(): void {
  const onlineInstallControllers = new Map<string, AbortController>()

  ipcMain.handle('online:list-recommended', async () => {
    const { RECOMMENDED_REPOS } = await import('../services/online-store')
    return RECOMMENDED_REPOS
  })

  ipcMain.handle(
    'online:list-assets',
    async (_evt, payload: { repo_id: string; sub_path?: string }) => {
      const { listRepoAssets } = await import('../services/online-store')
      return listRepoAssets(payload.repo_id, payload.sub_path)
    },
  )

  ipcMain.handle(
    'online:check-installed',
    async (_evt, payload: { kind: 'rvc' | 'live2d'; voice_id?: string; repo_slug?: string; asset_name?: string }) => {
      const { checkRvcInstalled, checkLive2dInstalled } = await import('../services/online-store')
      if (payload.kind === 'rvc' && payload.voice_id) {
        return { installed: await checkRvcInstalled(payload.voice_id) }
      }
      if (payload.kind === 'live2d' && payload.repo_slug && payload.asset_name) {
        return { installed: checkLive2dInstalled(payload.repo_slug, payload.asset_name) }
      }
      return { installed: false }
    },
  )

  ipcMain.handle(
    'online:install',
    async (
      evt,
      payload: { repo_id: string; asset_path: string; kind: 'rvc' | 'live2d' },
    ) => {
      const installId = `${payload.repo_id}/${payload.asset_path}`
      const old = onlineInstallControllers.get(installId)
      if (old) old.abort()
      const ctrl = new AbortController()
      onlineInstallControllers.set(installId, ctrl)
      const { installAsset } = await import('../services/online-store')
      void installAsset(
        payload.repo_id,
        payload.asset_path,
        payload.kind,
        (p) => {
          try {
            evt.sender.send('online:install-progress', { install_id: installId, ...p })
          } catch {
            /* renderer gone */
          }
        },
        ctrl.signal,
      )
        .then((r) => {
          try {
            evt.sender.send('online:install-done', { install_id: installId, ...r })
          } catch { /* skip */ }
        })
        .finally(() => onlineInstallControllers.delete(installId))
      return { ok: true, install_id: installId }
    },
  )

  ipcMain.handle('online:cancel-install', async (_evt, installId: string) => {
    const ctrl = onlineInstallControllers.get(installId)
    if (ctrl) {
      ctrl.abort()
      onlineInstallControllers.delete(installId)
    }
    return { ok: true }
  })

  ipcMain.handle(
    'online:install-custom',
    async (evt, payload: { url: string; kind: 'rvc' | 'live2d' }) => {
      const installId = `custom/${payload.url}`
      const old = onlineInstallControllers.get(installId)
      if (old) old.abort()
      const ctrl = new AbortController()
      onlineInstallControllers.set(installId, ctrl)
      const { installCustomZip } = await import('../services/online-store')
      void installCustomZip(payload.url, payload.kind, (p) => {
        try {
          evt.sender.send('online:install-progress', { install_id: installId, ...p })
        } catch { /* skip */ }
      }, ctrl.signal)
        .then((r) => {
          try {
            evt.sender.send('online:install-done', { install_id: installId, ...r })
          } catch { /* skip */ }
        })
        .finally(() => onlineInstallControllers.delete(installId))
      return { ok: true, install_id: installId }
    },
  )
}
