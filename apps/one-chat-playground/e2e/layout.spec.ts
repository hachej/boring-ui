import { expect, test } from '@playwright/test'

// Layout smoke only: the page boots, the chat column and the app screen are
// both on screen, and none of the workbench chrome this app removed came back.
test('one chat, one screen', async ({ page }) => {
  await page.goto('/')

  const shell = page.getByTestId('one-chat-shell')
  await expect(shell).toBeVisible()

  const chat = page.getByTestId('one-chat-chat')
  await expect(chat).toBeVisible()

  const base = page.getByTestId('one-chat-base')
  await expect(base).toBeVisible()
  await expect(base).toHaveAttribute('src', /127\.0\.0\.1:\d+/)

  // Chat on the left, app on the right, chat column within its budget.
  const chatBox = (await chat.boundingBox())!
  const stageBox = (await page.getByTestId('one-chat-stage').boundingBox())!
  expect(chatBox.x).toBeLessThan(stageBox.x)
  expect(chatBox.width).toBeGreaterThanOrEqual(320)
  expect(chatBox.width).toBeLessThanOrEqual(420)

  // No sheet until the agent raises one.
  await expect(page.getByTestId('one-chat-sheet')).toHaveCount(0)

  const theme = page.getByTestId('one-chat-theme-toggle')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
  await expect(theme).toHaveAttribute('aria-label', 'Switch to dark theme')
  await theme.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(theme).toHaveAttribute('aria-label', 'Switch to light theme')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(theme).toBeHidden()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})

test('phone chat snaps button → half → full, then swipes down to button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const stage = page.getByTestId('one-chat-stage')
  const launcher = page.getByTestId('one-chat-launcher')
  const sheet = page.getByTestId('one-chat-mobile-sheet')
  const handle = page.getByTestId('one-chat-resizer')

  await expect(launcher).toBeVisible()
  const stageBox = (await stage.boundingBox())!
  expect(stageBox.width).toBeCloseTo(390, 0)
  expect(stageBox.height).toBeCloseTo(844, 0)

  await launcher.click()
  await expect(sheet).not.toHaveAttribute('aria-hidden', 'true')
  await page.goBack()
  await expect(launcher).toBeVisible()

  await launcher.click()
  await expect(sheet).not.toHaveAttribute('aria-hidden', 'true')
  let sheetBox = (await sheet.boundingBox())!
  expect(sheetBox.height).toBeGreaterThan(400)
  expect(sheetBox.height).toBeLessThan(445)

  let handleBox = (await handle.boundingBox())!
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2, 80, { steps: 6 })
  await page.mouse.up()
  sheetBox = (await sheet.boundingBox())!
  expect(sheetBox.height).toBeGreaterThan(800)

  handleBox = (await handle.boundingBox())!
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2, 620, { steps: 8 })
  await page.mouse.up()
  await expect(launcher).toBeVisible()
  await expect(sheet).toHaveAttribute('aria-hidden', 'true')
})

test('a pending question opens the phone chat to at least half', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
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
  await page.goto('/')

  await expect(page.getByTestId('one-chat-mobile-sheet')).not.toHaveAttribute('aria-hidden', 'true')
  const sheetBox = (await page.getByTestId('one-chat-mobile-sheet').boundingBox())!
  expect(sheetBox.height).toBeGreaterThanOrEqual(400)
})
