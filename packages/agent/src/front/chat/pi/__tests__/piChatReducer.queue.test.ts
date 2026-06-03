import { describe, expect, it } from 'vitest'
import { createInitialPiChatState, piChatReducer, type OptimisticUserMessage } from '../piChatReducer'

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
  it('reconciles queued follow-ups by nonce/seq metadata, never by text equality', () => {
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

  it('removes an optimistic placeholder when Pi consumes the follow-up', () => {
    let state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
    state = piChatReducer(state, { type: 'optimistic-user-message', message: optimistic('nonce-1', 'next', 1) })
    state = piChatReducer(state, {
      type: 'event',
      event: { type: 'followup-consumed', seq: 1, clientNonce: 'nonce-1', clientSeq: 1, messageId: 'u2' },
    })

    expect(state.optimisticOutbox).toEqual({})
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
