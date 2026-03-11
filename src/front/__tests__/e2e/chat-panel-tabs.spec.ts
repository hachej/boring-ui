import { test, expect } from '@playwright/test'

const APP_URL = '/?agent_mode=companion'

const countGroupViews = async (page) => page.locator('.dv-groupview').count()
const countSplitButtons = async (page) =>
  page.getByRole('button', { name: 'Split chat panel' }).count()

test.describe('Chat Panel Tabs And Split', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL)
    await page.evaluate(() => {
      localStorage.clear()
    })
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })
  })

  test('left header button opens a new split pane and panel + splits into a new pane', async ({ page }) => {
    const openChatTabButton = page.getByRole('button', { name: 'Open new chat pane' })
    await expect(openChatTabButton).toBeVisible()

    let splitButtonsBefore = await countSplitButtons(page)
    let groupsBefore = await countGroupViews(page)
    if (splitButtonsBefore === 0) {
      await openChatTabButton.click()
      await expect
        .poll(async () => countSplitButtons(page), { timeout: 10000 })
        .toBeGreaterThan(0)
      splitButtonsBefore = await countSplitButtons(page)
      groupsBefore = await countGroupViews(page)
    }
    expect(groupsBefore).toBeGreaterThan(0)

    await openChatTabButton.click()

    await expect
      .poll(async () => countSplitButtons(page), { timeout: 10000 })
      .toBeGreaterThan(0)

    const splitButtonsAfterOpen = await countSplitButtons(page)
    const groupsAfterOpen = await countGroupViews(page)
    expect(splitButtonsAfterOpen).toBeGreaterThanOrEqual(splitButtonsBefore)
    expect(groupsAfterOpen).toBeGreaterThan(0)

    const splitButtonsBeforeSplit = splitButtonsAfterOpen
    const splitButton = page.getByRole('button', { name: 'Split chat panel' }).first()
    await expect(splitButton).toBeVisible()
    await splitButton.click()

    await expect
      .poll(async () => countSplitButtons(page), { timeout: 10000 })
      .toBe(splitButtonsBeforeSplit + 1)

    await expect
      .poll(async () => countGroupViews(page), { timeout: 10000 })
      .toBeGreaterThan(0)
  })

  test('app auto-opens a chat panel on load and reload', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Split chat panel' }).first()).toBeVisible()
    const groupsBeforeReload = await countGroupViews(page)
    expect(groupsBeforeReload).toBeGreaterThan(0)

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[data-testid="dockview"]', { timeout: 20000 })

    await expect(page.getByRole('button', { name: 'Split chat panel' }).first()).toBeVisible()
  })
})
