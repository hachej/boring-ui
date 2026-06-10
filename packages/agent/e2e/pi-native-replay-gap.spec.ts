import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState } from './helpers/chat-state'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

type ReplayRangePart = { type?: string; id?: string; text?: string; state?: string }
type ReplayRangeState = {
  seq: number
  status: string
  messages: Array<{ id: string; status?: string; parts: ReplayRangePart[] }>
  queue: { followUps: unknown[] }
  eventStreamFailureServed?: number
  eventStreamRequests?: Array<{ sessionId: string; cursor: number }>
}

test.describe('Pi-native browser replay-range recovery', () => {
  test('rehydrates from /state after replay_gap and applies later final text once', async ({ page, backend }, testInfo) => {
    const finalText = 'PI_NATIVE_FINAL_AFTER_REPLAY_GAP'

    await installPiNativeMock(page)
    await page.addInitScript(() => {
      const user = {
        id: 'u1',
        role: 'user',
        status: 'done',
        parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }],
      }
      const assistantBeforeGap = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Reasoning before replay gap', state: 'done' },
        ],
      }
      const assistantAfterGap = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Reasoning before replay gap', state: 'done' },
          {
            type: 'tool-call',
            id: 'tool-1',
            toolName: 'bash',
            state: 'output-available',
            input: { command: 'printf redacted' },
            output: 'TOOL_OUTPUT_AFTER_REPLAY_GAP',
          },
        ],
      }

      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 10,
        status: 'streaming',
        messages: [user, assistantBeforeGap],
        queue: { followUps: [] },
        prompts: [{ message: '<redacted>', clientNonce: 'seed' }],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
        eventStreamFailures: [
          {
            cursor: 10,
            type: 'replay_gap',
            latestSeq: 12,
            minReplaySeq: 11,
            statePatch: {
              seq: 12,
              status: 'streaming',
              messages: [user, assistantAfterGap],
              queue: { followUps: [] },
            },
          },
        ],
      }))
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const assistantMessages = page.locator('[data-boring-agent-part="message"][data-boring-agent-message-role="assistant"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first()).toHaveAttribute('data-boring-agent-message-id', 'a1')
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(0)

    let state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    expect(state).toMatchObject({
      seq: 12,
      status: 'streaming',
      eventStreamFailureServed: 1,
      eventStreamRequests: [
        { sessionId: 'pi-e2e', cursor: 10 },
        { sessionId: 'pi-e2e', cursor: 12 },
      ],
    })
    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(state.messages.find((message) => message.id === 'a1')?.parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)

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
      const nextState = win.__piNativeE2EState()
      const emit = (frame: Record<string, unknown>) => {
        nextState.seq += 1
        win.__piNativeE2EEmit('pi-e2e', { ...frame, seq: nextState.seq })
      }
      const currentAssistant = nextState.messages.find((message) => message.id === 'a1')
      const preservedParts = currentAssistant?.parts.filter((part) => part.type !== 'text') ?? []

      emit({
        type: 'message-delta',
        messageId: 'a1',
        partId: 't-after-replay-gap',
        kind: 'text',
        delta: replayedFinalText,
      })
      emit({
        type: 'message-part-end',
        messageId: 'a1',
        partId: 't-after-replay-gap',
        kind: 'text',
        text: replayedFinalText,
      })

      const finalAssistant: BrowserMessage = {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [
          ...preservedParts,
          { type: 'text', id: 't-after-replay-gap', text: replayedFinalText },
        ],
      }
      nextState.messages = nextState.messages.map((message) => message.id === 'a1' ? finalAssistant : message)
      emit({ type: 'message-end', messageId: 'a1', final: finalAssistant })
      nextState.status = 'idle'
      emit({ type: 'agent-end', turnId: 'turn-after-replay-gap', status: 'ok' })
      localStorage.setItem(stateKey, JSON.stringify(nextState))

      return nextState.seq
    }, finalText)

    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(1)

    const domState = await readChatDomState(page)
    assertChatDomInvariants(domState)
    expect(domState.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(domState.messages.find((message) => message.id === 'a1')?.partOrder).toEqual([
      'message-reasoning',
      'message-tools',
      'message-text',
    ])

    state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    const assistant = state.messages.find((message) => message.id === 'a1')
    expect(state).toMatchObject({
      seq: finalSeq,
      status: 'idle',
      queue: { followUps: [] },
      eventStreamFailureServed: 1,
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

    await testInfo.attach('pi-native-browser-replay-gap-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('rehydrates from canonical /state after cursor_ahead and drops stale ahead-only text', async ({ page, backend }, testInfo) => {
    const staleText = 'STALE_CURSOR_AHEAD_TEXT_SHOULD_NOT_RENDER'
    const finalText = 'PI_NATIVE_FINAL_AFTER_CURSOR_AHEAD'

    await installPiNativeMock(page)
    await page.addInitScript(() => {
      const user = {
        id: 'u1',
        role: 'user',
        status: 'done',
        parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }],
      }
      const assistantAhead = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Ahead reasoning that must be replaced', state: 'done' },
          { type: 'text', id: 'ahead-text', text: 'STALE_CURSOR_AHEAD_TEXT_SHOULD_NOT_RENDER' },
        ],
      }
      const assistantCanonical = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Canonical reasoning after cursor ahead', state: 'done' },
          {
            type: 'tool-call',
            id: 'tool-1',
            toolName: 'bash',
            state: 'output-available',
            input: { command: 'printf redacted' },
            output: 'TOOL_OUTPUT_AFTER_CURSOR_AHEAD',
          },
        ],
      }

      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 30,
        status: 'streaming',
        messages: [user, assistantAhead],
        queue: { followUps: [] },
        prompts: [{ message: '<redacted>', clientNonce: 'seed' }],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
        eventStreamFailures: [
          {
            cursor: 30,
            type: 'cursor_ahead',
            latestSeq: 24,
            statePatch: {
              seq: 24,
              status: 'streaming',
              messages: [user, assistantCanonical],
              queue: { followUps: [] },
            },
          },
        ],
      }))
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const assistantMessages = page.locator('[data-boring-agent-part="message"][data-boring-agent-message-role="assistant"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first()).toHaveAttribute('data-boring-agent-message-id', 'a1')
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: staleText })).toHaveCount(0)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)

    let state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    expect(state).toMatchObject({
      seq: 24,
      status: 'streaming',
      eventStreamFailureServed: 1,
      eventStreamRequests: [
        { sessionId: 'pi-e2e', cursor: 30 },
        { sessionId: 'pi-e2e', cursor: 24 },
      ],
    })
    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(state.messages.find((message) => message.id === 'a1')?.parts.filter((part) => part.type === 'text')).toHaveLength(0)
    expect(state.messages.find((message) => message.id === 'a1')?.parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)

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
      const nextState = win.__piNativeE2EState()
      const emit = (frame: Record<string, unknown>) => {
        nextState.seq += 1
        win.__piNativeE2EEmit('pi-e2e', { ...frame, seq: nextState.seq })
      }
      const currentAssistant = nextState.messages.find((message) => message.id === 'a1')
      const preservedParts = currentAssistant?.parts.filter((part) => part.type !== 'text') ?? []

      emit({
        type: 'message-delta',
        messageId: 'a1',
        partId: 't-after-cursor-ahead',
        kind: 'text',
        delta: replayedFinalText,
      })
      emit({
        type: 'message-part-end',
        messageId: 'a1',
        partId: 't-after-cursor-ahead',
        kind: 'text',
        text: replayedFinalText,
      })

      const finalAssistant: BrowserMessage = {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [
          ...preservedParts,
          { type: 'text', id: 't-after-cursor-ahead', text: replayedFinalText },
        ],
      }
      nextState.messages = nextState.messages.map((message) => message.id === 'a1' ? finalAssistant : message)
      emit({ type: 'message-end', messageId: 'a1', final: finalAssistant })
      nextState.status = 'idle'
      emit({ type: 'agent-end', turnId: 'turn-after-cursor-ahead', status: 'ok' })
      localStorage.setItem(stateKey, JSON.stringify(nextState))

      return nextState.seq
    }, finalText)

    await expect(assistantMessages).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: staleText })).toHaveCount(0)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)

    const domState = await readChatDomState(page)
    assertChatDomInvariants(domState)
    expect(domState.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(domState.messages.find((message) => message.id === 'a1')?.partOrder).toEqual([
      'message-reasoning',
      'message-tools',
      'message-text',
    ])

    state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    const assistant = state.messages.find((message) => message.id === 'a1')
    expect(state).toMatchObject({
      seq: finalSeq,
      status: 'idle',
      queue: { followUps: [] },
      eventStreamFailureServed: 1,
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
    expect(assistant?.parts.some((part) => part.text === staleText)).toBe(false)
    expect(assistant?.parts.filter((part) => part.type === 'text' && part.text === finalText)).toHaveLength(1)
    expect(assistant?.parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)

    await testInfo.attach('pi-native-browser-cursor-ahead-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('survives replay_gap, cursor_ahead, and live seq gap before final text', async ({ page, backend }, testInfo) => {
    const staleText = 'STALE_MULTI_RESET_TEXT_SHOULD_NOT_RENDER'
    const finalText = 'PI_NATIVE_FINAL_AFTER_MULTI_RESET'

    await installPiNativeMock(page)
    await page.addInitScript(() => {
      const user = {
        id: 'u1',
        role: 'user',
        status: 'done',
        parts: [{ type: 'text', id: 'u1:t', text: '<redacted user prompt>' }],
      }
      const assistantAtEight = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Initial reasoning before reset churn', state: 'streaming' },
        ],
      }
      const assistantAfterReplayGap = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Replay-gap reasoning that should be replaced', state: 'done' },
          { type: 'text', id: 'stale-after-replay', text: 'STALE_MULTI_RESET_TEXT_SHOULD_NOT_RENDER' },
        ],
      }
      const assistantAfterCursorAhead = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Canonical reasoning before live gap', state: 'done' },
        ],
      }

      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 8,
        status: 'streaming',
        messages: [user, assistantAtEight],
        queue: { followUps: [] },
        prompts: [{ message: '<redacted>', clientNonce: 'seed' }],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
        eventStreamFailures: [
          {
            cursor: 8,
            type: 'replay_gap',
            latestSeq: 12,
            minReplaySeq: 9,
            statePatch: {
              seq: 12,
              status: 'streaming',
              messages: [user, assistantAfterReplayGap],
              queue: { followUps: [] },
            },
          },
          {
            cursor: 12,
            type: 'cursor_ahead',
            latestSeq: 11,
            statePatch: {
              seq: 11,
              status: 'streaming',
              messages: [user, assistantAfterCursorAhead],
              queue: { followUps: [] },
            },
          },
        ],
      }))
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const assistantMessages = page.locator('[data-boring-agent-part="message"][data-boring-agent-message-role="assistant"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e')
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: staleText })).toHaveCount(0)

    let state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    expect(state).toMatchObject({
      seq: 11,
      status: 'streaming',
      eventStreamFailureServed: 2,
      eventStreamRequests: [
        { sessionId: 'pi-e2e', cursor: 8 },
        { sessionId: 'pi-e2e', cursor: 12 },
        { sessionId: 'pi-e2e', cursor: 11 },
      ],
    })
    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(state.messages.find((message) => message.id === 'a1')?.parts.filter((part) => part.type === 'text')).toHaveLength(0)

    await page.evaluate(() => {
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
      const nextState = win.__piNativeE2EState()
      const user = nextState.messages.find((message) => message.id === 'u1')
      const assistantWithTool: BrowserMessage = {
        id: 'a1',
        role: 'assistant',
        status: 'streaming',
        parts: [
          { type: 'reasoning', id: 'r1', text: 'Canonical reasoning before live gap', state: 'done' },
          {
            type: 'tool-call',
            id: 'tool-1',
            toolName: 'bash',
            state: 'output-available',
            input: { command: 'printf redacted' },
            output: 'TOOL_OUTPUT_AFTER_MULTI_RESET',
          },
        ],
      }
      nextState.seq = 14
      nextState.status = 'streaming'
      nextState.messages = [user, assistantWithTool].filter((message): message is BrowserMessage => message !== undefined)
      localStorage.setItem(stateKey, JSON.stringify(nextState))
      win.__piNativeE2EEmit('pi-e2e', {
        type: 'tool-call',
        seq: 14,
        messageId: 'a1',
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: { command: 'printf redacted' },
      })
    })

    await expect.poll(async () => {
      const next = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
      return next.eventStreamRequests?.map((request) => request.cursor)
    }, {
      message: 'expected live seq gap to force /state rehydrate and reconnect at seq 14',
      timeout: 10_000,
    }).toEqual([8, 12, 11, 14])
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: staleText })).toHaveCount(0)

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
      const nextState = win.__piNativeE2EState()
      const emit = (frame: Record<string, unknown>) => {
        nextState.seq += 1
        win.__piNativeE2EEmit('pi-e2e', { ...frame, seq: nextState.seq })
      }
      const currentAssistant = nextState.messages.find((message) => message.id === 'a1')
      const preservedParts = currentAssistant?.parts.filter((part) => part.type !== 'text') ?? []

      emit({
        type: 'message-delta',
        messageId: 'a1',
        partId: 't-after-multi-reset',
        kind: 'text',
        delta: replayedFinalText,
      })
      emit({
        type: 'message-part-end',
        messageId: 'a1',
        partId: 't-after-multi-reset',
        kind: 'text',
        text: replayedFinalText,
      })

      const finalAssistant: BrowserMessage = {
        id: 'a1',
        role: 'assistant',
        status: 'done',
        parts: [
          ...preservedParts,
          { type: 'text', id: 't-after-multi-reset', text: replayedFinalText },
        ],
      }
      nextState.messages = nextState.messages.map((message) => message.id === 'a1' ? finalAssistant : message)
      emit({ type: 'message-end', messageId: 'a1', final: finalAssistant })
      nextState.status = 'idle'
      emit({ type: 'agent-end', turnId: 'turn-after-multi-reset', status: 'ok' })
      localStorage.setItem(stateKey, JSON.stringify(nextState))

      return nextState.seq
    }, finalText)

    await expect(assistantMessages).toHaveCount(1)
    await expect(assistantMessages.first().locator('[data-boring-agent-part="message-tools"]')).toHaveCount(1)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: staleText })).toHaveCount(0)
    await expect(conversation.locator('[data-boring-agent-part="message-text"]', { hasText: finalText })).toHaveCount(1)

    const domState = await readChatDomState(page)
    assertChatDomInvariants(domState)
    expect(domState.messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(domState.messages.find((message) => message.id === 'a1')?.partOrder).toEqual([
      'message-reasoning',
      'message-tools',
      'message-text',
    ])

    state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => unknown }).__piNativeE2EState()) as ReplayRangeState
    const assistant = state.messages.find((message) => message.id === 'a1')
    expect(state).toMatchObject({
      seq: finalSeq,
      status: 'idle',
      queue: { followUps: [] },
      eventStreamFailureServed: 2,
      eventStreamRequests: [
        { sessionId: 'pi-e2e', cursor: 8 },
        { sessionId: 'pi-e2e', cursor: 12 },
        { sessionId: 'pi-e2e', cursor: 11 },
        { sessionId: 'pi-e2e', cursor: 14 },
      ],
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
    expect(assistant?.parts.some((part) => part.text === staleText)).toBe(false)
    expect(assistant?.parts.filter((part) => part.type === 'text' && part.text === finalText)).toHaveLength(1)
    expect(assistant?.parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)

    await testInfo.attach('pi-native-browser-multi-reset-redacted-state.json', {
      body: Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})
