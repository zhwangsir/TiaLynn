/**
 * 工具调用共享类型 —— main / preload / renderer 都用。
 *
 * 设计与 Anthropic tool_use 协议对齐（也兼容 OpenAI function calling）。
 */

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema (subset)：properties + required */
  input_schema: {
    type: 'object'
    properties: Record<
      string,
      { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description?: string; enum?: string[] }
    >
    required?: string[]
  }
  /** 风险等级：low(read-only) / medium(本地无害) / high(可能修改/外发) */
  risk: 'low' | 'medium' | 'high'
  category: 'fs' | 'shell' | 'system' | 'other'
}

export interface ToolInvocation {
  /** Anthropic tool_use.id，对应回 tool_result */
  invocation_id: string
  tool_name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  invocation_id: string
  ok: boolean
  output?: string
  error?: string
  /** 截断标志：output 实际超过传送上限时设 true */
  truncated?: boolean
}

export interface ApprovalRequest {
  invocation_id: string
  tool_name: string
  description: string
  risk: ToolDefinition['risk']
  input: Record<string, unknown>
  /** 风险摘要（人类可读，单行） */
  summary: string
}

export type ApprovalDecision = 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always'

export interface ToolPolicy {
  /** key = tool_name, value = always_allow / always_deny / null（每次问） */
  [toolName: string]: 'always_allow' | 'always_deny' | undefined
}
