import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  onTabActivity,
  onTabRemoved,
  reconcileTabDeadlines,
  handleSuspendAlarm,
  clearAllTabDeadlines,
  getActiveTimerCount,
} from '../../src/background/tabManager'
import type { UrlRule } from '../../src/shared/types'

const githubRule: UrlRule = {
  id: 'github',
  pattern: '*://github.com/*',
  timeoutMs: 5 * 60 * 1000,
}

const gitlabRule: UrlRule = {
  id: 'gitlab',
  pattern: '*://gitlab.com/*',
  timeoutMs: 10 * 60 * 1000,
}

type TabDeadline = { url: string; deadline: number; ruleId: string }

function createChromeMock() {
  const alarms = new Map<string, { when?: number }>()
  let tabDeadlines: Record<number, TabDeadline> = {}
  let syncRules: UrlRule[] = []
  const tabs = new Map<number, chrome.tabs.Tab>()

  const mockDiscard = vi.fn().mockResolvedValue(undefined)
  const mockAlarmsCreate = vi.fn(async (name: string, info: { when?: number }) => {
    alarms.set(name, info)
  })
  const mockAlarmsClear = vi.fn(async (name: string) => {
    const existed = alarms.delete(name)
    return existed
  })
  const mockAlarmsGetAll = vi.fn(async () =>
    [...alarms.entries()].map(([name, info]) => ({ name, ...info })),
  )
  const mockStorageLocalGet = vi.fn(async (key: string) => ({ [key]: tabDeadlines }))
  const mockStorageLocalSet = vi.fn(async (data: Record<string, unknown>) => {
    if ('tabDeadlines' in data) {
      tabDeadlines = (data['tabDeadlines'] as Record<number, TabDeadline>) ?? {}
    }
  })
  const mockStorageSyncGet = vi.fn(async () => ({ rules: syncRules }))
  const mockTabsGet = vi.fn(async (tabId: number) => {
    const tab = tabs.get(tabId)
    if (!tab) throw new Error(`No tab with id: ${tabId}`)
    return tab
  })
  const mockTabsQuery = vi.fn(
    async (query: { active?: boolean; windowId?: number }) =>
      [...tabs.values()].filter(
        (tab) =>
          (query.active === undefined || tab.active === query.active) &&
          (query.windowId === undefined || tab.windowId === query.windowId),
      ),
  )

  vi.stubGlobal('chrome', {
    alarms: {
      create: mockAlarmsCreate,
      clear: mockAlarmsClear,
      getAll: mockAlarmsGetAll,
    },
    storage: {
      local: {
        get: mockStorageLocalGet,
        set: mockStorageLocalSet,
      },
      sync: {
        get: mockStorageSyncGet,
      },
    },
    tabs: {
      get: mockTabsGet,
      query: mockTabsQuery,
      discard: mockDiscard,
    },
  })

  return {
    alarms,
    get tabDeadlines() {
      return tabDeadlines
    },
    setSyncRules(rules: UrlRule[]) {
      syncRules = rules
    },
    setTab(tabId: number, tab: Partial<chrome.tabs.Tab>) {
      tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        active: false,
        pinned: false,
        audible: false,
        ...tab,
      } as chrome.tabs.Tab)
    },
    mockDiscard,
    mockAlarmsCreate,
    mockAlarmsClear,
    mockTabsGet,
    mockTabsQuery,
    resetDeadlines() {
      tabDeadlines = {}
      alarms.clear()
    },
  }
}

