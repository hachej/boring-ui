import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

function encodeUiStream(chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
}

test.describe('pi projection UI regressions', () => {
  test('does not duplicate normal AI SDK turns in the browser UI', async ({ browserPage }) => {
    let postCount = 0
    await browserPage.route('**/api/v1/agent/chat', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      postCount += 1
      const turn = postCount
      const userText = turn === 1 ? 'hi-e2e-dedupe' : 'second-e2e-dedupe'
      const assistantText = turn === 1 ? 'ASSISTANT_E2E_DEDUPE_ONE' : 'ASSISTANT_E2E_DEDUPE_TWO'
      const chunks = [
        { type: 'start', messageId: `sdk-a${turn}` },
        { type: 'data-pi-message-start', data: { seq: turn * 10 + 1, messageId: `pi-u${turn}`, role: 'user', text: userText } },
        { type: 'data-pi-message-end', data: { seq: turn * 10 + 2, messageId: `pi-u${turn}`, role: 'user', text: userText } },
        { type: 'data-pi-message-start', data: { seq: turn * 10 + 3, messageId: `pi-a${turn}`, role: 'assistant' } },
        { type: 'data-pi-text-start', data: { seq: turn * 10 + 4, messageId: `pi-a${turn}`, partId: '0' } },
        { type: 'data-pi-text-delta', data: { seq: turn * 10 + 5, messageId: `pi-a${turn}`, partId: '0', delta: assistantText } },
        { type: 'data-pi-text-end', data: { seq: turn * 10 + 6, messageId: `pi-a${turn}`, partId: '0' } },
        { type: 'data-pi-message-end', data: { seq: turn * 10 + 7, messageId: `pi-a${turn}`, role: 'assistant', text: assistantText } },
        { type: 'start-step' },
        { type: 'text-start', id: `sdk-t${turn}` },
        { type: 'text-delta', id: `sdk-t${turn}`, delta: assistantText },
        { type: 'text-end', id: `sdk-t${turn}` },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'stop' },
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

    const conversation = browserPage.getByLabel('Agent conversation')
    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('hi-e2e-dedupe')
    await browserPage.locator('button[aria-label="Submit"]').click()
    await expect(conversation.getByText('ASSISTANT_E2E_DEDUPE_ONE')).toBeVisible({ timeout: 10_000 })

    await composer.fill('second-e2e-dedupe')
    await browserPage.locator('button[aria-label="Submit"]').click()
    await expect(conversation.getByText('ASSISTANT_E2E_DEDUPE_TWO')).toBeVisible({ timeout: 10_000 })

    await expect(conversation.locator('[data-boring-agent-message-role="user"]')).toHaveCount(2)
    await expect(conversation.locator('[data-boring-agent-message-role="assistant"]')).toHaveCount(2)
    await expect(conversation.locator('[data-boring-agent-message-role="assistant"]').filter({ hasText: 'ASSISTANT_E2E_DEDUPE_ONE' })).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-message-role="assistant"]').filter({ hasText: 'ASSISTANT_E2E_DEDUPE_TWO' })).toHaveCount(1)
  })

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

  test('smoke: real LLM renders pi-projected tool UI', async ({ browserPage }) => {
    test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('Run this exact command with the bash tool: printf "pi-tool-ui-smoke\\n"')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await expect(browserPage.getByText(/Used command|Using command/)).toBeVisible({ timeout: 45_000 })
    await expect(browserPage.getByText('pi-tool-ui-smoke')).toBeVisible({ timeout: 45_000 })
  })

  test('smoke: real LLM renders pi-projected reasoning UI when enabled', async ({ browserPage }) => {
    test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

    await browserPage.evaluate(() => {
      localStorage.setItem('boring-agent:composer:show-thoughts', '1')
    })
    await browserPage.reload()

    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('Think briefly, then answer with exactly: pi-reasoning-ui-smoke')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await expect(browserPage.getByText('pi-reasoning-ui-smoke')).toBeVisible({ timeout: 45_000 })
    await expect(browserPage.getByText(/thoughts|thinking/).first()).toBeVisible({ timeout: 45_000 })
  })
})
