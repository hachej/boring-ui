import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import { createRegressionLogger } from './regressionLogging'

const REAL_BROWSER_PI_ENABLED = process.env.PW_REAL_BROWSER_PI === '1'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const waitForDockview = async (page: Page) => {
  await page.waitForSelector('[data-testid="dockview"]', {
    state: 'visible',
    timeout: 30000,
  })
}

const loginLocalDevUser = async (page: Page, email: string) => {
  await page.goto('/auth/login?redirect_uri=%2F', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await expect(page.getByLabel('Work email')).toBeVisible({ timeout: 30000 })
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /continue/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'), { timeout: 60000 })
  await expect.poll(async () => (
    page.evaluate(async () => {
      const response = await fetch('/auth/session', { credentials: 'include' })
      return response.status
    })
  )).toBe(200)
}

const waitForPiComposer = async (page: Page) => {
  await expect(page.locator('[data-testid="agent-app"]')).toBeVisible({ timeout: 60000 })
  await expect(page.locator('message-editor textarea').first()).toBeVisible({ timeout: 60000 })
  await page.waitForFunction(
    () =>
      typeof (window as any).__BORING_UI_PI_OPEN_FILE__ === 'function'
      && typeof (window as any).__BORING_UI_PI_LIST_TABS__ === 'function',
    undefined,
    { timeout: 60000 },
  )
}

const sendPiMessage = async (page: Page, message: string) => {
  const textarea = page.locator('message-editor textarea').first()
  const sendButton = page.locator(
    'message-editor .px-2.pb-2 > .flex.gap-2.items-center:last-child > button:last-child',
  ).first()

  await textarea.click()
  await textarea.fill(message)
  await expect(sendButton).toBeVisible({ timeout: 15000 })
  await expect(sendButton).toBeEnabled({ timeout: 15000 })
  await sendButton.click()
}

const recordFinalScreenshot = async (page: Page, testInfo: TestInfo) => {
  const screenshotPath = testInfo.outputPath('final-browser-pi-proof.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('final-browser-pi-proof', {
    path: screenshotPath,
    contentType: 'image/png',
  })
}

test.describe('Real Browser PI Workflow Proof', () => {
  test.skip(!REAL_BROWSER_PI_ENABLED, 'Set PW_REAL_BROWSER_PI=1 to run the real browser PI proof.')
  test.describe.configure({ timeout: 240_000 })

  test('creates, runs, and opens a file through browser PI against the TS backend', async ({
    page,
  }, testInfo) => {
    const tag = `${Date.now()}`
    const fileName = `bd-jzeeb-browser-pi-${tag}.sh`
    const expectedOutput = `browser-pi-proof-${tag}`
    const apiRequests: Array<{ method: string; path: string }> = []
    const logger = createRegressionLogger(page, testInfo, {
      bead: 'bd-jzeeb',
      predecessor: 'bd-1qiym',
      fileName,
      expectedOutput,
    })

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/w/')) {
        apiRequests.push({
          method: request.method(),
          path: `${url.pathname}${url.search}`,
        })
      }
    })

    await logger.step('establish local browser session', async () => {
      await loginLocalDevUser(page, `bd-jzeeb-${tag}@test.local`)
    })

    await logger.step('load app shell', async () => {
      await waitForDockview(page)
      await waitForPiComposer(page)
      await expect(page.locator('.dv-tab', { hasText: 'Agent' })).toHaveCount(1)
      await expect(page.locator('.dv-tab', { hasText: 'Files' })).toHaveCount(1)
    })

    await logger.step('create and run file via browser PI', async () => {
      await sendPiMessage(
        page,
        [
          `Create a shell script named ${fileName}.`,
          `It must contain exactly two lines: "#!/usr/bin/env bash" and "echo ${expectedOutput}".`,
          `Then run it with bash ${fileName}.`,
          'Use tools for the file creation and command execution, and tell me the exact stdout.',
        ].join(' '),
      )

      await expect(page.locator('.filetree-body').getByText(fileName, { exact: true })).toBeVisible({
        timeout: 120000,
      })
      await expect(page.locator('code').filter({
        hasText: new RegExp(`^${escapeRegExp(expectedOutput)}$`),
      }).last()).toBeVisible({
        timeout: 120000,
      })

      await expect.poll(() =>
        apiRequests.some((entry) => entry.path.startsWith('/api/v1/files/write')),
      ).toBe(true)
      await expect.poll(() =>
        apiRequests.some((entry) => entry.path.startsWith('/api/v1/exec/run')),
      ).toBe(true)
    })

    await logger.step('open file through ui bridge and verify tabs', async () => {
      await sendPiMessage(
        page,
        [
          `Open ${fileName} in the editor using the open_file tool.`,
          'After it opens, tell me which tabs are open.',
        ].join(' '),
      )

      await expect(page.locator('[data-testid="dockview-dv-default-tab"]', { hasText: fileName })).toBeVisible({
        timeout: 120000,
      })

      await expect.poll(async () => {
        const payload = await page.evaluate(() => {
          const bridge = (window as any).__BORING_UI_PI_LIST_TABS__
          return typeof bridge === 'function' ? bridge() : null
        })
        const tabs = Array.isArray(payload?.tabs) ? payload.tabs : []
        return tabs.includes(fileName)
      }).toBe(true)
    })

    const verdict = {
      file_created_via_ui_surface: true,
      command_output_visible: true,
      open_file_ui_bridge_observed: true,
      list_tabs_bridge_observed: true,
      api_requests: apiRequests,
    }

    await logger.note('verdict', verdict)
    await recordFinalScreenshot(page, testInfo)
    await logger.flush()

    const verdictPath = testInfo.outputPath('browser-pi-verdict.json')
    await fs.writeFile(verdictPath, JSON.stringify(verdict, null, 2), 'utf8')
    await testInfo.attach('browser-pi-verdict', {
      path: verdictPath,
      contentType: 'application/json',
    })
  })
})
