import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

test.describe('Pi-native chat browser matrix', () => {
  test('streams prompt, renders reasoning/tool state, queues follow-ups, stops, reloads plugins, and keeps UI-command display-only', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('boring-agent:v2:agent-playground:composer:show-thoughts', '1')
    })
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    const conversation = page.getByLabel('Agent conversation')
    const sessionRows = page.locator('[data-boring-agent-part="session-row"]')
    await expect(sessionRows).toHaveCount(1)
    await expect(sessionRows.first()).toHaveAttribute('data-boring-state', 'selected')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    await composer.fill('first prompt redacted')
    await page.locator('[data-boring-agent-part="composer-submit"]').click()

    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText(/bash|Used command|Ran command/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('Reasoning visible')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-pi-chat-session-id="pi-e2e"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)
    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toHaveCount(1)

    await page.evaluate(() => {
      const state = (window as unknown as { __piNativeE2EState: () => any }).__piNativeE2EState()
      state.status = 'streaming'
      state.queue = { followUps: [
        { id: 'q1', kind: 'followup', displayText: 'follow up one', clientSeq: 1, clientNonce: 'nonce-1' },
        { id: 'q2', kind: 'followup', displayText: 'follow up two', clientSeq: 2, clientNonce: 'nonce-2' },
        { id: 'q3', kind: 'followup', displayText: 'follow up three', clientSeq: 3, clientNonce: 'nonce-3' },
      ] }
      state.followups = [
        { message: '<redacted>', clientSeq: 1, clientNonce: 'nonce-1' },
        { message: '<redacted>', clientSeq: 2, clientNonce: 'nonce-2' },
        { message: '<redacted>', clientSeq: 3, clientNonce: 'nonce-3' },
      ]
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify(state))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toContainText('3 queued follow-ups', { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('follow up one', { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('follow up three', { timeout: 10_000 })
    await expect(conversation.locator('[data-waiting-follow-up="true"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Edit queued follow-ups' }).click()
    await expect(composer).toHaveValue(/follow up one[\s\S]*follow up two[\s\S]*follow up three/)
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)

    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)

    await composer.fill('/reload')
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByText('Agent plugins reloaded.')).toBeVisible({ timeout: 10_000 })

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState())
    await testInfo.attach('pi-native-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
    expect(state).toMatchObject({
      reloads: 1,
      uiCommandDispatches: 0,
    })
    expect((state as { prompts: unknown[] }).prompts).toHaveLength(1)
    expect((state as { followups: unknown[] }).followups).toHaveLength(3)
    expect((state as { stops: number }).stops).toBeGreaterThanOrEqual(1)
  })

  test('pressing Escape while streaming auto-posts the next queued follow-up', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    const conversation = page.getByLabel('Agent conversation')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    await page.evaluate(() => {
      const state = (window as unknown as { __piNativeE2EState: () => any }).__piNativeE2EState()
      state.status = 'streaming'
      state.queue = { followUps: [
        { id: 'q-escape', kind: 'followup', displayText: 'next queued after escape', clientSeq: 1, clientNonce: 'nonce-escape' },
      ] }
      state.followups = [
        { message: '<redacted>', clientSeq: 1, clientNonce: 'nonce-escape' },
      ]
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify(state))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('next queued after escape', { timeout: 10_000 })

    await composer.focus()
    await page.keyboard.press('Escape')

    await expect(conversation.getByText('next queued after escape')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('AUTO_POSTED_FOLLOWUP_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState())
    await testInfo.attach('pi-native-escape-queue-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
    expect(state).toMatchObject({
      interrupts: 1,
      stops: 0,
      queue: { followUps: [] },
    })
  })
})
