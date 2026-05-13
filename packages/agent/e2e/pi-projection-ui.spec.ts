import { expect, test } from './fixtures'

function encodeUiStream(chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
}

test.describe('pi projection UI regressions', () => {
  test('renders pi-projected tool and reasoning parts in the browser UI', async ({ browserPage }) => {
    await browserPage.evaluate(() => {
      localStorage.setItem('boring-agent:composer:show-thoughts', '1')
    })
    await browserPage.reload()

    await browserPage.route('**/api/v1/agent/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const chunks = [
        { type: 'data-pi-message-start', data: { seq: 1, messageId: 'assistant-ui', role: 'assistant' } },
        { type: 'data-pi-reasoning-start', data: { seq: 2, messageId: 'assistant-ui', partId: 'r0' } },
        { type: 'data-pi-reasoning-delta', data: { seq: 3, messageId: 'assistant-ui', partId: 'r0', delta: 'Need to inspect files first.' } },
        { type: 'data-pi-reasoning-end', data: { seq: 4, messageId: 'assistant-ui', partId: 'r0' } },
        { type: 'data-pi-tool-call-end', data: { seq: 5, messageId: 'assistant-ui', toolCallId: 'tool-1', toolName: 'bash', input: { command: 'ls' } } },
        { type: 'data-pi-tool-result', data: { seq: 6, messageId: 'assistant-ui', toolCallId: 'tool-1', output: { content: [{ type: 'text', text: 'README.md' }] } } },
        { type: 'data-pi-text-start', data: { seq: 7, messageId: 'assistant-ui', partId: '0' } },
        { type: 'data-pi-text-delta', data: { seq: 8, messageId: 'assistant-ui', partId: '0', delta: 'Found README.md.' } },
        { type: 'data-pi-text-end', data: { seq: 9, messageId: 'assistant-ui', partId: '0' } },
        { type: 'data-pi-message-end', data: { seq: 10, messageId: 'assistant-ui', role: 'assistant', text: 'Found README.md.' } },
        { type: 'finish' },
      ]
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
        body: encodeUiStream(chunks),
      })
    })

    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('List files')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await expect(browserPage.getByText('Found README.md.')).toBeVisible({ timeout: 10_000 })
    await expect(browserPage.getByText('Used command')).toBeVisible({ timeout: 10_000 })

    const thoughtsTrigger = browserPage.getByText(/thoughts|thinking/).first()
    await expect(thoughtsTrigger).toBeVisible({ timeout: 10_000 })
    await thoughtsTrigger.click()
    await expect(browserPage.getByText('Need to inspect files first.')).toBeVisible({ timeout: 10_000 })
  })
})
