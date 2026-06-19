import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'

test.describe('Pi-native playground showcase', () => {
  test('renders the static all-message chat fixture in the playground tab', async ({ page, backend }, testInfo) => {
    await navigateBrowserToBackend(page, backend.browserUrl)

    await page.getByRole('button', { name: 'showcase' }).click()

    const showcase = page.locator('[data-boring-agent-part="message-showcase"]')
    await expect(showcase).toBeVisible()
    await expect(showcase.getByText('Hard-coded chat session')).toBeVisible()

    const messageIds = await showcase.locator('[data-boring-agent-message-id]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-boring-agent-message-id')),
    )
    expect(messageIds).toEqual([
      'showcase-system',
      'showcase-user',
      'showcase-assistant-streaming',
      'showcase-assistant-final',
      'showcase-assistant-error',
      'showcase-assistant-aborted',
    ])

    const roles = await showcase.locator('[data-boring-agent-message-role]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-boring-agent-message-role')),
    )
    expect(roles).toEqual(['system', 'user', 'assistant', 'assistant', 'assistant', 'assistant'])

    const statuses = await showcase.locator('[data-boring-agent-message-status]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-boring-agent-message-status')),
    )
    expect(statuses).toEqual(['done', 'done', 'streaming', 'done', 'error', 'aborted'])

    const toolStates = await showcase.locator('[data-boring-agent-tool-state]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-boring-agent-tool-state')),
    )
    expect(toolStates).toEqual(expect.arrayContaining(['running', 'settled', 'failed', 'aborted']))
    await expect(showcase.getByText('Stopped command')).toBeVisible()
    await expect(showcase.getByText('running, used, stopped, failed')).toBeVisible()

    await expect(showcase.locator('[data-boring-agent-part="composer-queue-preview"]')).toContainText('1 queued follow-up')
    await expect(showcase.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('After you finish, run the browser baseline too.')
    await expect(showcase.locator('[data-boring-agent-part="message-notice"]')).toBeVisible()
    await expect(showcase.locator('[data-boring-agent-part="message-file"]')).toBeVisible()

    const hasInlineFilenameChip = await showcase.locator('code').evaluateAll((nodes) =>
      nodes.some((node) => node.textContent === 'README.md' && node.className.includes('bg-muted/55')),
    )
    expect(hasInlineFilenameChip).toBe(true)

    await testInfo.attach('pi-native-playground-showcase.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
})
