import { describe, it, expect, vi } from 'vitest'
import { patternToRegex, findMatchingRule } from '../../src/background/urlMatcher'
import type { UrlRule } from '../../src/shared/types'

describe('patternToRegex', () => {
  it('matches *://github.com/* against https://github.com/user/repo', () => {
    const regex = patternToRegex('*://github.com/*')
    expect(regex.test('https://github.com/user/repo')).toBe(true)
  })

  it('does not match *://github.com/* against https://gitlab.com/x', () => {
    const regex = patternToRegex('*://github.com/*')
    expect(regex.test('https://gitlab.com/x')).toBe(false)
  })

  it('matches exact pattern without wildcard against exact URL', () => {
    const url = 'https://example.com/specific/path'
    const regex = patternToRegex(url)
    expect(regex.test(url)).toBe(true)
    expect(regex.test('https://example.com/other/path')).toBe(false)
  })

  it('matches *://*.notion.so/* against subdomain', () => {
    const regex = patternToRegex('*://*.notion.so/*')
    expect(regex.test('https://workspace.notion.so/page/123')).toBe(true)
    expect(regex.test('https://my-team.notion.so/database')).toBe(true)
  })

  it('does not match *://mail.google.com/* against https://drive.google.com/', () => {
    const regex = patternToRegex('*://mail.google.com/*')
    expect(regex.test('https://drive.google.com/')).toBe(false)
    expect(regex.test('https://mail.google.com/mail/u/0')).toBe(true)
  })

  it('returns a regex that never matches for invalid patterns', () => {
    vi.spyOn(globalThis, 'RegExp').mockImplementationOnce(() => {
      throw new SyntaxError('Invalid regular expression')
    })
    const regex = patternToRegex('anything')
    expect(regex.test('https://example.com')).toBe(false)
    expect(regex.test('')).toBe(false)
  })
})

describe('findMatchingRule', () => {
  const rules: UrlRule[] = [
    { id: 'github', pattern: '*://github.com/*', timeoutMs: 60_000 },
    { id: 'gitlab', pattern: '*://gitlab.com/*', timeoutMs: 120_000 },
    { id: 'notion', pattern: '*://*.notion.so/*', timeoutMs: 30_000 },
  ]

  it('returns correct rule from multiple rules', () => {
    const rule = findMatchingRule('https://github.com/user/repo', rules)
    expect(rule).toBeDefined()
    expect(rule?.id).toBe('github')
    expect(rule?.pattern).toBe('*://github.com/*')
  })

  it('returns undefined for URL with no matching rule', () => {
    const rule = findMatchingRule('https://stackoverflow.com/questions/1', rules)
    expect(rule).toBeUndefined()
  })

  it('returns FIRST matching rule (not second)', () => {
    const overlappingRules: UrlRule[] = [
      { id: 'first', pattern: '*://github.com/*', timeoutMs: 60_000 },
      { id: 'second', pattern: 'https://github.com/*', timeoutMs: 120_000 },
    ]
    const rule = findMatchingRule('https://github.com/user/repo', overlappingRules)
    expect(rule?.id).toBe('first')
    expect(rule?.id).not.toBe('second')
  })
})
