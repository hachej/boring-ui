import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('M3b: slash commands (client-side)', () => {
  test('/reset starts a fresh session after confirm', async ({ browserPage }) => {
    const chat = browserPage.locator('[data-boring-agent-part="chat"]')
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', /.+/)
    const before = await chat.getAttribute('data-pi-chat-session-id')

    // /reset deletes the current session and starts a fresh, empty one (no
    // "Session reset." message — the rewrite drops the active session entirely).
    browserPage.once('dialog', (dialog) => dialog.accept())
    await composer.fill('/reset')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await expect(chat).not.toHaveAttribute('data-pi-chat-session-id', before ?? '', { timeout: 10_000 })
    await expect(browserPage.locator('[data-boring-agent-message-role="assistant"]')).toHaveCount(0)
  })

  test('/reset cancelled keeps the current session', async ({ browserPage }) => {
    const chat = browserPage.locator('[data-boring-agent-part="chat"]')
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', /.+/)
    const before = await chat.getAttribute('data-pi-chat-session-id')

    // Dismissing the confirm leaves the active session untouched.
    browserPage.once('dialog', (dialog) => dialog.dismiss())
    await composer.fill('/reset')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await browserPage.waitForTimeout(500)
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', before ?? '')
  })
})

test.describe('M3b: AI chat (tool card + heartbeat)', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  test('bash tool card renders with terminal output', async ({ browserPage }) => {
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('Run: echo "hello from e2e"')
    await browserPage.locator('button[aria-label="Submit"]').click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('bash')
  })

  test('edit tool card renders DiffView', async ({ browserPage }) => {
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill(
      'Edit the file src/main.ts: change "from-e2e-workspace" to "updated-by-e2e". Use the edit tool.',
    )
    await browserPage.locator('button[aria-label="Submit"]').click()

    const diffView = browserPage.locator('[data-testid="diff-view"]').first()
    await expect(diffView).toBeVisible({ timeout: 30_000 })
  })

  test('heartbeat ticker shows elapsed time on long tool', async ({
    browserPage,
  }) => {
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('Run this exact command: sleep 6 && echo done')
    await browserPage.locator('button[aria-label="Submit"]').click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })

    // Wait for at least 2s elapsed to appear in the ticker
    await expect(toolCard.getByText(/Running.*\(\d+s\)/)).toBeVisible({
      timeout: 10_000,
    })
  })
})
