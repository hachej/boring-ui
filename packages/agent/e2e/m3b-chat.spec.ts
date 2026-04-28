import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('M3b: slash commands (client-side)', () => {
  test('/help shows command list', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('/help')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const response = browserPage.locator('[data-role="assistant"]').last()
    await expect(response).toBeVisible()
    await expect(response).toContainText('/clear')
    await expect(response).toContainText('/reset')
    await expect(response).toContainText('/model')
    await expect(response).toContainText('/help')
    await expect(response).toContainText('/cost')
  })

  test('/model haiku switches model', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('/model haiku')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const response = browserPage.locator('[data-role="assistant"]').last()
    await expect(response).toBeVisible()
    await expect(response).toContainText('Model set to haiku.')
  })

  test('/model with invalid name shows error', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('/model gpt4')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const response = browserPage.locator('[data-role="assistant"]').last()
    await expect(response).toBeVisible()
    await expect(response).toContainText('Unknown model')
  })

  test('/reset clears session after confirm', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')

    await composer.fill('/help')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()
    await expect(browserPage.locator('[data-role="assistant"]')).toHaveCount(1)

    browserPage.on('dialog', (dialog) => dialog.accept())

    await composer.fill('/reset')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const messages = browserPage.locator('[data-role="assistant"]')
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toContainText('Session reset.')
  })

  test('/reset cancelled preserves messages', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')

    await composer.fill('/help')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()
    await expect(browserPage.locator('[data-role="assistant"]')).toHaveCount(1)

    browserPage.on('dialog', (dialog) => dialog.dismiss())

    await composer.fill('/reset')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    // Messages preserved — still the /help response, no "Session reset." added
    const messages = browserPage.locator('[data-role="assistant"]')
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toContainText('/clear')
  })
})

test.describe('M3b: AI chat (tool card + heartbeat)', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  test('bash tool card renders with terminal output', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('Run: echo "hello from e2e"')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('bash')
  })

  test('edit tool card renders DiffView', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Edit the file src/main.ts: change "from-e2e-workspace" to "updated-by-e2e". Use the edit tool.',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const diffView = browserPage.locator('[data-testid="diff-view"]').first()
    await expect(diffView).toBeVisible({ timeout: 30_000 })
  })

  test('heartbeat ticker shows elapsed time on long tool', async ({
    browserPage,
  }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('Run this exact command: sleep 6 && echo done')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })

    // Wait for at least 2s elapsed to appear in the ticker
    await expect(toolCard.getByText(/Running.*\(\d+s\)/)).toBeVisible({
      timeout: 10_000,
    })
  })
})
