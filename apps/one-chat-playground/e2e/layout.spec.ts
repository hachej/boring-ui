import { expect, test, type Page } from '@playwright/test'

interface AppView { slug: string; title: string; url: string }

async function firstApp(page: Page): Promise<AppView> {
  const response = await page.request.get('/api/one-chat/apps')
  const body = await response.json() as { apps: AppView[] }
  if (body.apps[0]) return body.apps[0]
  const created = await page.request.post('/api/one-chat/apps', { data: { title: 'Starter app' }, timeout: 120_000 })
  expect(created.ok()).toBe(true)
  return created.json() as Promise<AppView>
}

test('desktop creates an app, keeps chat full width, then reveals a bridge-driven screen', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page).toHaveURL(/\/new/)
  await page.getByTestId('one-chat-create-form').getByLabel('App name').fill('Client portal')
  await page.getByTestId('one-chat-create-form').getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/apps\/client-portal(?:\?.*)?$/)

  const rail = page.getByTestId('one-chat-rail')
  const chat = page.getByTestId('one-chat-chat')
  await expect(rail).toBeVisible()
  await expect(page.getByRole('button', { name: 'Client portal' })).toBeVisible()
  await expect(chat).toBeVisible()
  await expect(page.getByTestId('one-chat-stage')).toHaveCount(0)

  const chatOnlyBox = (await chat.boundingBox())!
  expect(chatOnlyBox.x).toBeCloseTo(56, 0)
  expect(chatOnlyBox.width).toBeGreaterThan(1_150)
  await page.screenshot({ path: '.artifacts/chat-only-desktop.png' })
  await page.screenshot({ path: '.artifacts/rail-desktop.png' })

  const createdApp = await (await page.request.get('/api/one-chat/apps/client-portal')).json() as AppView
  let stageEventSent = false
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    if (stageEventSent) return route.continue()
    stageEventSent = true
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        type: 'stage.show',
        what: 'app',
        url: createdApp.url,
        title: 'Client portal',
      })}\n\n`,
    })
  })
  await page.reload()

  const stage = page.getByTestId('one-chat-stage')
  await expect(stage).toBeVisible()
  await expect(page.getByTestId('one-chat-base')).toBeVisible()
  const splitChatBox = (await chat.boundingBox())!
  const stageBox = (await stage.boundingBox())!
  expect(splitChatBox.width).toBeLessThan(chatOnlyBox.width)
  expect(splitChatBox.x).toBeLessThan(stageBox.x)
})

test('phone top bar opens the app sheet, creates an app, and Back restores the prior URL state', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.goto(`/apps/${app.slug}`)

  const topBar = page.getByTestId('one-chat-mobile-app-bar')
  await expect(topBar).toBeVisible()
  await topBar.click()
  const sheet = page.getByTestId('one-chat-app-sheet-layer')
  await expect(sheet).toBeVisible()
  const dialog = sheet.getByRole('dialog', { name: 'Your apps' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(sheet.getByRole('button', { name: app.title })).toHaveAttribute('aria-current', 'page')
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.screenshot({ path: '.artifacts/rail-phone-sheet.png' })

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(topBar).toBeFocused()
  await topBar.click()

  await page.getByTestId('one-chat-app-sheet-layer').getByRole('button', { name: 'New app' }).click()
  await sheet.getByLabel('App name').fill('Pocket notes')
  await sheet.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/apps\/pocket-notes(?:\?.*)?$/)
  await expect(topBar).toContainText('Pocket notes')

  await page.goBack()
  await expect.poll(() => page.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get('panel'),
  }))).toEqual({ pathname: `/apps/${app.slug}`, panel: 'new' })
  await expect(page.getByTestId('one-chat-create-form')).toBeVisible()
})

test('closing a directly loaded app sheet stays inside One Chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.goto(`/apps/${app.slug}?panel=apps`)

  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await expect.poll(() => page.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get('panel'),
  }))).toEqual({ pathname: `/apps/${app.slug}`, panel: null })
  await expect(page.getByTestId('one-chat-app-sheet-layer')).toHaveCount(0)
})

test('a pending question opens phone chat to at least half when a screen is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.route('**/api/v1/questions/pending', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        questions: [{
          questionId: 'question-e2e',
          sessionId: 'one-chat',
          toolCallId: 'call-e2e',
          title: 'Keep this sketch?',
          answerToken: 'token-e2e',
          createdAt: '2026-09-15T12:00:00.000Z',
          schema: {
            wireVersion: 1,
            fields: [{
              type: 'radio',
              name: 'choice',
              label: 'Choose one',
              options: [
                { value: 'keep', label: 'Keep it (recommended)' },
                { value: 'change', label: 'Change it' },
              ],
            }],
          },
        }],
      }),
    })
  })
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'stage.show', what: 'app', url: app.url, title: app.title })}\n\n`,
    })
  })
  await page.goto(`/apps/${app.slug}`)

  await expect(page.getByTestId('one-chat-mobile-sheet')).not.toHaveAttribute('aria-hidden', 'true')
  const sheetBox = (await page.getByTestId('one-chat-mobile-sheet').boundingBox())!
  expect(sheetBox.height).toBeGreaterThanOrEqual(390)
})
