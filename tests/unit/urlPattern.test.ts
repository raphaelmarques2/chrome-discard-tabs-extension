import { describe, it, expect } from 'vitest'
import { urlToDefaultPattern } from '../../src/shared/urlPattern'

describe('urlToDefaultPattern', () => {
  it('returns host wildcard pattern for https URLs', () => {
    expect(urlToDefaultPattern('https://github.com/user/repo')).toBe('*://github.com/*')
  })

  it('includes non-default port in the pattern', () => {
    expect(urlToDefaultPattern('http://localhost:8080/app')).toBe('*://localhost:8080/*')
  })

  it('returns null for chrome:// URLs', () => {
    expect(urlToDefaultPattern('chrome://extensions/')).toBeNull()
  })

  it('returns null for chrome-extension:// URLs', () => {
    expect(urlToDefaultPattern('chrome-extension://abc123/popup.html')).toBeNull()
  })

  it('returns null for invalid URLs', () => {
    expect(urlToDefaultPattern('not-a-url')).toBeNull()
  })

  it('returns null for about: URLs', () => {
    expect(urlToDefaultPattern('about:blank')).toBeNull()
  })
})
