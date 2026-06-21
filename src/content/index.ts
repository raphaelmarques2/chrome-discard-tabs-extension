declare global {
  interface Window {
    __tabSuspenderInjected?: boolean
  }
}

function debounce<T extends () => void>(fn: T, ms: number): T {
  let timeout: ReturnType<typeof setTimeout>
  return (() => {
    clearTimeout(timeout)
    timeout = setTimeout(fn, ms)
  }) as T
}

if (!window.__tabSuspenderInjected) {
  window.__tabSuspenderInjected = true

  const reportActivity = debounce(() => {
    chrome.runtime.sendMessage({ type: 'ACTIVITY' }).catch(() => {
      // Extension may have been reloaded
    })
  }, 1000)

  const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'] as const
  events.forEach((e) => document.addEventListener(e, reportActivity, { passive: true }))

  reportActivity()
}
