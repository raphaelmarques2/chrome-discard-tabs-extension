import type { UrlRule } from '../shared/types'
import {
  handleSuspendAlarm,
  onTabActivity,
  onTabRemoved,
  reconcileTabDeadlines,
} from './tabManager'
import {
  injectContentScript,
  syncExistingTabs,
  updateContentScripts,
  urlMatchesRules,
} from './contentScript'

async function getRules(): Promise<UrlRule[]> {
  const result = await chrome.storage.sync.get('rules')
  return (result['rules'] as UrlRule[]) ?? []
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleSuspendAlarm(alarm.name)
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ACTIVITY' && sender.tab?.id && sender.tab.url) {
    const tabId = sender.tab.id
    const url = sender.tab.url
    void getRules().then((rules) => onTabActivity(tabId, url, rules))
  }
  sendResponse({})
  return true
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabRemoved(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || (changeInfo.status === 'complete' && tab.url)) {
    const url = changeInfo.url ?? tab.url!
    void getRules().then(async (rules) => {
      await onTabActivity(tabId, url, rules)
      if (urlMatchesRules(url, rules)) {
        await injectContentScript(tabId)
      }
    })
  }
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes['rules']) return
  const newRules = (changes['rules'].newValue as UrlRule[]) ?? []
  void reconcileTabDeadlines(newRules).then(async () => {
    await updateContentScripts(newRules)
    await syncExistingTabs(newRules)
  })
})

void (async () => {
  const rules = await getRules()
  await reconcileTabDeadlines(rules)
  await updateContentScripts(rules)
  await syncExistingTabs(rules)
})()
