import { expect, test } from './fixtures'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

const composer = (page: Parameters<typeof test>[1]['browserPage']) =>
  page.locator('[data-boring-agent-part="composer-input"]')

const stopBtn = (page: Parameters<typeof test>[1]['browserPage']) =>
  page.locator('button[aria-label="Stop"]')

const submitBtn = (page: Parameters<typeof test>[1]['browserPage']) =>
  page.locator('button[aria-label="Submit"]')

/** Wait for streaming to start (stop button appears). */
async function waitForStreaming(page: Parameters<typeof test>[1]['browserPage']) {
  await expect(stopBtn(page)).toBeVisible({ timeout: 30_000 })
}

/** Wait for streaming to end (submit button re-appears). */
async function waitForIdle(page: Parameters<typeof test>[1]['browserPage']) {
  await expect(submitBtn(page)).toBeVisible({ timeout: 30_000 })
}

test.describe('M3c: interrupt + message queue (requires real key)', () => {
  test.skip(!hasRealKey, 'Requires real ANTHROPIC_API_KEY')

  // Force a current, non-deprecated model so tests don't fail due to removed model IDs.
  test.beforeEach(async ({ browserPage }) => {
    await browserPage.evaluate(() => {
      localStorage.setItem(
        'boring-agent:composer:model',
        JSON.stringify({ provider: 'anthropic', id: 'claude-haiku-4-5-20251001' }),
      )
      localStorage.setItem('boring-agent:composer:model:user-selected', '1')
    })
    await browserPage.reload()
    await browserPage.locator('[data-boring-agent-part="composer-input"]').waitFor()
  })

  test('stop button returns composer to idle — no stuck streaming state', async ({ browserPage }) => {
    // Use a slow bash command so we have a wide window to interrupt
    await composer(browserPage).fill(
      'Run this exact bash command and nothing else: sleep 10 && echo done',
    )
    await submitBtn(browserPage).click()

    // Confirm streaming started
    await waitForStreaming(browserPage)

    // Interrupt
    await stopBtn(browserPage).click()

    // Composer must return to idle — submit button reappears
    await waitForIdle(browserPage)

    // Any tool cards that appeared must be in a settled state (not stuck shimmer)
    const toolCards = browserPage.locator('[data-tool-state]')
    const count = await toolCards.count()
    for (let i = 0; i < count; i++) {
      await expect(toolCards.nth(i)).toHaveAttribute('data-tool-state', /success|error/, {
        timeout: 5_000,
      })
    }
  })

  test('Escape key stops the stream and returns composer to idle', async ({ browserPage }) => {
    await composer(browserPage).fill(
      'Run this exact bash command and nothing else: sleep 10 && echo done',
    )
    await submitBtn(browserPage).click()

    await waitForStreaming(browserPage)

    // Press Escape from the page body (not inside a text input)
    await browserPage.locator('body').click()
    await browserPage.keyboard.press('Escape')

    // Submit button must reappear — stream stopped
    await waitForIdle(browserPage)
  })

  test('message queued while streaming appears as Follow-up and auto-sends after turn ends', async ({ browserPage }) => {
    // A command that takes a few seconds so we have time to queue
    await composer(browserPage).fill(
      'Run this exact bash command and nothing else: sleep 3 && echo "first-done"',
    )
    await submitBtn(browserPage).click()

    // Queue a second message while streaming
    await waitForStreaming(browserPage)
    await composer(browserPage).fill('say exactly: second-message-received')
    await composer(browserPage).press('Enter')

    // Follow-up bubble appears immediately
    await expect(browserPage.locator('text=Follow-up')).toBeVisible({ timeout: 5_000 })

    // After the first run finishes the follow-up sends automatically.
    // The agent replies containing the requested text.
    await expect(
      browserPage.locator('[data-boring-agent-message-role="assistant"]').last(),
    ).toContainText('second-message-received', { timeout: 60_000 })

    // Follow-up bubble is gone once the queued message has been dispatched
    await expect(browserPage.locator('text=Follow-up')).not.toBeVisible({ timeout: 5_000 })
  })

  test('stop keeps the queued follow-up and auto-sends it next', async ({ browserPage }) => {
    await composer(browserPage).fill(
      'Run this exact bash command and nothing else: sleep 10 && echo done',
    )
    await submitBtn(browserPage).click()

    await waitForStreaming(browserPage)

    // Queue a follow-up
    await composer(browserPage).fill('say exactly: stop-queued-message-sent')
    await composer(browserPage).press('Enter')
    await expect(browserPage.locator('text=Follow-up')).toBeVisible({ timeout: 5_000 })

    // Stop the current turn; queued follow-up should survive and become next turn
    await stopBtn(browserPage).click()

    // The queued follow-up should eventually run and produce the requested reply
    await expect(
      browserPage.locator('[data-boring-agent-message-role="assistant"]').last(),
    ).toContainText('stop-queued-message-sent', { timeout: 60_000 })

    // Follow-up bubble is gone once dispatched
    await expect(browserPage.locator('text=Follow-up')).not.toBeVisible({ timeout: 5_000 })
  })
})
