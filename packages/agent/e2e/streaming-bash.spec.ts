import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('streaming bash: incremental output', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  test('multi-line bash output renders all lines', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Run this exact bash command: printf "line-one\\nline-two\\nline-three\\n"',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })

    await expect(toolCard).toHaveAttribute('data-tool-state', 'success', {
      timeout: 30_000,
    })

    const assistantMsg = browserPage.locator('[data-role="assistant"]').last()
    await expect(assistantMsg).toContainText('line-one', { timeout: 10_000 })
    await expect(assistantMsg).toContainText('line-three')
  })

  test('bash error (nonzero exit) still renders tool card', async ({
    browserPage,
  }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Run this exact bash command: echo "before-fail" && exit 1',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('bash')
  })

  test('long-running bash shows heartbeat then completes', async ({
    browserPage,
  }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('Run this exact command: sleep 4 && echo "done-after-sleep"')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })

    // Heartbeat ticker should appear during execution
    await expect(toolCard.getByText(/Running.*\(\d+s\)/)).toBeVisible({
      timeout: 10_000,
    })

    // Eventually completes
    await expect(toolCard).toHaveAttribute('data-tool-state', 'success', {
      timeout: 30_000,
    })
  })

})
