/**
 * v0.13 (audit): logger.redactSensitive 单元测试。
 *
 * 不能 import 整个 logger.ts（会调用 electron app），只测 pure redact 函数。
 * 因此实际项目里 redactSensitive 已经被 logger.initialize 全局应用，
 * 这里只验证 redact 模式本身正确。
 */
import { describe, it, expect } from 'vitest'
import { redactSensitive } from './logger'

describe('redactSensitive', () => {
  describe('api_key 字段', () => {
    it('redact JSON 风格 api_key', () => {
      const input = '{"llm_endpoint": "http://x.com", "api_key": "sk-abc123def456"}'
      expect(redactSensitive(input)).toContain('"api_key": "[REDACTED]"')
      expect(redactSensitive(input)).not.toContain('sk-abc123def456')
    })

    it('redact 大小写不敏感 + API_KEY 变体', () => {
      expect(redactSensitive('"API_KEY":"xyz"')).toContain('[REDACTED]')
      expect(redactSensitive('"ApiKey":"xyz"')).toContain('[REDACTED]')
    })

    it('redact x-api-key 头', () => {
      const input = '"x-api-key": "secret-token-12345"'
      expect(redactSensitive(input)).toBe('"x-api-key": "[REDACTED]"')
    })
  })

  describe('Bearer token', () => {
    it('redact Authorization: Bearer xxx', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIs.payload.sig'
      expect(redactSensitive(input)).toContain('Bearer [REDACTED]')
      expect(redactSensitive(input)).not.toContain('eyJhbGciOiJIUzI1NiIs')
    })

    it('短 token (< 8 字符) 不 redact — 避免误伤普通文字', () => {
      const input = 'Bearer abc'
      expect(redactSensitive(input)).toBe('Bearer abc')
    })
  })

  describe('OpenAI / Anthropic 风格 sk- token', () => {
    it('redact sk-xxx', () => {
      expect(redactSensitive('key=sk-1234567890abcdef')).toContain('sk-[REDACTED]')
    })
    it('redact sk-proj-xxx', () => {
      expect(redactSensitive('use sk-proj-abc1234567xyz890def')).toContain('sk-proj-[REDACTED]')
    })
    it('redact sk-ant-xxx', () => {
      expect(redactSensitive('hdr sk-ant-api03-abcdef123456')).toContain('sk-ant-[REDACTED]')
    })
    it('短 sk-xxx (< 16 字符) 不 redact 防误伤', () => {
      // "sk-foo" 这种 6 字符短 token 不该被替换
      expect(redactSensitive('sk-short')).toBe('sk-short')
    })
  })

  describe('非字符串输入', () => {
    it('Error 对象转字符串后 redact', () => {
      const e = new Error('Connection failed: api_key=sk-realtokenabcdef12345')
      const out = redactSensitive(e)
      expect(out).toContain('sk-[REDACTED]')
    })
    it('undefined / null 不抛错', () => {
      expect(redactSensitive(undefined)).toBe('undefined')
      expect(redactSensitive(null)).toBe('null')
    })
    it('Object 转 [object Object] — 不 redact 内部', () => {
      // 实际生产里 console.log({api_key: 'xxx'}) 会先被 electron-log 自己 inspect，
      // 然后 redact 才介入。我们只测原始 string 输入。
      const out = redactSensitive({ api_key: 'sk-real' })
      expect(out).toBe('[object Object]')
    })
  })

  describe('多种敏感字段共存', () => {
    it('一行含 Bearer + api_key 都 redact', () => {
      const input = 'fetch(url, {headers: {Authorization: "Bearer eyJ123456789xyz", "api_key": "sk-realtoken123456"}})'
      const out = redactSensitive(input)
      expect(out).toContain('Bearer [REDACTED]')
      expect(out).toContain('"api_key": "[REDACTED]"')
      expect(out).not.toContain('eyJ123456789xyz')
      expect(out).not.toContain('sk-realtoken123456')
    })
  })

  describe('安全场景', () => {
    it('普通日志不被误改', () => {
      const input = '[attention] proactive_monitor tick t=12345'
      expect(redactSensitive(input)).toBe(input)
    })
    it('URL 不被 redact（用户配置的 endpoint 调试需要）', () => {
      const input = 'connect to http://127.0.0.1:1234/v1/chat'
      expect(redactSensitive(input)).toBe(input)
    })
  })
})
