/**
 * Tool IPC + 审批协议（主进程视角）。
 *
 * 工作流：
 *   1. LLM 在 stream 中产生 tool_use → renderer 调 'tools:run' 把 ToolInvocation 发给主进程
 *   2. 主进程查 policy:
 *      - always_allow → 直接执行
 *      - always_deny → 直接返回 denied result
 *      - undefined → webContents.send('tools:approval-request', req)，等 renderer 回 'tools:approval-decision'
 *   3. 用户 allow/deny → 主进程根据决策执行/拒绝
 *   4. 结果通过 invoke promise 返回给 renderer
 */
import { ipcMain, type BrowserWindow } from 'electron'
import {
  buildSummary,
  invoke as invokeTool,
  list as listTools,
} from '../services/tools/registry'
import * as policy from '../services/tools/policy-store'
import { registerBuiltins } from '../services/tools/builtin'
import type { ApprovalDecision, ApprovalRequest, ToolInvocation, ToolResult } from '@shared/tools'

const pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()

export function registerToolIpc(getWindow: () => BrowserWindow | null): void {
  registerBuiltins()

  ipcMain.handle('tools:list', () => listTools())

  ipcMain.handle('tools:policy-get', () => policy.load())
  ipcMain.handle(
    'tools:policy-set',
    (_evt, payload: { tool_name: string; decision: 'always_allow' | 'always_deny' | null }) => {
      policy.setPolicy(payload.tool_name, payload.decision)
      return policy.load()
    },
  )
  ipcMain.handle('tools:policy-clear', () => {
    policy.clearAll()
    return policy.load()
  })

  ipcMain.handle('tools:run', async (_evt, call: ToolInvocation): Promise<ToolResult> => {
    const p = policy.get(call.tool_name)
    if (p === 'always_deny') {
      return {
        invocation_id: call.invocation_id,
        ok: false,
        error: '用户先前设置永远拒绝此工具',
      }
    }
    let decision: ApprovalDecision = 'allow_once'
    if (p === 'always_allow') {
      decision = 'allow_once'
    } else {
      // 走审批
      decision = await requestApproval(getWindow, call)
      if (decision === 'allow_always') policy.setPolicy(call.tool_name, 'always_allow')
      if (decision === 'deny_always') policy.setPolicy(call.tool_name, 'always_deny')
    }
    if (decision === 'deny_once' || decision === 'deny_always') {
      return {
        invocation_id: call.invocation_id,
        ok: false,
        error: '用户拒绝此次调用',
      }
    }
    return invokeTool(call)
  })

  /** renderer 回应审批 */
  ipcMain.on(
    'tools:approval-decision',
    (_evt, payload: { invocation_id: string; decision: ApprovalDecision }) => {
      const resolver = pendingApprovals.get(payload.invocation_id)
      if (resolver) {
        pendingApprovals.delete(payload.invocation_id)
        resolver(payload.decision)
      }
    },
  )
}

function requestApproval(
  getWindow: () => BrowserWindow | null,
  call: ToolInvocation,
): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return resolve('deny_once')
    const tool = listTools().find((t) => t.name === call.tool_name)
    const req: ApprovalRequest = {
      invocation_id: call.invocation_id,
      tool_name: call.tool_name,
      description: tool?.description ?? '(unknown tool)',
      risk: tool?.risk ?? 'high',
      input: call.input,
      summary: buildSummary(call),
    }
    pendingApprovals.set(call.invocation_id, resolve)
    win.webContents.send('tools:approval-request', req)

    // 60s 超时自动拒绝（避免悬挂）
    setTimeout(() => {
      if (pendingApprovals.has(call.invocation_id)) {
        pendingApprovals.delete(call.invocation_id)
        resolve('deny_once')
      }
    }, 60_000)
  })
}
