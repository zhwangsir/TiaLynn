/**
 * highlight-match 单测 (UX R81)。
 */
import { describe, expect, it } from 'vitest'
import { highlightMatch } from './highlight-match'

describe('highlightMatch', () => {
  it('空 text → 空', () => {
    expect(highlightMatch('', 'x')).toEqual([])
  })

  it('空 query → 整段未匹配', () => {
    expect(highlightMatch('hello', '')).toEqual([{ text: 'hello', matched: false }])
    expect(highlightMatch('hello', '   ')).toEqual([{ text: 'hello', matched: false }])
  })

  it('无匹配 → 整段未匹配', () => {
    expect(highlightMatch('hello', 'xyz')).toEqual([{ text: 'hello', matched: false }])
  })

  it('中间匹配 → 3 段', () => {
    expect(highlightMatch('hello world', 'lo')).toEqual([
      { text: 'hel', matched: false },
      { text: 'lo', matched: true },
      { text: ' world', matched: false },
    ])
  })

  it('开头匹配 → 2 段', () => {
    expect(highlightMatch('hello world', 'hel')).toEqual([
      { text: 'hel', matched: true },
      { text: 'lo world', matched: false },
    ])
  })

  it('结尾匹配 → 2 段', () => {
    expect(highlightMatch('hello world', 'world')).toEqual([
      { text: 'hello ', matched: false },
      { text: 'world', matched: true },
    ])
  })

  it('全匹配 → 1 段', () => {
    expect(highlightMatch('foo', 'foo')).toEqual([{ text: 'foo', matched: true }])
  })

  it('大小写不敏感', () => {
    expect(highlightMatch('Hello', 'ell')).toEqual([
      { text: 'H', matched: false },
      { text: 'ell', matched: true },
      { text: 'o', matched: false },
    ])
  })

  it('中文匹配', () => {
    expect(highlightMatch('打开设置', '设置')).toEqual([
      { text: '打开', matched: false },
      { text: '设置', matched: true },
    ])
  })

  it('仅匹配第一次出现 (不重复匹配)', () => {
    expect(highlightMatch('foo foo', 'foo')).toEqual([
      { text: 'foo', matched: true },
      { text: ' foo', matched: false },
    ])
  })
})
