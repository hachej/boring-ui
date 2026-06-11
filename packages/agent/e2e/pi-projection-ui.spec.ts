import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== 'e2e-test-key'

test.describe('pi projection UI regressions', () => {
  test('does not duplicate Pi-native projected turns in the browser UI', async ({ page, backend }) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const conversation = page.getByLabel('Agent conversation')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('hi-e2e-dedupe')
    await page.locator('button[aria-label="Submit"]').click()
    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })

    await expect(conversation.locator('[data-boring-agent-message-role="user"]')).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-message-role="assistant"]')).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-message-role="assistant"]').filter({ hasText: 'PI_NATIVE_ASSISTANT_DONE' })).toHaveCount(1)
  })

  test('edits queued follow-ups from the composer banner', async ({ page, backend }) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 1,
        status: 'streaming',
        messages: [
          { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:text', text: 'active turn before edit' }] },
          { id: 'a1', role: 'assistant', status: 'streaming', parts: [{ type: 'text', id: 'a1:text', text: 'ACTIVE_TURN_STREAMING' }] },
        ],
        queue: {
          followUps: [
            { id: 'q1', kind: 'followup', displayText: 'queued message to edit', clientSeq: 1, clientNonce: 'queued-nonce' },
          ],
        },
        prompts: [],
        followups: [{ message: '<redacted>', clientSeq: 1, clientNonce: 'queued-nonce' }],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
      }))
    })
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('queued message to edit', { timeout: 10_000 })
    await expect(page.getByLabel('Agent conversation').locator('[data-waiting-follow-up="true"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Edit queued follow-ups' }).click()
    await expect(composer).toHaveValue(/queued message to edit/)
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => { clears: number } }).__piNativeE2EState())
    expect(state.clears).toBe(1)
  })

  test('renders Pi-native projected tool and reasoning parts in the browser UI', async ({ page, backend }) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('boring-agent:v2:agent-playground:composer:show-thoughts', '1')
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({ promptToolName: 'grep' }))
    })
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('List files')
    await page.locator('button[aria-label="Submit"]').click()

    const conversation = page.getByLabel('Agent conversation')
    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText(/Used search|Using search/)).toBeVisible({ timeout: 10_000 })

    const thoughtsTrigger = conversation.getByText(/thoughts|thinking/).first()
    await expect(thoughtsTrigger).toBeVisible({ timeout: 10_000 })
    const reasoningText = conversation.getByText('Reasoning visible')
    await expect(reasoningText).toBeVisible({ timeout: 10_000 })
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
      localStorage.setItem('boring-agent:v2:agent-playground:composer:show-thoughts', '1')
    })
    await browserPage.reload()

    const composer = browserPage.locator('[data-boring-agent-part="composer-input"]')
    await composer.fill('Think briefly, then answer with exactly: pi-reasoning-ui-smoke')
    await browserPage.locator('button[aria-label="Submit"]').click()

    await expect(browserPage.getByText('pi-reasoning-ui-smoke')).toBeVisible({ timeout: 45_000 })
    await expect(browserPage.getByText(/thoughts|thinking/).first()).toBeVisible({ timeout: 45_000 })
  })
})
