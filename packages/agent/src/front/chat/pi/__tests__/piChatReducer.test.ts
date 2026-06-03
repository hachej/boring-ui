import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { BoringChatMessage, PiChatEvent, PiChatSnapshot } from '../../../../shared/chat'
import { createInitialPiChatState, piChatReducer, type OptimisticUserMessage } from '../piChatReducer'

function initial() {
  return createInitialPiChatState({ sessionId: 's1', storageScope: 'scope' })
}

function snapshot(overrides: Partial<PiChatSnapshot> = {}): PiChatSnapshot {
  return {
    protocolVersion: 1,
    sessionId: 's1',
    seq: 10,
    status: 'streaming',
    activeTurnId: 'turn-1',
    messages: [userMessage('u1', 'hello')],
    queue: { followUps: [] },
    followUpMode: 'one-at-a-time',
    ...overrides,
  }
}

function userMessage(id: string, text: string, clientNonce?: string): BoringChatMessage {
  return { id, role: 'user', status: 'done', clientNonce, parts: [{ type: 'text', id: `${id}:text`, text }] }
}

function assistantFinal(id: string, text: string): BoringChatMessage {
  return { id, role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'p1', text }] }
}

function reduceEvents(events: PiChatEvent[]) {
  return events.reduce((state, event) => piChatReducer(state, { type: 'event', event }), initial())
}

