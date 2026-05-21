/**
 * friendly-error 单测 (UX R22)。
 * 纯函数 — 不需要 mock。
 */
import { describe, expect, it } from 'vitest'
import { toFriendlyError } from './friendly-error'

describe('toFriendlyError', () => {
  it('ECONNREFUSED → 服务连不上 + 推荐 llm tab', () => {
    const r = toFriendlyError('fetch failed: connect ECONNREFUSED 127.0.0.1:11434')
    expect(r.title).toContain('服务连不上')
    expect(r.detail).toContain('Ollama')
    expect(r.goto).toBe('llm')
  })

  it('timeout → 响应太慢', () => {
    const r = toFriendlyError('The operation was aborted due to timeout')
    expect(r.title).toContain('超时')
    expect(r.goto).toBe('llm')
  })

  it('401 → API Key 错', () => {
    const r = toFriendlyError('Request failed with status 401 Unauthorized')
    expect(r.title).toContain('API Key')
    expect(r.goto).toBe('llm')
  })

  it('404 model not found → 模型不存在', () => {
    const r = toFriendlyError('Error 404: model_not_found qwen3-99b')
    expect(r.title).toContain('模型不存在')
  })

  it('普通 404 → endpoint 路径错', () => {
    const r = toFriendlyError('GET http://localhost:1234/foo returned 404')
    expect(r.title).toContain('endpoint')
  })

  it('429 rate limit → 友好提示', () => {
    const r = toFriendlyError('429 Too Many Requests')
    expect(r.title).toContain('速率')
  })

  it('502 → 网关异常', () => {
    const r = toFriendlyError('HTTP 502 Bad Gateway')
    expect(r.title).toContain('网关')
  })

  it('503 → 服务不可用', () => {
    const r = toFriendlyError('503 Service Unavailable')
    expect(r.title).toContain('不可用')
  })

  it('context length → 上下文超', () => {
    const r = toFriendlyError(
      'context_length_exceeded: maximum context length is 32768 tokens',
    )
    expect(r.title).toContain('上下文长度')
  })

  it('vision GGML_ASSERT → vision 模型炸', () => {
    const r = toFriendlyError('GGML_ASSERT: nh > 0 mmproj')
    expect(r.title).toContain('Vision')
    expect(r.goto).toBe('vision')
  })

  it('TTS 关键字 → TTS 提示', () => {
    const r = toFriendlyError('TTS sidecar request failed')
    expect(r.title).toContain('TTS')
    expect(r.goto).toBe('tts')
  })

  it('database is locked → SQLite 提示', () => {
    const r = toFriendlyError('SQLITE_BUSY: database is locked')
    expect(r.title).toContain('记忆')
    expect(r.goto).toBe('memory')
  })

  it('JSON.parse 错 → 格式不对', () => {
    const r = toFriendlyError('SyntaxError: Unexpected token < in JSON')
    expect(r.title).toContain('格式')
  })

  it('未知错误 → 兜底显示首行', () => {
    const r = toFriendlyError('Some completely unknown error message\nsecond line')
    expect(r.title).toBe('出错了')
    expect(r.detail).toBe('Some completely unknown error message')
    expect(r.raw).toContain('Some completely unknown error message')
  })

  it('Error 对象 → 提取 message', () => {
    const r = toFriendlyError(new Error('ECONNREFUSED'))
    expect(r.title).toContain('连不上')
  })

  it('null/undefined → 兜底', () => {
    const r1 = toFriendlyError(null)
    expect(r1.title).toBe('出错了')
    const r2 = toFriendlyError(undefined)
    expect(r2.title).toBe('出错了')
  })

  it('raw 字段截断到 200 字符', () => {
    const long = 'x'.repeat(500)
    const r = toFriendlyError(long)
    expect(r.raw.length).toBeLessThanOrEqual(200)
  })

  it('对象错误 → JSON.stringify', () => {
    const r = toFriendlyError({ code: 'ECONNREFUSED', errno: -61 })
    expect(r.title).toContain('连不上')
  })
})
