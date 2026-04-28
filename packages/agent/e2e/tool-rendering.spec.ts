import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('tool rendering: file & search tools', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  test('read tool card shows file content', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Read the file README.md and show me its contents. Use the read tool.',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('read')
  })

  test('write tool card renders with file path', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Write "e2e-write-test" to a new file called output.txt. Use only the write tool.',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('write')
  })

  test('find tool card renders results', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('Find all .md files in this directory. Use only the find tool.')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('find')
  })

  test('grep tool card renders with matches', async ({ browserPage }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill(
      'Search for the string "seeded" in all files. Use only the grep tool.',
    )
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })
    await expect(toolCard).toContainText('grep')
  })

  test('tool card transitions from running to success state', async ({
    browserPage,
  }) => {
    const composer = browserPage.locator('.composer textarea')
    await composer.fill('Run: echo "state-test"')
    await browserPage.locator('.composer button', { hasText: 'Send' }).click()

    const toolCard = browserPage.locator('[data-tool-state]').first()
    await expect(toolCard).toBeVisible({ timeout: 30_000 })

    await expect(toolCard).toHaveAttribute('data-tool-state', 'success', {
      timeout: 30_000,
    })
  })
})
