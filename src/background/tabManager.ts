import type { UrlRule } from '../shared/types'
import { findMatchingRule } from './urlMatcher'

const STORAGE_KEY = 'tabDeadlines'
const ALARM_PREFIX = 'suspend-tab-'

export interface TabDeadline {
  url: string
  deadline: number
  ruleId: string
}

type TabDeadlines = Record<number, TabDeadline>

let tabDeadlinesCache: TabDeadlines = {}

function alarmName(tabId: number): string {
  return `${ALARM_PREFIX}${tabId}`
}

function tabIdFromAlarmName(name: string): number | undefined {
  if (!name.startsWith(ALARM_PREFIX)) return undefined
  const tabId = Number(name.slice(ALARM_PREFIX.length))
  return Number.isFinite(tabId) ? tabId : undefined
}

async function getTabDeadlines(): Promise<TabDeadlines> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const raw = (result[STORAGE_KEY] as Record<string, TabDeadline> | undefined) ?? {}
  const deadlines: TabDeadlines = {}
  for (const [key, value] of Object.entries(raw)) {
    deadlines[Number(key)] = value
  }
  tabDeadlinesCache = deadlines
  return deadlines
}

async function setTabDeadlines(deadlines: TabDeadlines): Promise<void> {
  tabDeadlinesCache = deadlines
  await chrome.storage.local.set({ [STORAGE_KEY]: deadlines })
}

async function getRules(): Promise<UrlRule[]> {
  const result = await chrome.storage.sync.get('rules')
  return (result['rules'] as UrlRule[]) ?? []
}

async function clearTabDeadline(tabId: number): Promise<void> {
  await chrome.alarms.clear(alarmName(tabId))
  const deadlines = { ...(await getTabDeadlines()) }
  delete deadlines[tabId]
  await setTabDeadlines(deadlines)
}

async function scheduleTabDeadline(tabId: number, url: string, rule: UrlRule): Promise<void> {
  const deadline = Date.now() + rule.timeoutMs
  await chrome.alarms.clear(alarmName(tabId))
  await chrome.alarms.create(alarmName(tabId), { when: deadline })
  const deadlines = { ...(await getTabDeadlines()) }
  deadlines[tabId] = { url, deadline, ruleId: rule.id }
  await setTabDeadlines(deadlines)
}

export async function onTabActivity(
  tabId: number,
  url: string,
  rules: UrlRule[],
): Promise<void> {
  const rule = findMatchingRule(url, rules)
  if (!rule) {
    await clearTabDeadline(tabId)
    return
  }
  await scheduleTabDeadline(tabId, url, rule)
}

export async function onTabRemoved(tabId: number): Promise<void> {
  await clearTabDeadline(tabId)
}

export async function clearAllTabDeadlines(): Promise<void> {
  const deadlines = await getTabDeadlines()
  for (const tabIdStr of Object.keys(deadlines)) {
    await chrome.alarms.clear(alarmName(Number(tabIdStr)))
  }
  await setTabDeadlines({})
}

export async function reconcileTabDeadlines(rules: UrlRule[]): Promise<void> {
  const deadlines = await getTabDeadlines()
  const next: TabDeadlines = {}

  for (const [tabIdStr, entry] of Object.entries(deadlines)) {
    const tabId = Number(tabIdStr)
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch {
      await chrome.alarms.clear(alarmName(tabId))
      continue
    }

    const url = tab.url ?? entry.url
    const rule = findMatchingRule(url, rules)
    if (!rule) {
      await chrome.alarms.clear(alarmName(tabId))
      continue
    }

    if (entry.deadline <= Date.now()) {
      await suspendTabIfEligible(tabId)
      if (tabDeadlinesCache[tabId]) {
        next[tabId] = tabDeadlinesCache[tabId]
      }
      continue
    }

    await chrome.alarms.clear(alarmName(tabId))
    await chrome.alarms.create(alarmName(tabId), { when: entry.deadline })
    next[tabId] = { url, deadline: entry.deadline, ruleId: rule.id }
  }

  await setTabDeadlines(next)
}

export async function handleSuspendAlarm(name: string): Promise<void> {
  const tabId = tabIdFromAlarmName(name)
  if (tabId === undefined) return
  await suspendTabIfEligible(tabId)
}

export async function suspendTabIfEligible(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    await clearTabDeadline(tabId)
    return
  }

  if (!tab.url) {
    await clearTabDeadline(tabId)
    return
  }

  const rules = await getRules()
  const rule = findMatchingRule(tab.url, rules)
  if (!rule) {
    await clearTabDeadline(tabId)
    return
  }

  if (tab.pinned || tab.audible) {
    await scheduleTabDeadline(tabId, tab.url, rule)
    return
  }

  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
  if (activeTab?.id === tabId) {
    await scheduleTabDeadline(tabId, tab.url, rule)
    return
  }

  try {
    await chrome.tabs.discard(tabId)
  } catch {
    // Tab may have been closed before the alarm fired
  }
  await clearTabDeadline(tabId)
}

export function getActiveTimerCount(): number {
  return Object.keys(tabDeadlinesCache).length
}
