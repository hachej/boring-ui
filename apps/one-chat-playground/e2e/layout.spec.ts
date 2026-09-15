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
})

test('stacks on a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const chatBox = (await page.getByTestId('one-chat-chat').boundingBox())!
  const stageBox = (await page.getByTestId('one-chat-stage').boundingBox())!
  expect(chatBox.y).toBeLessThan(stageBox.y)
  expect(Math.abs(chatBox.x - stageBox.x)).toBeLessThan(2)
})
