/**
 * normalize-endpoint 单测 (UX R55)。
 */
import { describe, expect, it } from 'vitest'
import { normalizeLlmEndpoint } from './normalize-endpoint'

describe('normalizeLlmEndpoint', () => {
  it('空 → 空', () => {
    expect(normalizeLlmEndpoint('')).toBe('')
    expect(normalizeLlmEndpoint('   ')).toBe('')
  })

  it('保留正常 endpoint', () => {
    expect(normalizeLlmEndpoint('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('去末尾 /', () => {
    expect(normalizeLlmEndpoint('http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('去多个末尾 /', () => {
    expect(normalizeLlmEndpoint('http://localhost/v1//')).toBe('http://localhost/v1')
  })

  it('去 /chat/completions 补全路径', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/chat/completions')).toBe(
      'http://x.com/v1',
    )
  })

  it('去 /completions', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/completions')).toBe('http://x.com/v1')
  })

  it('去 /models', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/models')).toBe('http://x.com/v1')
  })

  it('去 /embeddings', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/embeddings')).toBe('http://x.com/v1')
  })

  it('去标准 path 大小写不敏感', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/Chat/Completions')).toBe(
      'http://x.com/v1',
    )
  })

  it('补 http scheme', () => {
    expect(normalizeLlmEndpoint('127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1',
    )
  })

  it('保留 https scheme', () => {
    expect(normalizeLlmEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    )
  })

  it('修复 trailing / + 路径同时', () => {
    expect(normalizeLlmEndpoint('http://x.com/v1/chat/completions/')).toBe(
      'http://x.com/v1',
    )
  })

  it('保留无 /v1 的 endpoint (不强加)', () => {
    expect(normalizeLlmEndpoint('http://api.openai.com')).toBe('http://api.openai.com')
  })

  it('保留自定义路径 /api/v2', () => {
    expect(normalizeLlmEndpoint('http://x.com/api/v2')).toBe('http://x.com/api/v2')
  })

  it('去前后空白', () => {
    expect(normalizeLlmEndpoint('  http://x.com/v1  ')).toBe('http://x.com/v1')
  })
})
