import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import {
  clearRules,
  getExtensionId,
  getExtensionPath,
  getPopupRelativePath,
  openPopup,
} from './helpers/extension'

const pathToExtension = getExtensionPath()
const popupRelativePath = getPopupRelativePath(pathToExtension)

let context: BrowserContext
let extensionId: string

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  })

  extensionId = await getExtensionId(context)
})

test.afterAll(async () => {
  await context?.close()
})

test.describe('Tab Suspender popup', () => {
  test('opens and shows empty state correctly', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await expect(page.getByRole('heading', { name: 'Tab Suspender' })).toBeVisible()
    await expect(page.getByText('Nenhuma regra configurada')).toBeVisible()
    await expect(page.locator('li code')).toHaveCount(0)

    await page.close()
  })

  test('adds a rule and shows it in the list', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await page.getByPlaceholder('*://github.com/*').fill('*://github.com/*')
    await page.getByRole('spinbutton').fill('30')
    await page.getByRole('button', { name: 'Adicionar' }).click()

    await expect(page.getByText('Nenhuma regra configurada')).not.toBeVisible()
    await expect(page.locator('li code', { hasText: '*://github.com/*' })).toBeVisible()
    await expect(page.getByText('30 min')).toBeVisible()

    await page.close()
  })

  test('persists a rule after closing and reopening the popup', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await page.getByPlaceholder('*://github.com/*').fill('*://example.com/*')
    await page.getByRole('spinbutton').fill('15')
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.locator('li code', { hasText: '*://example.com/*' })).toBeVisible()

    await page.close()

    const reopenedPage = await openPopup(context, extensionId, popupRelativePath)
    await expect(reopenedPage.locator('li code', { hasText: '*://example.com/*' })).toBeVisible()
    await expect(reopenedPage.getByText('15 min')).toBeVisible()

    await reopenedPage.close()
  })

  test('removes a rule from the list', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await page.getByPlaceholder('*://github.com/*').fill('*://remove-me.test/*')
    await page.getByRole('spinbutton').fill('5')
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.locator('li code', { hasText: '*://remove-me.test/*' })).toBeVisible()

    await page.getByRole('button', { name: 'Remover regra' }).click()

    await expect(page.locator('li code', { hasText: '*://remove-me.test/*' })).toHaveCount(0)
    await expect(page.getByText('Nenhuma regra configurada')).toBeVisible()

    await page.close()
  })

  test('does not allow adding a rule with an empty pattern', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await page.getByPlaceholder('*://github.com/*').fill('')
    await page.getByRole('button', { name: 'Adicionar' }).click()

    await expect(page.getByText('Informe um padrão de URL')).toBeVisible()
    await expect(page.locator('li code')).toHaveCount(0)

    await page.close()
  })

  test('does not allow a timeout shorter than one minute', async () => {
    const page = await openPopup(context, extensionId, popupRelativePath)
    await clearRules(page)

    await page.getByPlaceholder('*://github.com/*').fill('*://short-timeout.test/*')
    await page.getByRole('spinbutton').fill('0')
    await page.getByRole('button', { name: 'Adicionar' }).click()

    await expect(page.getByText('Tempo mínimo é 1 minuto')).toBeVisible()
    await expect(page.locator('li code', { hasText: '*://short-timeout.test/*' })).toHaveCount(0)

    await page.close()
  })
})