describe('tabManager', () => {
  let mock: ReturnType<typeof createChromeMock>

  beforeEach(() => {
    mock = createChromeMock()
    mock.setSyncRules([githubRule, gitlabRule])
  })

  afterEach(async () => {
    await clearAllTabDeadlines()
    vi.unstubAllGlobals()
  })

  it('schedules alarm when URL matches a rule', async () => {
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])

    expect(mock.mockAlarmsCreate).toHaveBeenCalledWith('suspend-tab-1', {
      when: expect.any(Number),
    })
    expect(getActiveTimerCount()).toBe(1)
    expect(mock.tabDeadlines[1]).toMatchObject({
      url: 'https://github.com/user/repo',
      ruleId: 'github',
    })
  })

  it('clears alarm when URL no longer matches (navigation bug)', async () => {
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])
    expect(getActiveTimerCount()).toBe(1)

    await onTabActivity(1, 'https://stackoverflow.com/questions/1', [githubRule])

    expect(mock.mockAlarmsClear).toHaveBeenCalledWith('suspend-tab-1')
    expect(getActiveTimerCount()).toBe(0)
  })

  it('reschedules alarm on new activity for matching URL', async () => {
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])
    const firstDeadline = mock.tabDeadlines[1].deadline

    await onTabActivity(1, 'https://github.com/user/other', [githubRule])
    const secondDeadline = mock.tabDeadlines[1].deadline

    expect(secondDeadline).toBeGreaterThanOrEqual(firstDeadline)
    expect(mock.mockAlarmsCreate).toHaveBeenCalledTimes(2)
  })

  it('clears alarm on onTabRemoved', async () => {
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])
    expect(getActiveTimerCount()).toBe(1)

    await onTabRemoved(1)

    expect(mock.mockAlarmsClear).toHaveBeenCalledWith('suspend-tab-1')
    expect(getActiveTimerCount()).toBe(0)
  })

  it('reconcileTabDeadlines clears orphaned deadlines', async () => {
    mock.alarms.set('suspend-tab-1', { when: Date.now() + 60_000 })
    mock.alarms.set('suspend-tab-2', { when: Date.now() + 60_000 })
    await chrome.storage.local.set({
      tabDeadlines: {
        1: {
          url: 'https://github.com/old',
          deadline: Date.now() + 60_000,
          ruleId: 'github',
        },
        2: {
          url: 'https://stackoverflow.com/q/1',
          deadline: Date.now() + 60_000,
          ruleId: 'missing',
        },
      },
    })

    mock.setTab(1, { url: 'https://github.com/user/repo', active: false })
    mock.setTab(2, { url: 'https://stackoverflow.com/q/1', active: false })

    await reconcileTabDeadlines([githubRule])

    expect(getActiveTimerCount()).toBe(1)
    expect(mock.tabDeadlines[2]).toBeUndefined()
  })

  it('handleSuspendAlarm discards inactive matching tab', async () => {
    mock.setTab(1, {
      url: 'https://github.com/user/repo',
      active: false,
      windowId: 1,
    })
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])

    await handleSuspendAlarm('suspend-tab-1')

    expect(mock.mockDiscard).toHaveBeenCalledWith(1)
    expect(getActiveTimerCount()).toBe(0)
  })

  it('handleSuspendAlarm skips active tab and reschedules', async () => {
    mock.setTab(1, {
      url: 'https://github.com/user/repo',
      active: true,
      windowId: 1,
    })
    mock.mockTabsQuery.mockResolvedValue([
      { id: 1, active: true, windowId: 1 } as chrome.tabs.Tab,
    ])
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])

    await handleSuspendAlarm('suspend-tab-1')

    expect(mock.mockDiscard).not.toHaveBeenCalled()
    expect(getActiveTimerCount()).toBe(1)
    expect(mock.mockAlarmsCreate).toHaveBeenCalledTimes(2)
  })

  it('handleSuspendAlarm reschedules pinned tabs instead of discarding', async () => {
    mock.setTab(1, {
      url: 'https://github.com/user/repo',
      active: false,
      pinned: true,
      windowId: 1,
    })
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])

    await handleSuspendAlarm('suspend-tab-1')

    expect(mock.mockDiscard).not.toHaveBeenCalled()
    expect(getActiveTimerCount()).toBe(1)
    expect(mock.mockAlarmsCreate).toHaveBeenCalledTimes(2)
  })

  it('onTabRemoved with stale cache does not wipe other tab deadlines', async () => {
    await chrome.storage.local.set({
      tabDeadlines: {
        1: {
          url: 'https://github.com/a',
          deadline: Date.now() + 60_000,
          ruleId: 'github',
        },
        2: {
          url: 'https://github.com/b',
          deadline: Date.now() + 60_000,
          ruleId: 'github',
        },
      },
    })

    await onTabRemoved(1)

    expect(getActiveTimerCount()).toBe(1)
    expect(mock.tabDeadlines[2]).toBeDefined()
    expect(mock.tabDeadlines[1]).toBeUndefined()
  })

  it('handleSuspendAlarm clears deadline when tab is closed', async () => {
    await onTabActivity(1, 'https://github.com/user/repo', [githubRule])
    mock.mockTabsGet.mockRejectedValue(new Error('No tab with id: 1'))

    await handleSuspendAlarm('suspend-tab-1')

    expect(mock.mockDiscard).not.toHaveBeenCalled()
    expect(getActiveTimerCount()).toBe(0)
  })

  it('multiple tabs have independent alarms', async () => {
    await onTabActivity(1, 'https://github.com/a', [githubRule])
    await onTabActivity(2, 'https://github.com/b', [githubRule])

    expect(getActiveTimerCount()).toBe(2)
    expect(mock.mockAlarmsCreate).toHaveBeenCalledWith('suspend-tab-1', expect.any(Object))
    expect(mock.mockAlarmsCreate).toHaveBeenCalledWith('suspend-tab-2', expect.any(Object))
  })

  it('clearAllTabDeadlines removes all pending alarms', async () => {
    await onTabActivity(1, 'https://github.com/a', [githubRule])
    await onTabActivity(2, 'https://gitlab.com/b', [gitlabRule])

    await clearAllTabDeadlines()

    expect(getActiveTimerCount()).toBe(0)
    expect(mock.alarms.size).toBe(0)
  })
})
