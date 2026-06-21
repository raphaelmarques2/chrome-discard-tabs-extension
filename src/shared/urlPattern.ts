import { patternToRegex } from '../background/urlMatcher'

export function urlToDefaultPattern(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  if (!parsed.host) {
    return null
  }

  const pattern = `*://${parsed.host}/*`
  if (!patternToRegex(pattern).test(url)) {
    return null
  }

  return pattern
}
