import { describe, expect, it, vi } from 'vitest'
import { createInitialPiChatState, piChatReducer, type OptimisticUserMessage } from '../piChatReducer'
import { selectMessagesForRender, selectQueuePreview, selectRuntimeNotices } from '../selectors'
import { createPiChatStore } from '../piChatStore'

function optimistic(clientNonce: string): OptimisticUserMessage {
  return {
    id: `optimistic:${clientNonce}`,
    role: 'user',
    status: 'pending',
    clientNonce,
    parts: [{ type: 'text', text: 'pending' }],
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
