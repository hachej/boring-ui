import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState } from './helpers/chat-state'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

type ReplayResumePart = { type?: string; id?: string; text?: string; state?: string }
type ReplayResumeState = {
  seq: number
  status: string
  messages: Array<{ id: string; status?: string; parts: ReplayResumePart[] }>
  queue: { followUps: unknown[] }
}

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
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const sessionRows = page.locator('[data-boring-agent-part="session-row"]')
    await expect(sessionRows).toHaveCount(1)
    await expect(sessionRows.first()).toHaveAttribute('data-boring-state', 'selected')
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/)
    await expect(page.getByLabel('Agent conversation').getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText('queued across reload', { timeout: 10_000 })

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(sessionRows).toHaveCount(1)
    await expect(sessionRows.first()).toHaveAttribute('data-boring-state', 'selected')
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/)
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

  test('reload/reconnect applies final assistant text once without duplicating prior tool state', async ({ page, backend }, testInfo) => {
    const finalText = 'PI_NATIVE_FINAL_AFTER_RELOAD'

    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 7,
        status: 'streaming',
        messages: [
          { id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }] },
          {
            id: 'a1',
            role: 'assistant',
            status: 'streaming',
            parts: [
              { type: 'reasoning', id: 'r1', text: 'Reasoning before reload', state: 'done' },
              {
                type: 'tool-call',
                id: 'tool-1',
                toolName: 'grep',
                state: 'output-available',
                input: { pattern: 'printf redacted' },
                output: 'TOOL_OUTPUT_BEFORE_RELOAD',
              },
            ],
          },
        ],
        queue: { followUps: [] },
        prompts: [{ message: '<redacted>', clientNonce: 'seed' }],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
      }))
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const assistantMessages = page.locator('[data-boring-agent-part="message"][data-boring-agent-message-role="assistant"]')
    const assistantToolGroups = assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantToolGroups).toHaveCount(1)
    await expect(assistantToolGroups.getByRole('button', { name: /Tool calls: Used search/ })).toBeVisible()
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(0)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantToolGroups).toHaveCount(1)
    await expect(assistantToolGroups.getByRole('button', { name: /Tool calls: Used search/ })).toBeVisible()

    const finalSeq = await page.evaluate((replayedFinalText) => {
      type BrowserMessage = { id: string; role: 'user' | 'assistant'; status?: string; parts: Array<Record<string, unknown>> }
      type BrowserState = {
        seq: number
        status: 'idle' | 'streaming'
        messages: BrowserMessage[]
      }
      type E2EWindow = Window & {
        __piNativeE2EState: () => BrowserState
        __piNativeE2EEmit: (sessionId: string, frame: unknown) => void
      }

      const stateKey = '__boring_pi_native_e2e_state__'
      const win = window as E2EWindow
      const state = win.__piNativeE2EState()
      const emit = (frame: Record<string, unknown>) => {
        state.seq += 1
        win.__piNativeE2EEmit('pi-e2e', { ...frame, seq: state.seq })
      }
      const currentAssistant = state.messages.find((message) => message.id === 'a1')
      const preservedParts = currentAssistant?.parts.filter((part) => part.type !== 'text') ?? []

      emit({
        type: 'message-delta',
        messageId: 'a1',
        partId: 't-after-reload',
        kind: 'text',
        delta: replayedFinalText,
      })
      emit({
        type: 'message-part-end',
        messageId: 'a1',
        partId: 't-after-reload',
        kind: 'text',
        text: replayedFinalText,
      })

      const finalAssistant: BrowserMessage = {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [
          ...preservedParts,
          { type: 'text', id: 't-after-reload', text: replayedFinalText },
        ],
      }
      state.messages = state.messages.map((message) => message.id === 'a1' ? finalAssistant : message)
      emit({ type: 'message-end', messageId: 'a1', final: finalAssistant })
      state.status = 'idle'
      emit({ type: 'agent-end', turnId: 'turn-after-reload', status: 'ok' })
      localStorage.setItem(stateKey, JSON.stringify(state))

      return state.seq
    }, finalText)

    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first()).toHaveAttribute('data-boring-agent-message-id', 'a1')
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(1)

    const domState = await readChatDomState(page)
    assertChatDomInvariants(domState)
    expect(domState.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(domState.messages.find((message) => message.id === 'a1')?.partOrder).toEqual([
      'message-reasoning',
      'message-tools',
      'message-text',
    ])

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayResumeState
    const assistant = state.messages.find((message) => message.id === 'a1')
    expect(state).toMatchObject({
      seq: finalSeq,
      status: 'idle',
      queue: { followUps: [] },
    })
    expect(assistant).toMatchObject({
      id: 'a1',
      status: 'done',
      parts: [
        expect.objectContaining({ type: 'reasoning', state: 'done' }),
        expect.objectContaining({ type: 'tool-call', state: 'output-available' }),
        expect.objectContaining({ type: 'text', text: finalText }),
      ],
    })
    expect(assistant?.parts.filter((part) => part.type === 'text' && part.text === finalText)).toHaveLength(1)
    expect(assistant?.parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)

    await testInfo.attach('pi-native-replay-resume-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})
