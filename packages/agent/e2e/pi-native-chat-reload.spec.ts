import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

test.describe('Pi-native active reload proof', () => {
  test('reload during an active turn preserves state, queue preview, connection metadata, and one session row', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 10,
        status: 'streaming',
        messages: [
          { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }] },
          { id: 'a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'a1:t', text: 'PI_NATIVE_ASSISTANT_DONE' }] },
        ],
        queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'queued across reload', clientSeq: 1 }] },
        prompts: [{ message: '<redacted>', clientNonce: 'seed' }],
        followups: [{ message: '<redacted>', clientSeq: 1, clientNonce: 'seed-followup' }],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
      }))
    })
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    await expect(page.locator('[data-boring-agent-part="session-row"]')).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="pi-chat-panel"]')).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(page.locator('[data-boring-agent-part="pi-chat-panel"]')).toHaveAttribute('data-pi-chat-connection', /connected|connecting/)
    await expect(page.getByLabel('Agent conversation').getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('queued across reload', { timeout: 10_000 })

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-boring-agent-part="session-row"]')).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="pi-chat-panel"]')).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(page.locator('[data-boring-agent-part="pi-chat-panel"]')).toHaveAttribute('data-pi-chat-connection', /connected|connecting/)
    await expect(page.getByLabel('Agent conversation').getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('queued across reload', { timeout: 10_000 })

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState())
    await testInfo.attach('pi-native-active-reload-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
    expect(state).toMatchObject({
      status: 'streaming',
      queue: { followUps: [expect.objectContaining({ displayText: 'queued across reload' })] },
      prompts: [expect.objectContaining({ message: '<redacted>' })],
    })
  })
})