describe('piChatReducer', () => {
  it('hydrates active-turn /state for reload without relying on browser transcript cache', () => {
    const optimistic: OptimisticUserMessage = {
      id: 'optimistic-stale',
      role: 'user',
      status: 'pending',
      clientNonce: 'stale-nonce',
      parts: [{ type: 'text', text: 'lost browser-only message' }],
    }
    const before = piChatReducer(initial(), { type: 'optimistic-user-message', message: optimistic })

    const state = piChatReducer(before, {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'streaming',
        activeTurnId: 'turn-active',
        messages: [userMessage('u1', 'committed')],
        queue: {
          followUps: [{ id: 'q1', kind: 'followup', clientNonce: 'queued-nonce', clientSeq: 1, displayText: 'queued' }],
        },
      }),
    })

    expect(state).toMatchObject({
      sessionId: 's1',
      status: 'streaming',
      turnId: 'turn-active',
      lastSeq: 42,
      hydrated: true,
      queue: { followUps: [{ displayText: 'queued' }] },
    })
    expect(state.committedMessages).toEqual([userMessage('u1', 'committed')])
    expect(state.optimisticOutbox).toEqual({})
    expect(state.notices).toContainEqual(expect.objectContaining({ id: 'stale-outbox-cleared', level: 'warning' }))
  })

  it('ignores stale /state hydration after newer events have applied', () => {
    const hydrated = piChatReducer(initial(), { type: 'hydrate', snapshot: snapshot({ seq: 5, messages: [userMessage('u1', 'old')] }) })
    const advanced = piChatReducer(hydrated, { type: 'event', event: { type: 'agent-start', seq: 6, turnId: 'new-turn' } })

    const staleHydration = piChatReducer(advanced, {
      type: 'hydrate',
      snapshot: snapshot({ seq: 4, messages: [userMessage('stale', 'stale')], status: 'idle', activeTurnId: undefined }),
    })

    expect(staleHydration).toBe(advanced)
    expect(staleHydration.lastSeq).toBe(6)
    expect(staleHydration.turnId).toBe('new-turn')
    expect(staleHydration.committedMessages).toEqual([userMessage('u1', 'old')])
  })

  it('ignores stale /state hydration even before first successful hydrate', () => {
    const advanced = piChatReducer(initial(), { type: 'event', event: { type: 'agent-start', seq: 1, turnId: 'live-turn' } })

    const staleHydration = piChatReducer(advanced, {
      type: 'hydrate',
      snapshot: snapshot({ seq: 0, messages: [], status: 'idle', activeTurnId: undefined }),
    })

    expect(staleHydration).toBe(advanced)
    expect(staleHydration.lastSeq).toBe(1)
    expect(staleHydration.turnId).toBe('live-turn')
    expect(staleHydration.status).toBe('streaming')
  })

  it('ignores stale events and marks seq gaps for /state resync without partial mutation', () => {
    const state = piChatReducer(initial(), { type: 'hydrate', snapshot: snapshot({ seq: 5, messages: [] }) })
    const stale = piChatReducer(state, { type: 'event', event: { type: 'agent-start', seq: 5, turnId: 'old' } })
    expect(stale).toBe(state)

    const gap = piChatReducer(state, { type: 'event', event: { type: 'agent-start', seq: 7, turnId: 'new' } })
    expect(gap.turnId).toBe('turn-1')
    expect(gap.lastSeq).toBe(5)
    expect(gap.needsResync).toEqual({ expectedSeq: 6, actualSeq: 7, lastSeq: 5 })
    expect(gap.connection.state).toBe('reconnecting')
  })

  it('projects user to assistant text/reasoning without duplicate final text for non-zero part ids', () => {
    const state = reduceEvents([
      { type: 'message-start', seq: 1, messageId: 'u1', role: 'user', clientNonce: 'n1', text: 'hello' },
      { type: 'agent-start', seq: 2, turnId: 'turn-1' },
      { type: 'message-start', seq: 3, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 4, messageId: 'a1', partId: '0', kind: 'reasoning', delta: 'thinking' },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: '1', kind: 'text', delta: 'Hel' },
      { type: 'message-delta', seq: 6, messageId: 'a1', partId: '1', kind: 'text', delta: 'lo' },
      { type: 'message-part-end', seq: 7, messageId: 'a1', partId: '1', kind: 'text', text: 'Hello' },
      { type: 'message-end', seq: 8, messageId: 'a1', final: assistantFinal('a1', 'Hello') },
    ])

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]).toMatchObject({ id: 'u1', role: 'user', clientNonce: 'n1' })
    const assistant = state.committedMessages[1]
    expect(assistant?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'Hello' }])
    expect(state.streamingMessage).toBeUndefined()
  })

  it('attaches tool results to the owning assistant message and settles unresolved tools on abort', () => {
    const withResult = reduceEvents([
      { type: 'message-start', seq: 1, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 2, messageId: 'a1', toolCallId: 'call-1', toolName: 'read', input: { path: 'README.md' } },
      { type: 'tool-result', seq: 3, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    ])
    expect(withResult.streamingMessage?.parts).toEqual([
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    ])
    expect(withResult.pendingToolCallIds.size).toBe(0)

    const aborted = piChatReducer(withResult, { type: 'event', event: { type: 'tool-call', seq: 4, messageId: 'a1', toolCallId: 'call-2', toolName: 'bash', input: {} } })
    const settled = piChatReducer(aborted, { type: 'event', event: { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'aborted' } })
    expect(settled.streamingMessage?.parts).toContainEqual(expect.objectContaining({ id: 'call-2', state: 'aborted' }))
    expect(settled.pendingToolCallIds.size).toBe(0)
  })

  it('keeps transport/errors as runtime state instead of assistant messages', () => {
    const state = piChatReducer(initial(), {
      type: 'event',
      event: {
        type: 'error',
        seq: 1,
        turnId: 'turn-1',
        error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'boom', retryable: false },
      },
    })

    expect(state.status).toBe('error')
    expect(state.error?.message).toBe('boom')
    expect(state.committedMessages).toEqual([])
    expect(state.notices).toContainEqual(expect.objectContaining({ level: 'error', text: 'boom' }))
  })

  it('tracks simple auto-retry notices without mutating transcript history', () => {
    const retrying = piChatReducer(initial(), {
      type: 'event',
      event: { type: 'auto-retry-start', seq: 1, attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: 'rate limited' },
    })
    expect(retrying.retryNotice).toMatchObject({ attempt: 1, maxAttempts: 3 })
    expect(retrying.committedMessages).toEqual([])

    const failed = piChatReducer(retrying, {
      type: 'event',
      event: { type: 'auto-retry-end', seq: 2, success: false, attempt: 1, finalError: 'still failing' },
    })
    expect(failed.retryNotice).toBeUndefined()
    expect(failed.notices).toContainEqual(expect.objectContaining({ id: 'auto-retry-failed', text: 'still failing' }))
  })
})
