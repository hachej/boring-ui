import { describe, expect, it } from 'vitest'
import { createInitialPiChatState, piChatReducer, type OptimisticUserMessage } from '../piChatReducer'
import { selectQueuePreview } from '../selectors'

function optimistic(clientNonce: string, text: string, clientSeq?: number): OptimisticUserMessage {
  return {
    id: `optimistic:${clientNonce}`,
    role: 'user',
    status: 'pending',
    clientNonce,
    clientSeq,
    parts: [{ type: 'text', text }],
  }
}

describe('piChatReducer queue behavior', () => {
  it('applies queue updates only in monotonic seq order', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-1', clientSeq: 1, displayText: 'first' }] },
      },
    })
    const afterFirst = state

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'duplicate', kind: 'followup', clientNonce: 'nonce-dup', clientSeq: 1, displayText: 'duplicate' }] },
      },
    })
    expect(state).toBe(afterFirst)

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 3,
        queue: { followUps: [{ id: 'gap', kind: 'followup', clientNonce: 'nonce-gap', clientSeq: 3, displayText: 'gap' }] },
      },
    })
    expect(state.queue.followUps).toEqual([{ id: 'q1', kind: 'followup', clientNonce: 'nonce-1', clientSeq: 1, displayText: 'first' }])
    expect(state.needsResync).toEqual({ expectedSeq: 2, actualSeq: 3, lastSeq: 1 })
  })

  it('reconciles queued follow-ups by nonce/seq metadata', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'same text', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-2', 'same text', 2) })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q2', kind: 'followup', clientNonce: 'nonce-2', clientSeq: 2, displayText: 'same text' }] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['nonce-1'])
    expect(state.queue.followUps).toEqual([{ id: 'q2', kind: 'followup', clientNonce: 'nonce-2', clientSeq: 2, displayText: 'same text' }])
  })

  it('does not fall back to duplicate text when queued follow-ups include clientSeq', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'same text', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-2', 'same text', 2) })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q2', kind: 'followup', clientSeq: 2, displayText: 'same text' }] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['nonce-1'])
  })

  it('reconciles metadata-free queue snapshots against optimistic follow-ups without clearing prompts', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('prompt-nonce', 'same text') })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('followup-nonce', 'same text', 1) })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'same text' }] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['prompt-nonce'])
    expect(state.queue.followUps).toEqual([{ id: 'q1', kind: 'followup', clientNonce: 'followup-nonce', clientSeq: 1, displayText: 'same text' }])

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 2,
        queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'same text' }] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['prompt-nonce'])
    expect(state.queue.followUps).toEqual([{ id: 'q1', kind: 'followup', clientNonce: 'followup-nonce', clientSeq: 1, displayText: 'same text' }])
  })

  it('does not text-reconcile ambiguous metadata-free duplicate follow-ups', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'same text', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-2', 'same text', 2) })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q1', kind: 'followup', displayText: 'same text' }] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['nonce-1', 'nonce-2'])
    expect(state.queue.followUps).toEqual([{ id: 'q1', kind: 'followup', displayText: 'same text' }])
  })

  it('preserves optimistic follow-ups across empty queue updates until stronger server evidence arrives', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('prompt-nonce', 'prompt') })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('followup-nonce', 'follow up', 1) })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [] },
      },
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['prompt-nonce', 'followup-nonce'])
    expect(state.queue.followUps).toEqual([])

    state = piChatReducer(state, {
      type: 'clear-optimistic-followups',
      clientNonce: 'followup-nonce',
      clientSeq: 1,
    })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['prompt-nonce'])
  })

  it('removes an optimistic placeholder when Pi consumes the follow-up', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'next', 1) })
    state = piChatReducer(state, {
      type: 'event',
      event: { type: 'followup-consumed', seq: 1, clientNonce: 'nonce-1', clientSeq: 1, messageId: 'u2' },
    })

    expect(state.optimisticOutbox).toEqual({})
  })

  it('removes the optimistic follow-up when Pi consumes it without a queue confirmation or client selector', () => {
    // Race: the agent consumes a queued follow-up before the server's
    // queue-updated (which carries the clientNonce) is processed, and the
    // consumed user message-start echoes no clientNonce/clientSeq. The optimistic
    // placeholder must still be cleared by text so it does not linger as a ghost
    // / reordered entry in the live queue preview (refresh already shows it gone).
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'next', 1) })
    // Consumed user turn starts WITHOUT clientNonce/clientSeq and with no prior
    // queue-updated confirming the follow-up (real server behavior under the race).
    state = piChatReducer(state, {
      type: 'event',
      event: { type: 'message-start', seq: 1, messageId: 'u2', role: 'user', text: 'next' },
    })

    expect(state.optimisticOutbox).toEqual({})
    expect(selectQueuePreview(state)).toEqual([])
    expect(state.committedMessages).toEqual([
      expect.objectContaining({ id: 'u2', role: 'user' }),
    ])
  })

  it('does not resurrect a consumed follow-up behind still-pending ones in the live preview', () => {
    // Reproduces the user-visible reorder: the user queues A then B. The agent
    // consumes A before A is confirmed in a queue-updated; A's message-start
    // carries no client selector. A naive projection keeps A's optimistic and
    // re-appends the (already sent) A behind the still-pending B — showing [B, A]
    // until a refresh. The preview must stay [B].
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-a', 'A', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-b', 'B', 2) })
    // Only B reaches the server queue snapshot; A was already pulled for consumption.
    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'qb', kind: 'followup', clientNonce: 'nonce-b', clientSeq: 2, displayText: 'B' }] },
      },
    })
    // A's consumed user turn starts without a client selector.
    state = piChatReducer(state, {
      type: 'event',
      event: { type: 'message-start', seq: 2, messageId: 'uA', role: 'user', text: 'A' },
    })

    expect(selectQueuePreview(state).map((followUp) => followUp.displayText)).toEqual(['B'])
    // nonce-b was cleared on queue confirmation, nonce-a on consumption.
    expect(Object.keys(state.optimisticOutbox)).toEqual([])
  })

  it('removes a queued follow-up from preview when the queued user turn starts', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'next', 1) })
    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'queue-updated',
        seq: 1,
        queue: { followUps: [{ id: 'q1', kind: 'followup', clientNonce: 'nonce-1', clientSeq: 1, displayText: 'next' }] },
      },
    })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'message-start',
        seq: 2,
        messageId: 'u2',
        role: 'user',
        text: 'next',
        clientNonce: 'nonce-1',
        clientSeq: 1,
      },
    })

    expect(state.queue.followUps).toEqual([])
    expect(state.optimisticOutbox).toEqual({})
    expect(state.committedMessages).toEqual([
      expect.objectContaining({ id: 'u2', clientNonce: 'nonce-1', clientSeq: 1 }),
    ])
  })

  it('clears all optimistic follow-ups after an accepted full queue clear without dropping prompts', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('prompt-nonce', 'prompt') })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('followup-1', 'first', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('followup-2', 'second', 2) })
    state = {
      ...state,
      queue: {
        followUps: [
          { id: 'q1', kind: 'followup', clientNonce: 'followup-1', clientSeq: 1, displayText: 'first' },
          { id: 'q2', kind: 'followup', clientNonce: 'followup-2', clientSeq: 2, displayText: 'second' },
        ],
      },
    }

    state = piChatReducer(state, { type: 'clear-optimistic-followups' })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['prompt-nonce'])
    expect(state.queue.followUps).toEqual([])
  })

  it('uses clientNonce before clientSeq when clearing a selected queued follow-up', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-a', 'first tab', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-b', 'second tab', 1) })
    state = {
      ...state,
      queue: {
        followUps: [
          { id: 'q-a', kind: 'followup', clientNonce: 'nonce-a', clientSeq: 1, displayText: 'first tab' },
          { id: 'q-b', kind: 'followup', clientNonce: 'nonce-b', clientSeq: 1, displayText: 'second tab' },
        ],
      },
    }

    state = piChatReducer(state, { type: 'clear-optimistic-followups', clientNonce: 'nonce-a', clientSeq: 1 })

    expect(Object.keys(state.optimisticOutbox)).toEqual(['nonce-b'])
    expect(state.queue.followUps).toEqual([{ id: 'q-b', kind: 'followup', clientNonce: 'nonce-b', clientSeq: 1, displayText: 'second tab' }])
  })

  it('preserves user selectors when a final message replaces the message-start row', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'message-start',
        seq: 1,
        messageId: 'u1',
        role: 'user',
        text: 'next',
        clientNonce: 'nonce-1',
        clientSeq: 1,
      },
    })

    state = piChatReducer(state, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 2,
        messageId: 'u1',
        final: {
          id: 'u1',
          role: 'user',
          status: 'done',
          parts: [{ type: 'text', id: 'u1:text:0', text: 'next' }],
        },
      },
    })

    expect(state.committedMessages).toEqual([
      expect.objectContaining({ id: 'u1', clientNonce: 'nonce-1', clientSeq: 1 }),
    ])
  })

  it('hydrates accepted queue after active reload and clears browser-only stale outbox with notice', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('accepted', 'server has this', 1) })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('stale', 'server lost this', 2) })

    state = piChatReducer(state, {
      type: 'hydrate',
      snapshot: {
        protocolVersion: 1,
        sessionId: 's1',
        seq: 20,
        status: 'streaming',
        activeTurnId: 'turn-1',
        messages: [],
        queue: { followUps: [{ id: 'q-accepted', kind: 'followup', clientNonce: 'accepted', clientSeq: 1, displayText: 'server has this' }] },
        followUpMode: 'one-at-a-time',
      },
    })

    expect(state.queue.followUps).toHaveLength(1)
    expect(state.optimisticOutbox).toEqual({})
    expect(state.notices).toContainEqual(expect.objectContaining({ id: 'stale-outbox-cleared' }))
  })
})
