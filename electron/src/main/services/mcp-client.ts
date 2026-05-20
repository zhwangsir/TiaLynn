/**
 * v0.17 P — MCP (Model Context Protocol) 外部 stdio server 客户端。
 *
 * MCP 是 Anthropic 提出的标准 JSON-RPC over stdio 协议，让外部进程把"工具"
 * 暴露给 host (Claude Code / TiaLynn 等)。我们手写最小客户端，不引入 SDK
 * 依赖膨胀风险。
 *
 * 支持：
 *   - initialize / tools/list / tools/call
 *   - 持久 stdio 进程 + JSON-RPC id 路由
 *   - 进程崩溃自动标记 error 状态
 *
 * 不支持（暂）：
 *   - prompts / resources / sampling / notifications
 *   - SSE / HTTP transport（只 stdio）
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface McpServerSpec {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpToolDef {
  name: string
  description: string
  inputSchema?: unknown
}

export interface McpServerState {
  id: string
  name: string
  command: string
  status: 'running' | 'stopped' | 'error'
  toolCount: number
}

interface RpcPending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface McpServer {
  spec: McpServerSpec
  child: ChildProcessWithoutNullStreams | null
  tools: McpToolDef[]
  status: 'running' | 'stopped' | 'error'
  pending: Map<number, RpcPending>
  nextId: number
  stdoutBuffer: string
}

const servers = new Map<string, McpServer>()
const RPC_TIMEOUT_MS = 15_000

function sendRpc<T = unknown>(srv: McpServer, method: string, params?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!srv.child || srv.status !== 'running') {
      reject(new Error(`server ${srv.spec.id} not running`))
      return
    }
    const id = srv.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
    const timeout = setTimeout(() => {
      srv.pending.delete(id)
      reject(new Error(`RPC ${method} timeout after ${RPC_TIMEOUT_MS}ms`))
    }, RPC_TIMEOUT_MS)
    srv.pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timeout,
    })
    srv.child.stdin.write(payload + '\n')
  })
}

function attachStdoutHandler(srv: McpServer): void {
  if (!srv.child) return
  srv.child.stdout.setEncoding('utf-8')
  srv.child.stdout.on('data', (chunk: string) => {
    srv.stdoutBuffer += chunk
    // MCP stdio 用行分隔 JSON
    const lines = srv.stdoutBuffer.split('\n')
    srv.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: { message: string } }
        if (typeof msg.id === 'number') {
          const pending = srv.pending.get(msg.id)
          if (!pending) continue
          clearTimeout(pending.timeout)
          srv.pending.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error.message))
          else pending.resolve(msg.result ?? null)
        }
        // notifications (无 id) 暂忽略
      } catch (e) {
        console.warn(`[mcp:${srv.spec.id}] bad JSON-RPC line:`, trimmed.slice(0, 200), e)
      }
    }
  })
  srv.child.stderr.setEncoding('utf-8')
  srv.child.stderr.on('data', (chunk: string) => {
    // stderr 是 server 自己的日志 — 输出但不当错误（很多 MCP server 把 info log 写 stderr）
    console.log(`[mcp:${srv.spec.id}:stderr] ${chunk.trimEnd()}`)
  })
  srv.child.on('exit', (code) => {
    console.log(`[mcp:${srv.spec.id}] exited code=${code}`)
    srv.status = code === 0 ? 'stopped' : 'error'
    for (const pending of srv.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`server exited code=${code}`))
    }
    srv.pending.clear()
  })
  srv.child.on('error', (err) => {
    console.warn(`[mcp:${srv.spec.id}] child error:`, err.message)
    srv.status = 'error'
  })
}

/** 注册并启动一个 MCP server — 返回 tool 数量 */
export async function registerServer(spec: McpServerSpec): Promise<{ ok: true; toolCount: number } | { ok: false; reason: string }> {
  if (servers.has(spec.id)) {
    return { ok: false, reason: `server id "${spec.id}" already registered (unregister first)` }
  }
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(spec.command, spec.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(spec.env ?? {}) },
    })
  } catch (e) {
    return { ok: false, reason: `spawn failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const srv: McpServer = {
    spec,
    child,
    tools: [],
    status: 'running',
    pending: new Map(),
    nextId: 1,
    stdoutBuffer: '',
  }
  servers.set(spec.id, srv)
  attachStdoutHandler(srv)

  try {
    // 1. initialize
    await sendRpc(srv, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tialynn', version: '0.17.0' },
    })
    // initialized notification (无 id, 单向)
    if (child.stdin.writable) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    }
    // 2. tools/list
    const toolsResult = await sendRpc<{ tools?: McpToolDef[] }>(srv, 'tools/list')
    srv.tools = toolsResult?.tools ?? []
    return { ok: true, toolCount: srv.tools.length }
  } catch (e) {
    srv.status = 'error'
    try { child.kill() } catch { /* skip */ }
    servers.delete(spec.id)
    return { ok: false, reason: `handshake failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function unregisterServer(id: string): { ok: boolean } {
  const srv = servers.get(id)
  if (!srv) return { ok: false }
  try { srv.child?.kill() } catch { /* skip */ }
  servers.delete(id)
  return { ok: true }
}

export function listServers(): McpServerState[] {
  return [...servers.values()].map((srv) => ({
    id: srv.spec.id,
    name: srv.spec.name,
    command: srv.spec.command,
    status: srv.status,
    toolCount: srv.tools.length,
  }))
}

export function listTools(serverId: string): McpToolDef[] {
  return servers.get(serverId)?.tools ?? []
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> {
  const srv = servers.get(serverId)
  if (!srv) return { ok: false, reason: `server "${serverId}" not registered` }
  if (srv.status !== 'running') return { ok: false, reason: `server status=${srv.status}` }
  try {
    const result = await sendRpc(srv, 'tools/call', { name: toolName, arguments: args })
    return { ok: true, result }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** App 退出时全部关停 */
export function shutdownAll(): void {
  for (const id of [...servers.keys()]) unregisterServer(id)
}
