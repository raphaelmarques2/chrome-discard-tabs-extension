/// <reference types="@crxjs/vite-plugin/client" />
import type { UrlRule } from '../shared/types'
import { findMatchingRule } from './urlMatcher'
import contentScriptPath from '../content/index.ts?script&iife'

export const INJECTION_MARKER = '__tabSuspenderInjected'

const SCRIPT_ID = 'tab-suspender-activity'

export async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [contentScriptPath],
    })
  } catch {
    // Tab may not allow injection (chrome://, discarded, etc.)
  }
}

export async function updateContentScripts(rules: UrlRule[]): Promise<void> {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
  } catch {
    // Not registered yet
  }

  if (rules.length === 0) return

  const matches = [...new Set(rules.map((rule) => rule.pattern))]

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [contentScriptPath],
      matches,
      runAt: 'document_idle',
    },
  ])
}

export function urlMatchesRules(url: string, rules: UrlRule[]): boolean {
  return findMatchingRule(url, rules) !== undefined
}

export async function syncExistingTabs(rules: UrlRule[]): Promise<void> {
  if (rules.length === 0) return

  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url && urlMatchesRules(tab.url, rules)) {
      await injectContentScript(tab.id)
    }
  }
}
