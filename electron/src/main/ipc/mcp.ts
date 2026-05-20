/**
 * v0.17 P — MCP IPC handlers.
 *
 * 让 renderer (设置面板 / 工具菜单) 能：
 *   - 列已注册的外部 MCP server
 *   - 注册 + 启动一个新 server (command + args)
 *   - 调用 server 暴露的 tool
 *
 * 配合 main/services/mcp-client.ts。
 */
import { ipcMain, type BrowserWindow } from 'electron'
import {
  callTool,
  listServers,
  listTools,
  registerServer,
  unregisterServer,
  type McpServerSpec,
} from '../services/mcp-client'

export function registerMcpIpc(getWindow: () => BrowserWindow | null): void {
  /** 通知 renderer tools registry 内容变了 — 避免 dialog send 热路径 IPC pre-flight。 */
  const notifyToolsChanged = (): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('tools:changed')
  }

  ipcMain.handle('mcp:list-servers', () => listServers())

  ipcMain.handle('mcp:register', async (_evt, payload: McpServerSpec) => {
    const r = await registerServer(payload)
    if (r.ok) {
      notifyToolsChanged()
      return { ok: true, toolCount: r.toolCount }
    }
    return { ok: false, reason: r.reason }
  })

  ipcMain.handle('mcp:unregister', (_evt, id: string) => {
    const r = unregisterServer(id)
    if (r.ok) notifyToolsChanged()
    return r
  })

  ipcMain.handle('mcp:list-tools', (_evt, serverId: string) => listTools(serverId))

  ipcMain.handle('mcp:call-tool', async (_evt, payload: {
    serverId: string
    toolName: string
    args: Record<string, unknown>
  }) => {
    return callTool(payload.serverId, payload.toolName, payload.args)
  })
}
