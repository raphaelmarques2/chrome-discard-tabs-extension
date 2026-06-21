import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from '@playwright/test'

const e2eDir = path.dirname(fileURLToPath(import.meta.url))

export function getExtensionPath(): string {
  return path.resolve(e2eDir, '../../../dist')
}

export function getPopupRelativePath(extensionPath = getExtensionPath()): string {
  const manifestPath = path.join(extensionPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Extension manifest not found at ${manifestPath}. Run "npm run build" first.`,
    )
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    action?: { default_popup?: string }
  }

  const popupPath = manifest.action?.default_popup
  if (!popupPath) {
    throw new Error('manifest.json is missing action.default_popup')
  }

  const absolutePopupPath = path.join(extensionPath, popupPath)
  if (!fs.existsSync(absolutePopupPath)) {
    throw new Error(`Popup HTML not found at ${absolutePopupPath}`)
  }

  return popupPath.replace(/\\/g, '/')
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const [serviceWorker] = context.serviceWorkers()
  const worker =
    serviceWorker ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }))

  const extensionId = new URL(worker.url()).host
  if (!extensionId) {
    throw new Error(`Could not resolve extension id from worker url: ${worker.url()}`)
  }

  return extensionId
}

export function popupUrl(extensionId: string, popupRelativePath: string): string {
  return `chrome-extension://${extensionId}/${popupRelativePath}`
}

export async function openPopup(
  context: BrowserContext,
  extensionId: string,
  popupRelativePath: string,
): Promise<Page> {
  const page = await context.newPage()
  await page.goto(popupUrl(extensionId, popupRelativePath))
  return page
}

export async function clearRules(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await chrome.storage.sync.clear()
  })
  await page.reload()
}
