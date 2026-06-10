import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

test.describe('Pi-native turn-scoped stream errors', () => {
  test('ignores stale old-turn errors and settles only the active turn error', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    const submit = page.locator('[data-boring-agent-part="composer-submit"]')
    const conversation = page.getByLabel('Agent conversation')
    const messages = page.locator('[data-boring-agent-part="message"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    await emitPiChatEvents(page, [
      { type: 'agent-start', seq: 1, turnId: 'turn-active' },
      { type: 'message-start', seq: 2, messageId: 'a-active', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-active', partId: 'a-active:text', kind: 'text', delta: 'ACTIVE_STREAM_CHUNK' },
    ])

    await expect(conversation.getByText('ACTIVE_STREAM_CHUNK')).toBeVisible({ timeout: 10_000 })
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-status', 'streaming')

    await emitPiChatEvents(page, [
      {
        type: 'error',
        seq: 4,
        turnId: 'turn-stale',
        retryable: false,
        error: { code: 'INTERNAL_ERROR', message: 'STALE_TURN_ERROR', retryable: false },
      },
      { type: 'agent-end', seq: 5, turnId: 'turn-stale', status: 'error' },
    ])

    await expect(chat).toHaveAttribute('data-pi-chat-last-seq', '5', { timeout: 10_000 })
    await expect(page.getByText('STALE_TURN_ERROR')).toHaveCount(0)
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-id', 'a-active')
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-status', 'streaming')
    await expect(conversation.getByText('ACTIVE_STREAM_CHUNK')).toBeVisible()

    await emitPiChatEvents(page, [
      {
        type: 'error',
        seq: 6,
        turnId: 'turn-active',
        retryable: false,
        error: { code: 'INTERNAL_ERROR', message: 'ACTIVE_TURN_ERROR', retryable: false },
      },
    ])

    await expect(chat).toHaveAttribute('data-pi-chat-last-seq', '6', { timeout: 10_000 })
    await expect(page.getByText('ACTIVE_TURN_ERROR')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('STALE_TURN_ERROR')).toHaveCount(0)
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-id', 'a-active')
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-status', 'error')
    await expect(conversation.getByText('ACTIVE_STREAM_CHUNK')).toBeVisible()
    await expect(messages.first().getByText('ACTIVE_TURN_ERROR')).toHaveCount(0)
    await expect(page.getByTestId('chat-working')).toHaveCount(0)

    await emitPiChatEvents(page, [
      { type: 'agent-end', seq: 7, turnId: 'turn-active', status: 'ok' },
    ])

    await expect(chat).toHaveAttribute('data-pi-chat-last-seq', '7', { timeout: 10_000 })
    await expect(page.getByText('ACTIVE_TURN_ERROR')).toBeVisible()
    await expect(messages).toHaveCount(1)
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-id', 'a-active')
    await expect(messages.first()).toHaveAttribute('data-boring-agent-message-status', 'error')
    await expect(messages.first().getByText('ACTIVE_TURN_ERROR')).toHaveCount(0)
    await expect(page.getByTestId('chat-working')).toHaveCount(0)
    await expect(submit).toHaveAttribute('aria-label', 'Submit')
    await expect(composer).toBeEnabled()

    await syncMockCursor(page, 7)
    await composer.fill('redacted recovery prompt')
    await submit.click()

    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('chat-working')).toHaveCount(0, { timeout: 10_000 })
    await expect(submit).toHaveAttribute('aria-label', 'Submit')
    await expect(composer).toBeEnabled()

    await testInfo.attach('pi-native-error-scope.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T7-error-scope',
        state: await readErrorScopeState(page),
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})

async function emitPiChatEvents(page: Page, events: unknown[]): Promise<void> {
  await page.evaluate((frames) => {
    const emit = (window as unknown as { __piNativeE2EEmit: (sessionId: string, frame: unknown) => void }).__piNativeE2EEmit
    for (const frame of frames) emit('pi-e2e', frame)
  }, events)
}

async function syncMockCursor(page: Page, seq: number): Promise<void> {
  await page.evaluate((nextSeq) => {
    const state = (window as unknown as { __piNativeE2EState: () => any }).__piNativeE2EState()
    state.seq = nextSeq
    state.status = 'idle'
    localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify(state))
  }, seq)
}

async function readErrorScopeState(page: Page) {
  return page.evaluate(() => ({
    lastSeq: document.querySelector('[data-boring-agent-part="chat"]')?.getAttribute('data-pi-chat-last-seq'),
    submitLabel: document.querySelector('[data-boring-agent-part="composer-submit"]')?.getAttribute('aria-label'),
    composerDisabled: (document.querySelector('[data-boring-agent-part="composer-input"]') as HTMLTextAreaElement | null)?.disabled ?? null,
    messages: Array.from(document.querySelectorAll('[data-boring-agent-part="message"]')).map((node) => ({
      id: node.getAttribute('data-boring-agent-message-id'),
      role: node.getAttribute('data-boring-agent-message-role'),
      status: node.getAttribute('data-boring-agent-message-status'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })),
    notices: Array.from(document.querySelectorAll('[data-boring-agent-part="runtime-notice"]')).map((node) =>
      node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  }))
}
