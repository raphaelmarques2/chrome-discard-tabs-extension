import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  onTabActivity,
  onTabRemoved,
  reconcileTabDeadlines,
  handleSuspendAlarm,
} from '../../src/background/tabManager'
import {
  injectContentScript,
  syncExistingTabs,
  updateContentScripts,
} from '../../src/background/contentScript'
import type { UrlRule } from '../../src/shared/types'

vi.mock('../../src/background/tabManager', () => ({
  onTabActivity: vi.fn().mockResolvedValue(undefined),
  onTabRemoved: vi.fn().mockResolvedValue(undefined),
  reconcileTabDeadlines: vi.fn().mockResolvedValue(undefined),
  handleSuspendAlarm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/background/contentScript', () => ({
  injectContentScript: vi.fn().mockResolvedValue(undefined),
  syncExistingTabs: vi.fn().mockResolvedValue(undefined),
  updateContentScripts: vi.fn().mockResolvedValue(undefined),
  urlMatchesRules: vi.fn((url: string) => url.includes('github.com')),
  INJECTION_MARKER: '__tabSuspenderInjected',
}))

const githubRule: UrlRule = {
  id: 'github',
  pattern: '*://github.com/*',
  timeoutMs: 60_000,
}

describe('background service worker', () => {
  let onAlarmListener: (alarm: chrome.alarms.Alarm) => void
  let onMessageListener: (
    msg: { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => boolean
  let onRemovedListener: (tabId: number) => void
  let onUpdatedListener: (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => void
  let onActivatedListener: (activeInfo: chrome.tabs.ActiveInfo) => void
  let onStorageChangedListener: (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => void

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    vi.stubGlobal('chrome', {
      alarms: {
        onAlarm: {
          addListener: vi.fn((listener) => {
            onAlarmListener = listener
          }),
        },
      },
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            onMessageListener = listener
          }),
        },
      },
      tabs: {
        get: vi.fn().mockResolvedValue({
          id: 10,
          url: 'https://github.com/user/repo',
        } as chrome.tabs.Tab),
        onRemoved: {
          addListener: vi.fn((listener) => {
            onRemovedListener = listener
          }),
        },
        onUpdated: {
          addListener: vi.fn((listener) => {
            onUpdatedListener = listener
          }),
        },
        onActivated: {
          addListener: vi.fn((listener) => {
            onActivatedListener = listener
          }),
        },
      },
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({ rules: [githubRule] }),
        },
        onChanged: {
          addListener: vi.fn((listener) => {
            onStorageChangedListener = listener
          }),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([]),
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
        unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
      },
    })

    await import('../../src/background/index')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers all required listeners', () => {
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled()
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled()
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled()
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled()
    expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled()
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalled()
  })

  it('delegates alarm events to handleSuspendAlarm', () => {
    onAlarmListener({ name: 'suspend-tab-42' } as chrome.alarms.Alarm)
    expect(handleSuspendAlarm).toHaveBeenCalledWith('suspend-tab-42')
  })

  it('handles ACTIVITY messages from tabs', async () => {
    const sendResponse = vi.fn()
    const result = onMessageListener(
      { type: 'ACTIVITY' },
      { tab: { id: 42, url: 'https://github.com/user/repo' } as chrome.tabs.Tab },
      sendResponse,
    )

    expect(result).toBe(true)
    await vi.waitFor(() => {
      expect(onTabActivity).toHaveBeenCalledWith(42, 'https://github.com/user/repo', [githubRule])
    })
    expect(sendResponse).toHaveBeenCalledWith({})
  })

  it('ignores ACTIVITY without tab id or url', () => {
    onMessageListener({ type: 'ACTIVITY' }, { tab: { id: 1 } as chrome.tabs.Tab }, vi.fn())
    onMessageListener(
      { type: 'ACTIVITY' },
      { tab: { url: 'https://example.com' } as chrome.tabs.Tab },
      vi.fn(),
    )
    expect(onTabActivity).not.toHaveBeenCalled()
  })

  it('delegates tab removal to onTabRemoved', () => {
    onRemovedListener(99)
    expect(onTabRemoved).toHaveBeenCalledWith(99)
  })

  it('handles tabs.onUpdated with URL change', async () => {
    onUpdatedListener(
      7,
      { url: 'https://github.com/user/repo' },
      { id: 7 } as chrome.tabs.Tab,
    )

    await vi.waitFor(() => {
      expect(onTabActivity).toHaveBeenCalledWith(7, 'https://github.com/user/repo', [githubRule])
    })
    expect(injectContentScript).toHaveBeenCalledWith(7)
  })

  it('handles tabs.onUpdated on status complete', async () => {
    onUpdatedListener(
      8,
      { status: 'complete' },
      { id: 8, url: 'https://github.com/page' } as chrome.tabs.Tab,
    )

    await vi.waitFor(() => {
      expect(onTabActivity).toHaveBeenCalledWith(8, 'https://github.com/page', [githubRule])
    })
  })

  it('handles tabs.onActivated for matching tabs', async () => {
    onActivatedListener({ tabId: 10, windowId: 1 })

    await vi.waitFor(() => {
      expect(chrome.tabs.get).toHaveBeenCalledWith(10)
      expect(onTabActivity).toHaveBeenCalledWith(10, 'https://github.com/user/repo', [githubRule])
      expect(injectContentScript).toHaveBeenCalledWith(10)
    })
  })

  it('ignores tabs.onActivated when tab has no url', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 11 } as chrome.tabs.Tab)

    onActivatedListener({ tabId: 11, windowId: 1 })

    await vi.waitFor(() => {
      expect(chrome.tabs.get).toHaveBeenCalledWith(11)
    })
    expect(onTabActivity).not.toHaveBeenCalled()
    expect(injectContentScript).not.toHaveBeenCalled()
  })

  it('ignores tabs.onActivated when tab lookup fails', async () => {
    vi.mocked(chrome.tabs.get).mockRejectedValueOnce(new Error('No tab with id: 12'))

    onActivatedListener({ tabId: 12, windowId: 1 })

    await vi.waitFor(() => {
      expect(chrome.tabs.get).toHaveBeenCalledWith(12)
    })
    expect(onTabActivity).not.toHaveBeenCalled()
  })

  it('reconciles deadlines and updates content scripts when rules change', async () => {
    vi.mocked(reconcileTabDeadlines).mockClear()
    vi.mocked(updateContentScripts).mockClear()

    const newRules = [githubRule, { id: 'x', pattern: '*://example.com/*', timeoutMs: 30_000 }]
    onStorageChangedListener({ rules: { newValue: newRules } }, 'sync')

    await vi.waitFor(() => {
      expect(reconcileTabDeadlines).toHaveBeenCalledWith(newRules)
      expect(updateContentScripts).toHaveBeenCalledWith(newRules)
      expect(syncExistingTabs).toHaveBeenCalledWith(newRules)
    })
  })

  it('ignores storage changes outside sync area', () => {
    vi.mocked(reconcileTabDeadlines).mockClear()
    vi.mocked(updateContentScripts).mockClear()

    onStorageChangedListener({ rules: { newValue: [] } }, 'local')

    expect(reconcileTabDeadlines).not.toHaveBeenCalled()
    expect(updateContentScripts).not.toHaveBeenCalled()
  })

  it('runs startup reconciliation and content script registration', async () => {
    await vi.waitFor(() => {
      expect(reconcileTabDeadlines).toHaveBeenCalledWith([githubRule])
      expect(updateContentScripts).toHaveBeenCalledWith([githubRule])
      expect(syncExistingTabs).toHaveBeenCalledWith([githubRule])
    })
  })
})
