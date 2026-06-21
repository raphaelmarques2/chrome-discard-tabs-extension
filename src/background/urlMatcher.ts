import type { UrlRule } from '../shared/types'

const NEVER_MATCH = /(?!)/

export function patternToRegex(pattern: string): RegExp {
  try {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`)
  } catch {
    return NEVER_MATCH
  }
}

export function findMatchingRule(url: string, rules: UrlRule[]): UrlRule | undefined {
  return rules.find((rule) => patternToRegex(rule.pattern).test(url))
}
