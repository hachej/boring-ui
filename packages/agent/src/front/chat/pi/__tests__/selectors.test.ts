import { describe, expect, it, vi } from 'vitest'
import { createInitialPiChatState, piChatReducer, type OptimisticUserMessage, type PiChatState } from '../piChatReducer'
import { selectMessagesForRender, selectQueuePreview, selectRuntimeNotices } from '../selectors'
import { createPiChatStore } from '../piChatStore'

function optimistic(clientNonce: string, options: { clientSeq?: number; createdAt?: string; text?: string; afterMessageId?: string } = {}): OptimisticUserMessage {
  return {
    id: `optimistic:${clientNonce}`,
    role: 'user',
    status: 'pending',
    clientNonce,
    clientSeq: options.clientSeq,
    createdAt: options.createdAt,
    afterMessageId: options.afterMessageId,
    parts: [{ type: 'text', text: options.text ?? 'pending' }],
  }
}

describe('Pi chat selectors and store', () => {
  it('uses messagesForRender as the single timeline merge point', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'hydrate',
      snapshot: {
        protocolVersion: 1,
        sessionId: 's1',
        seq: 1,
        status: 'streaming',
        activeTurnId: 'turn-1',
        messages: [{ id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', text: 'hello' }] }],
        queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'queued' }] },
        followUpMode: 'one-at-a-time',
      },
    })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1') })
    state = piChatReducer(state, { type: 'event', event: { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' } })

    expect(selectMessagesForRender(state).map((message) => message.id)).toEqual(['u1', 'optimistic:nonce-1', 'a1'])
    expect(selectQueuePreview(state)).toEqual([{ id: 'q1', kind: 'followup', displayText: 'queued' }])
  })

  it('keeps optimistic queued follow-ups in the composer queue preview, not the transcript', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'hydrate',
      snapshot: {
        protocolVersion: 1,
        sessionId: 's1',
        seq: 1,
        status: 'streaming',
        activeTurnId: 'turn-1',
        messages: [{ id: 'u1', role: 'user', status: 'done', parts: [{ type: 'text', text: 'hello' }] }],
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      },
    })
    state = piChatReducer(state, { type: 'event', event: { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' } })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-queued', { clientSeq: 1 }) })

    expect(selectMessagesForRender(state).map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(selectQueuePreview(state)).toEqual([
      {
        id: 'optimistic:nonce-queued',
        kind: 'followup',
        displayText: 'pending',
        clientNonce: 'nonce-queued',
        clientSeq: 1,
      },
    ])
  })

  it('keeps unmatched optimistic prompts before later canonical rows', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'hydrate',
      snapshot: {
        protocolVersion: 1,
        sessionId: 's1',
        seq: 3,
        status: 'idle',
        messages: [
          {
            id: 'u1',
            role: 'user',
            status: 'done',
            createdAt: '2026-06-06T10:00:00.000Z',
            parts: [{ type: 'text', id: 'u1:text', text: 'first prompt' }],
          },
          {
            id: 'u2',
            role: 'user',
            status: 'done',
            createdAt: '2026-06-06T10:00:02.000Z',
            parts: [{ type: 'text', id: 'u2:text', text: 'queued follow-up' }],
          },
          {
            id: 'a2',
            role: 'assistant',
            status: 'done',
            createdAt: '2026-06-06T10:00:03.000Z',
            parts: [{ type: 'text', id: 'a2:text', text: 'done' }],
          },
        ],
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      },
    })
    // The orphan placeholder was submitted right after u1 (its anchor), before
    // u2/a2 arrived; it renders at that position regardless of clock skew.
    state = piChatReducer(state, {
      type: 'optimistic-user-message',
      message: optimistic('nonce-earlier-prompt', {
        createdAt: '2026-06-06T10:00:01.000Z',
        text: 'earlier optimistic prompt',
        afterMessageId: 'u1',
      }),
    })

    expect(selectMessagesForRender(state).map((message) => message.id)).toEqual([
      'u1',
      'optimistic:nonce-earlier-prompt',
      'u2',
      'a2',
    ])
  })

  it('keeps a just-sent prompt below the previous reply despite client/server clock skew', () => {
    // Reproduces the live reorder: the previous reply (a1) carries a server
    // timestamp slightly ahead of the client clock, so the optimistic prompt's
    // createdAt is "earlier" than a1. Anchoring by submit position (after a1)
    // keeps it at the bottom; createdAt ordering would float it above a1.
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'hydrate',
      snapshot: {
        protocolVersion: 1,
        sessionId: 's1',
        seq: 2,
        status: 'idle',
        messages: [
          { id: 'u1', role: 'user', status: 'done', createdAt: '2026-06-09T10:00:00.000Z', parts: [{ type: 'text', id: 'u1:t', text: 'hi' }] },
          { id: 'a1', role: 'assistant', status: 'done', createdAt: '2026-06-09T10:00:06.000Z', parts: [{ type: 'text', id: 'a1:t', text: 'answer' }] },
        ],
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      },
    })
    // Submitted "now" but the client clock trails the server's a1 timestamp.
    state = piChatReducer(state, {
      type: 'optimistic-user-message',
      message: optimistic('nonce-new', { createdAt: '2026-06-09T10:00:05.000Z', text: 'new prompt' }),
    })

    expect(selectMessagesForRender(state).map((message) => message.id)).toEqual(['u1', 'a1', 'optimistic:nonce-new'])
  })

  it('folds same-turn committed and streaming assistant rows before render', () => {
    const state: PiChatState = {
      ...createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' }),
      status: 'streaming',
      turnId: 'turn-3',
      hydrated: true,
      committedMessages: [
        {
          id: 'u3',
          role: 'user',
          status: 'done',
          createdAt: '2026-06-06T10:00:00.000Z',
          turnId: 'turn-3',
          parts: [{ type: 'text', id: 'u3:text', text: 'preserve history' }],
        },
        {
          id: 'a3',
          role: 'assistant',
          status: 'done',
          createdAt: '2026-06-06T10:00:01.000Z',
          turnId: 'turn-3',
          parts: [{ type: 'reasoning', id: 'a3:reasoning', text: 'thoughts', state: 'done' }],
        },
      ],
      streamingMessage: {
        id: 'a3-live',
        role: 'assistant',
        status: 'streaming',
        createdAt: '2026-06-06T10:00:02.000Z',
        turnId: 'turn-3',
        parts: [{ type: 'text', id: 'a3-live:text', text: 'final answer' }],
      },
    }

    const rendered = selectMessagesForRender(state)

    expect(rendered.map((message) => message.id)).toEqual(['u3', 'a3-live'])
    expect(rendered[1]).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      createdAt: '2026-06-06T10:00:01.000Z',
      turnId: 'turn-3',
    })
    expect(rendered[1]?.parts).toEqual([
      { type: 'reasoning', id: 'a3:reasoning', text: 'thoughts', state: 'done' },
      { type: 'text', id: 'a3-live:text', text: 'final answer' },
    ])
  })

  it('does not fold same-turn assistant replies across a queued user turn', () => {
    // Pi drains a queued follow-up inside the same agent turn, so the follow-up's
    // reply shares the previous reply's turnId with the queued user message
    // between them. They must render as separate replies in order — not merged
    // into the earlier reply (which would push the queued prompt out of order).
    const state: PiChatState = {
      ...createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' }),
      status: 'idle',
      hydrated: true,
      turnId: 'turn-x',
      committedMessages: [
        { id: 'u1', role: 'user', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'u1:t', text: 'count to 3' }] },
        { id: 'a1', role: 'assistant', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'a1:t', text: '1 2 3' }] },
        { id: 'u2', role: 'user', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'u2:t', text: 'say BANANA' }] },
        { id: 'a2', role: 'assistant', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'a2:t', text: 'BANANA' }] },
      ],
    }

    const rendered = selectMessagesForRender(state)
    expect(rendered.map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(rendered.map((message) => (message.parts[0] as { text?: string }).text)).toEqual([
      'count to 3', '1 2 3', 'say BANANA', 'BANANA',
    ])
  })

  it('still folds a same-turn streaming reply that follows the queued reply', () => {
    // The queued follow-up's own streaming chunks (same turn, no user between)
    // should still coalesce into its reply.
    const state: PiChatState = {
      ...createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' }),
      status: 'streaming',
      hydrated: true,
      turnId: 'turn-x',
      committedMessages: [
        { id: 'u1', role: 'user', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'u1:t', text: 'count' }] },
        { id: 'a1', role: 'assistant', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'a1:t', text: '1 2 3' }] },
        { id: 'u2', role: 'user', status: 'done', turnId: 'turn-x', parts: [{ type: 'text', id: 'u2:t', text: 'say BANANA' }] },
        { id: 'a2', role: 'assistant', status: 'streaming', turnId: 'turn-x', parts: [{ type: 'text', id: 'a2:t', text: 'BAN' }] },
      ],
      streamingMessage: { id: 'a2', role: 'assistant', status: 'streaming', turnId: 'turn-x', parts: [{ type: 'text', id: 'a2:t', text: 'BANANA' }] },
    }

    expect(selectMessagesForRender(state).map((message) => message.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('keeps repeated assistant ids separate across different turns', () => {
    const state: PiChatState = {
      ...createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' }),
      status: 'idle',
      hydrated: true,
      committedMessages: [
        {
          id: 'a-shared',
          role: 'assistant',
          status: 'done',
          turnId: 'turn-old',
          parts: [{ type: 'text', id: 'a-shared:old', text: 'old answer' }],
        },
        {
          id: 'a-shared',
          role: 'assistant',
          status: 'done',
          turnId: 'turn-new',
          parts: [{ type: 'text', id: 'a-shared:new', text: 'new answer' }],
        },
      ],
    }

    expect(selectMessagesForRender(state).map((message) => [message.id, message.turnId])).toEqual([
      ['a-shared', 'turn-old'],
      ['a-shared', 'turn-new'],
    ])
  })

  it('derives runtime notices from connection/retry/error state without assistant messages', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'connection-state', state: 'reconnecting' })
    state = piChatReducer(state, {
      type: 'event',
      event: { type: 'auto-retry-start', seq: 1, attempt: 2, maxAttempts: 3, delayMs: 2000, errorMessage: 'retry' },
    })

    expect(selectRuntimeNotices(state).map((notice) => notice.id)).toEqual(['connection-reconnecting', 'auto-retry'])
    expect(selectMessagesForRender(state)).toEqual([])
  })

  it('hides background reconnect notices while an idle chat has no pending work', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope', status: 'idle' })
    state = piChatReducer(state, { type: 'connection-state', state: 'reconnecting' })

    expect(selectRuntimeNotices(state).map((notice) => notice.id)).toEqual([])

    state = piChatReducer(state, {
      type: 'optimistic-user-message',
      message: {
        id: 'optimistic:nonce-1',
        role: 'user',
        status: 'pending',
        clientNonce: 'nonce-1',
        createdAt: '2026-06-15T00:00:00.000Z',
        parts: [{ type: 'text', id: 'optimistic:nonce-1:text', text: 'hello' }],
      },
    })

    expect(selectRuntimeNotices(state).map((notice) => notice.id)).toEqual(['connection-reconnecting'])
  })

  it('coalesces high-frequency delta notifications while reducer seq advances immediately', () => {
    const notify = vi.fn()
    const scheduled: Array<() => void> = []
    const store = createPiChatStore(createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' }), {
      scheduleNotify(callback) {
        scheduled.push(callback)
        return scheduled.length - 1
      },
      cancelNotify() {},
    })
    store.subscribe(notify)

    store.dispatch({ type: 'event', event: { type: 'message-start', seq: 1, messageId: 'a1', role: 'assistant' } })
    store.dispatch({ type: 'event', event: { type: 'message-delta', seq: 2, messageId: 'a1', partId: 'p1', kind: 'text', delta: 'A' } })
    store.dispatch({ type: 'event', event: { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'p1', kind: 'text', delta: 'B' } })

    expect(store.getState().lastSeq).toBe(3)
    expect(scheduled).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()

    scheduled[0]?.()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(selectMessagesForRender(store.getState())[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'AB' }])
  })
})
