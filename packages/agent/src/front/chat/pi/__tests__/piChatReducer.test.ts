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

  it('normalizes assistant part order during /state hydration', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            parts: [
              { type: 'text', id: 'p1', text: 'done' },
              { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
              { type: 'reasoning', id: 'r1', text: 'thinking', state: 'done' },
            ],
          },
        ],
      }),
    })

    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
  })

  it('dedupes stale duplicate tool parts during /state hydration', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            parts: [
              { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'input-available' },
              { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
              { type: 'text', id: 'p1', text: 'done' },
            ],
          },
        ],
      }),
    })

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'tool-call')).toEqual([
      { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
    ])
  })

  it('coalesces split adjacent assistant snapshots during /state hydration', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'streaming',
            createdAt: '2026-06-06T10:00:00.000Z',
            turnId: 'turn-1',
            parts: [
              { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
            ],
          },
          {
            id: 'a-final',
            role: 'assistant',
            status: 'done',
            createdAt: '2026-06-06T10:00:05.000Z',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'p1', text: 'done' }],
          },
        ],
      }),
    })

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.id).toBe('a-final')
    expect(state.committedMessages[0]?.createdAt).toBe('2026-06-06T10:00:00.000Z')
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
  })

  it('preserves split adjacent snapshot text when final row reuses the same provider part id', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'p1', text: 'command' }],
          },
          {
            id: 'a-final',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'p1', text: 'command completed' }],
          },
        ],
      }),
    })

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command' },
      { type: 'text', id: 'p1', text: 'command completed' },
    ])
  })

  it('preserves terminal assistant status while coalescing adjacent snapshots during /state hydration', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'aborted',
            turnId: 'turn-1',
            parts: [
              { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'aborted' },
            ],
          },
          {
            id: 'a-final',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-1',
            parts: [
              { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'late success' } },
              { type: 'text', id: 'p1', text: 'done' },
            ],
          },
        ],
      }),
    })

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]).toMatchObject({ id: 'a-final', status: 'aborted' })
    expect(state.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'aborted' }))
    expect(state.committedMessages[0]?.parts).not.toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', output: { content: 'late success' } }))
  })

  it('does not coalesce adjacent assistant snapshots from different turns', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'p1', text: 'first' }],
          },
          {
            id: 'a2',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-2',
            parts: [{ type: 'text', id: 'p2', text: 'second' }],
          },
        ],
      }),
    })

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages.map((message) => message.id)).toEqual(['a1', 'a2'])
  })

  it('does not coalesce same-id assistant snapshots across explicit turn boundaries', () => {
    const state = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 42,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'p1', text: 'first' }],
          },
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-2',
            parts: [{ type: 'text', id: 'p2', text: 'second' }],
          },
        ],
      }),
    })

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages.map((message) => message.turnId)).toEqual(['turn-1', 'turn-2'])
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

  it('reconciles replayed user starts by client nonce instead of duplicating rows', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        messages: [userMessage('u-from-state', 'hello', 'nonce-1')],
      }),
    })

    const replayed = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'message-start',
        seq: 11,
        messageId: 'u-from-replay',
        role: 'user',
        text: 'hello',
        clientNonce: 'nonce-1',
      },
    })

    expect(replayed.committedMessages).toHaveLength(1)
    expect(replayed.committedMessages[0]).toMatchObject({
      id: 'u-from-replay',
      role: 'user',
      clientNonce: 'nonce-1',
    })
  })

  it('allows explicit cursor-ahead recovery to rewind to canonical /state', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 30,
        messages: [userMessage('u1', 'stale ahead'), assistantFinal('a1', 'stale ahead text')],
      }),
    })

    const recovered = piChatReducer(hydrated, {
      type: 'hydrate',
      allowSeqRewind: true,
      snapshot: snapshot({
        seq: 24,
        status: 'streaming',
        messages: [userMessage('u1', 'canonical')],
      }),
    })

    expect(recovered.lastSeq).toBe(24)
    expect(recovered.status).toBe('streaming')
    expect(recovered.committedMessages).toEqual([userMessage('u1', 'canonical')])
    expect(recovered.streamingMessage).toBeUndefined()
    expect(recovered.needsResync).toBeUndefined()
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
      { type: 'message-start', seq: 1, messageId: 'u1', role: 'user', clientNonce: 'n1', createdAt: '2026-06-06T10:00:00.000Z', text: 'hello' },
      { type: 'agent-start', seq: 2, turnId: 'turn-1' },
      { type: 'message-start', seq: 3, messageId: 'a1', role: 'assistant', createdAt: '2026-06-06T10:00:01.000Z' },
      { type: 'message-delta', seq: 4, messageId: 'a1', partId: '0', kind: 'reasoning', delta: 'thinking' },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: '1', kind: 'text', delta: 'Hel' },
      { type: 'message-delta', seq: 6, messageId: 'a1', partId: '1', kind: 'text', delta: 'lo' },
      { type: 'message-part-end', seq: 7, messageId: 'a1', partId: '1', kind: 'text', text: 'Hello' },
      { type: 'message-end', seq: 8, messageId: 'a1', final: assistantFinal('a1', 'Hello') },
    ])

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      clientNonce: 'n1',
      createdAt: '2026-06-06T10:00:00.000Z',
    })
    const assistant = state.committedMessages[1]
    expect(assistant).toMatchObject({ createdAt: '2026-06-06T10:00:01.000Z' })
    expect(assistant?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'Hello' }])
    expect(state.streamingMessage).toBeUndefined()
  })

  it('keeps the earliest user createdAt when a replayed message-start replaces a hydrated row', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 1,
        messages: [
          {
            id: 'u1',
            role: 'user',
            status: 'done',
            clientNonce: 'nonce-1',
            createdAt: '2026-06-06T10:00:00.000Z',
            parts: [{ type: 'text', id: 'u1:text:0', text: 'hello' }],
          },
        ],
      }),
    })

    const replayed = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'message-start',
        seq: 2,
        messageId: 'u1-replayed',
        role: 'user',
        clientNonce: 'nonce-1',
        createdAt: '2026-06-06T10:00:05.000Z',
        text: 'hello',
      },
    })

    expect(replayed.committedMessages).toHaveLength(1)
    expect(replayed.committedMessages[0]).toMatchObject({
      id: 'u1-replayed',
      clientNonce: 'nonce-1',
      createdAt: '2026-06-06T10:00:00.000Z',
    })
  })

  it('replaces live same-row text prefixes when the final text is consolidated under a new part id', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'a1:text:0', kind: 'text', delta: 'Hello' },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'Hello world') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', id: 'p1', text: 'Hello world' },
    ])
  })

  it('replaces hydrated same-row text prefixes when the final text arrives after reload', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 3,
        status: 'streaming',
        activeTurnId: 'turn-1',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-1',
            parts: [{ type: 'text', id: 'live', text: 'Hello' }],
          },
        ],
      }),
    })

    const state = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'Hello world') },
    })

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', id: 'p1', text: 'Hello world' },
    ])
  })

  it('ignores stale replayed text parts already covered by a terminal hydrated assistant row', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-1',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-1',
            parts: [
              { type: 'reasoning', id: 'r1', text: 'thoughts', state: 'done' },
              { type: 'text', id: 'final-text', text: 'PI_NATIVE_ASSISTANT_DONE' },
            ],
          },
        ],
      }),
    })

    const withDeltaReplay = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'message-delta', seq: 11, messageId: 'a1', partId: 'live-text', kind: 'text', delta: 'PI_NATIVE_ASSISTANT_DONE' },
    })
    const withPartEndReplay = piChatReducer(withDeltaReplay, {
      type: 'event',
      event: { type: 'message-part-end', seq: 12, messageId: 'a1', partId: 'live-text', kind: 'text', text: 'PI_NATIVE_ASSISTANT_DONE' },
    })

    expect(withPartEndReplay.committedMessages).toHaveLength(1)
    expect(withPartEndReplay.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', id: 'final-text', text: 'PI_NATIVE_ASSISTANT_DONE' },
    ])
  })

  it('routes live deltas to the hydrated active row when provider ids repeat', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 3,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-old',
            parts: [{ type: 'text', id: 'old-text', text: 'old answer' }],
          },
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-new',
            parts: [{ type: 'text', id: 'new-text', text: 'new' }],
          },
        ],
      }),
    })

    const state = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'message-delta', seq: 4, messageId: 'a-shared', partId: 'new-text', kind: 'text', delta: ' answer' },
    })

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'old-text', text: 'old answer' }])
    expect(state.committedMessages[1]?.parts).toEqual([{ type: 'text', id: 'new-text', text: 'new answer' }])
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
    expect(settled.streamingMessage).toBeUndefined()
    expect(settled.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ id: 'call-2', state: 'aborted' }))
    expect(settled.pendingToolCallIds.size).toBe(0)
  })

  it('merges tool-result UI metadata with existing call UI metadata', () => {
    const state = reduceEvents([
      { type: 'message-start', seq: 1, messageId: 'a1', role: 'assistant' },
      {
        type: 'tool-call',
        seq: 2,
        messageId: 'a1',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'pwd' },
        ui: { rendererId: 'shell-command', displayGroup: 'terminal', icon: 'terminal', details: { startedAt: 1 } },
      },
      {
        type: 'tool-result',
        seq: 3,
        messageId: 'a1',
        toolCallId: 'call-1',
        output: { content: 'ok' },
        ui: { details: { exitCode: 0 } },
      },
    ])

    expect(state.streamingMessage?.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        id: 'call-1',
        ui: { rendererId: 'shell-command', displayGroup: 'terminal', icon: 'terminal', details: { startedAt: 1, exitCode: 0 } },
      }),
    )
  })

  it('drops orphan tool results without materializing a phantom assistant row', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 1,
        status: 'idle',
        activeTurnId: undefined,
        messages: [userMessage('u1', 'hello')],
      }),
    })

    const state = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'tool-result',
        seq: 2,
        messageId: 'missing-assistant',
        toolCallId: 'missing-tool',
        output: { content: 'late orphan result' },
      },
    })

    expect(state.status).toBe('idle')
    expect(state.streamingMessage).toBeUndefined()
    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages).toEqual([userMessage('u1', 'hello')])
  })

  it('preserves live reasoning and tool state when final text arrives before the tool result', () => {
    const beforeResult = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r1', kind: 'reasoning', delta: 'thinking' },
      { type: 'tool-call', seq: 4, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: 't-live', kind: 'text', delta: 'done' },
      { type: 'message-end', seq: 6, messageId: 'a1', final: assistantFinal('a1', 'done') },
    ])

    expect(beforeResult.streamingMessage).toBeUndefined()
    expect(beforeResult.committedMessages).toHaveLength(1)
    expect(beforeResult.pendingToolCallIds).toEqual(new Set(['call-1']))

    const assistant = beforeResult.committedMessages[0]
    expect(assistant?.status).toBe('streaming')
    expect(assistant?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
    expect(assistant?.parts).toContainEqual(expect.objectContaining({ type: 'reasoning', id: 'r1', state: 'done' }))
    expect(assistant?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'input-available' }))
    expect(assistant?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'done' }])

    const withResult = piChatReducer(beforeResult, {
      type: 'event',
      event: { type: 'tool-result', seq: 7, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    })

    expect(withResult.pendingToolCallIds.size).toBe(0)
    expect(withResult.committedMessages).toHaveLength(1)
    expect(withResult.streamingMessage).toBeUndefined()
    expect(withResult.committedMessages[0]?.status).toBe('done')
    expect(withResult.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
    expect(withResult.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
    expect(withResult.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toHaveLength(1)
  })

  it('marks committed final-before-tool rows terminal when the turn aborts before result', () => {
    const beforeAbort = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'done') },
    ])

    const aborted = piChatReducer(beforeAbort, {
      type: 'event',
      event: { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'aborted' },
    })

    expect(aborted.pendingToolCallIds.size).toBe(0)
    expect(aborted.committedMessages[0]).toMatchObject({ id: 'a1', status: 'aborted' })
    expect(aborted.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'aborted' }))
  })

  it('does not let a delayed tool result overwrite an aborted tool', () => {
    const beforeAbort = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'done') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'aborted' },
    ])

    const withLateResult = piChatReducer(beforeAbort, {
      type: 'event',
      event: { type: 'tool-result', seq: 6, messageId: 'a1', toolCallId: 'call-1', output: { content: 'late success' } },
    })

    expect(withLateResult.pendingToolCallIds.size).toBe(0)
    expect(withLateResult.committedMessages[0]).toMatchObject({ id: 'a1', status: 'aborted' })
    expect(withLateResult.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'aborted' }))
    expect(withLateResult.committedMessages[0]?.parts).not.toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', output: { content: 'late success' } }))
  })

  it('does not let a delayed successful tool result overwrite a terminal error state', () => {
    const beforeLateResult = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'done') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'error' },
    ])

    const withLateResult = piChatReducer(beforeLateResult, {
      type: 'event',
      event: { type: 'tool-result', seq: 6, messageId: 'a1', toolCallId: 'call-1', output: { content: 'late success' } },
    })

    expect(withLateResult.pendingToolCallIds.size).toBe(0)
    expect(withLateResult.committedMessages[0]).toMatchObject({ id: 'a1', status: 'error' })
    expect(withLateResult.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-error' }))
    expect(withLateResult.committedMessages[0]?.parts).not.toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available' }))
  })

  it('does not let a late final message overwrite an aborted tool', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'done') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'aborted' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 6,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'late success' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(withLateFinal.committedMessages[0]).toMatchObject({ id: 'a1', status: 'aborted' })
    expect(withLateFinal.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'aborted' }))
    expect(withLateFinal.committedMessages[0]?.parts).not.toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', output: { content: 'late success' } }))
  })

  it('does not let a late final message overwrite a terminal error tool', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'done') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'error' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 6,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'late success' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(withLateFinal.committedMessages[0]).toMatchObject({ id: 'a1', status: 'error' })
    expect(withLateFinal.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-error' }))
    expect(withLateFinal.committedMessages[0]?.parts).not.toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available' }))
  })

  it('preserves terminal assistant status when a different-id late final coalesces with it', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a-tool', final: { id: 'a-tool', role: 'assistant', status: 'done', parts: [] } },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'aborted' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 6,
        messageId: 'a-final',
        final: {
          id: 'a-final',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'late success' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(withLateFinal.committedMessages).toHaveLength(1)
    expect(withLateFinal.committedMessages[0]).toMatchObject({ id: 'a-final', status: 'aborted' })
    expect(withLateFinal.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'aborted' }))
  })

  it('does not drop older same-id assistant history when a different-id late final coalesces', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'idle',
        activeTurnId: undefined,
        messages: [
          { ...assistantFinal('a-tool', 'old done'), turnId: 'turn-old' },
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } }],
          },
        ],
      }),
    })

    const withLateFinal = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 11,
        messageId: 'a-final',
        final: {
          id: 'a-final',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } },
            { type: 'text', id: 'p-new', text: 'new done' },
          ],
        },
      },
    })

    expect(withLateFinal.committedMessages.map((message) => [message.id, message.turnId])).toEqual([
      ['a-tool', 'turn-old'],
      ['a-final', 'turn-new'],
    ])
    expect(withLateFinal.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old done' }])
    expect(withLateFinal.committedMessages[1]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
  })

  it('uses the current same-turn row when a same-id final arrives after repeated provider ids', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          { ...assistantFinal('a-shared', 'old done'), turnId: 'turn-old' },
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } }],
          },
        ],
      }),
    })

    const withFinal = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 11,
        messageId: 'a-shared',
        final: {
          id: 'a-shared',
          role: 'assistant',
          status: 'done',
          turnId: 'turn-new',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } },
            { type: 'text', id: 'p-new', text: 'new done' },
          ],
        },
      },
    })

    expect(withFinal.committedMessages.map((message) => [message.id, message.turnId])).toEqual([
      ['a-shared', 'turn-old'],
      ['a-shared', 'turn-new'],
    ])
    expect(withFinal.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old done' }])
    expect(withFinal.committedMessages[1]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(withFinal.committedMessages[1]?.parts).not.toContainEqual({ type: 'text', id: 'p1', text: 'old done' })
  })

  it('attaches tool results by tool call id when assistant provider ids repeat', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          { ...assistantFinal('a-shared', 'old done'), turnId: 'turn-old' },
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-new', toolName: 'bash', input: { command: 'pwd' }, state: 'input-available' }],
          },
        ],
      }),
    })

    const withResult = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'tool-result', seq: 11, messageId: 'a-shared', toolCallId: 'call-new', output: { content: 'ok' } },
    })

    expect(withResult.pendingToolCallIds.size).toBe(0)
    expect(withResult.committedMessages.map((message) => [message.id, message.turnId, message.status])).toEqual([
      ['a-shared', 'turn-old', 'done'],
      ['a-shared', 'turn-new', 'done'],
    ])
    expect(withResult.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old done' }])
    expect(withResult.committedMessages[1]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-new', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('does not merge a delayed older same-id final with the latest assistant turn', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'a1:text', kind: 'text', delta: 'first' },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'first') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'ok' },
      { type: 'agent-start', seq: 6, turnId: 'turn-2' },
      { type: 'message-start', seq: 7, messageId: 'a2', role: 'assistant' },
      { type: 'message-delta', seq: 8, messageId: 'a2', partId: 'a2:text', kind: 'text', delta: 'second' },
      { type: 'message-end', seq: 9, messageId: 'a2', final: assistantFinal('a2', 'second') },
      { type: 'agent-end', seq: 10, turnId: 'turn-2', status: 'ok' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: { type: 'message-end', seq: 11, messageId: 'a1', final: assistantFinal('a1', 'first updated') },
    })

    expect(withLateFinal.committedMessages).toHaveLength(2)
    expect(withLateFinal.committedMessages.map((message) => message.id)).toEqual(['a1', 'a2'])
    expect(withLateFinal.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'first updated' }])
    expect(withLateFinal.committedMessages[1]?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'second' }])
  })

  it('does not clear a newer streaming assistant when a delayed older same-id final arrives', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'a1:text', kind: 'text', delta: 'first' },
      { type: 'message-end', seq: 4, messageId: 'a1', final: assistantFinal('a1', 'first') },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'ok' },
      { type: 'agent-start', seq: 6, turnId: 'turn-2' },
      { type: 'message-start', seq: 7, messageId: 'a2', role: 'assistant' },
      { type: 'message-delta', seq: 8, messageId: 'a2', partId: 'a2:text', kind: 'text', delta: 'second partial' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: { type: 'message-end', seq: 9, messageId: 'a1', final: assistantFinal('a1', 'first updated') },
    })

    expect(withLateFinal.committedMessages).toHaveLength(1)
    expect(withLateFinal.committedMessages[0]?.id).toBe('a1')
    expect(withLateFinal.streamingMessage).toMatchObject({ id: 'a2', role: 'assistant', status: 'streaming' })
    expect(withLateFinal.streamingMessage?.parts).toEqual([{ type: 'text', id: 'a2:text', text: 'second partial' }])
  })

  it('does not merge a no-turn late final into the active streaming assistant', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-old', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-old', partId: 'a-old:text', kind: 'text', delta: 'old partial' },
      { type: 'agent-start', seq: 4, turnId: 'turn-2' },
      { type: 'message-start', seq: 5, messageId: 'a-new', role: 'assistant' },
      { type: 'message-delta', seq: 6, messageId: 'a-new', partId: 'a-new:text', kind: 'text', delta: 'new partial' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: { type: 'message-end', seq: 7, messageId: 'a-old', final: assistantFinal('a-old', 'old final') },
    })

    expect(withLateFinal.streamingMessage).toMatchObject({ id: 'a-new', role: 'assistant', status: 'streaming' })
    expect(withLateFinal.streamingMessage?.parts).toEqual([{ type: 'text', id: 'a-new:text', text: 'new partial' }])
    expect(withLateFinal.committedMessages.map((message) => message.id)).toEqual(['a-old'])
  })

  it('does not clear same-id active streaming assistant when a no-turn older final targets committed history', () => {
    const beforeLateFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'a1:text', kind: 'text', delta: 'first' },
      { type: 'message-end', seq: 4, messageId: 'a1', final: { ...assistantFinal('a1', 'first'), turnId: 'turn-1' } },
      { type: 'agent-end', seq: 5, turnId: 'turn-1', status: 'ok' },
      { type: 'agent-start', seq: 6, turnId: 'turn-2' },
      { type: 'message-start', seq: 7, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 8, messageId: 'a1', partId: 'a1:new-text', kind: 'text', delta: 'second partial' },
    ])

    const withLateFinal = piChatReducer(beforeLateFinal, {
      type: 'event',
      event: { type: 'message-end', seq: 9, messageId: 'a1', final: assistantFinal('a1', 'first updated') },
    })

    expect(withLateFinal.committedMessages).toHaveLength(1)
    expect(withLateFinal.committedMessages[0]?.turnId).toBe('turn-1')
    expect(withLateFinal.streamingMessage).toMatchObject({ id: 'a1', turnId: 'turn-2', status: 'streaming' })
    expect(withLateFinal.streamingMessage?.parts).toEqual([{ type: 'text', id: 'a1:new-text', text: 'second partial' }])
  })

  it('does not merge a no-turn final into an unrelated active committed same-id row', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-old',
            parts: [{ type: 'text', id: 'old-text', text: 'old answer' }],
          },
          {
            id: 'a-shared',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-new', toolName: 'bash', state: 'input-available', input: { command: 'pwd' } }],
          },
        ],
      }),
    })

    const state = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'message-end', seq: 11, messageId: 'a-shared', final: assistantFinal('a-shared', 'old answer updated') },
    })

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]).toMatchObject({ id: 'a-shared', turnId: 'turn-old', status: 'done' })
    expect(state.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old answer updated' }])
    expect(state.committedMessages[1]).toMatchObject({ id: 'a-shared', turnId: 'turn-new', status: 'streaming' })
    expect(state.committedMessages[1]?.parts).toEqual([{ type: 'tool-call', id: 'call-new', toolName: 'bash', state: 'input-available', input: { command: 'pwd' } }])
  })

  it('coalesces live adjacent assistant final messages with different ids', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      { type: 'message-end', seq: 5, messageId: 'a-final', final: { ...assistantFinal('a-final', 'done'), turnId: 'turn-1' } },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.id).toBe('a-final')
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('attaches delayed tool results after coalescing a final assistant with a different id', () => {
    const beforeResult = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-end', seq: 4, messageId: 'a-final', final: { ...assistantFinal('a-final', 'done'), turnId: 'turn-1' } },
    ])

    const withResult = piChatReducer(beforeResult, {
      type: 'event',
      event: { type: 'tool-result', seq: 5, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
    })

    expect(withResult.committedMessages).toHaveLength(1)
    expect(withResult.committedMessages[0]?.id).toBe('a-final')
    expect(withResult.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
    expect(withResult.streamingMessage).toBeUndefined()
  })

  it('coalesces post-tool final text streams with the previous assistant tool row', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant', createdAt: '2026-06-06T10:00:00.000Z' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      {
        type: 'message-end',
        seq: 5,
        messageId: 'a-tool',
        final: {
          id: 'a-tool',
          role: 'assistant',
          status: 'done',
          parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } }],
        },
      },
      { type: 'message-start', seq: 6, messageId: 'a-final', role: 'assistant', createdAt: '2026-06-06T10:00:05.000Z' },
      { type: 'message-delta', seq: 7, messageId: 'a-final', partId: 't-live', kind: 'text', delta: 'done' },
      { type: 'message-end', seq: 8, messageId: 'a-final', final: assistantFinal('a-final', 'done') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.id).toBe('a-final')
    expect(state.committedMessages[0]?.createdAt).toBe('2026-06-06T10:00:00.000Z')
    expect(state.streamingMessage).toBeUndefined()
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('preserves an unended assistant tool row when final text starts under a new assistant id', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      { type: 'message-start', seq: 5, messageId: 'a-final', role: 'assistant' },
      { type: 'message-delta', seq: 6, messageId: 'a-final', partId: 't-live', kind: 'text', delta: 'done' },
      { type: 'message-end', seq: 7, messageId: 'a-final', final: assistantFinal('a-final', 'done') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.id).toBe('a-final')
    expect(state.streamingMessage).toBeUndefined()
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', input: { command: 'pwd' }, output: { content: 'ok' } }),
    )
  })

  it('coalesces same-turn split assistant rows while final text is still streaming', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant', createdAt: '2026-06-06T10:00:00.000Z' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      { type: 'message-start', seq: 5, messageId: 'a-final', role: 'assistant', createdAt: '2026-06-06T10:00:05.000Z' },
      { type: 'message-delta', seq: 6, messageId: 'a-final', partId: 't-live', kind: 'text', delta: 'done' },
    ])

    expect(state.committedMessages).toHaveLength(0)
    expect(state.streamingMessage).toMatchObject({ id: 'a-final', role: 'assistant', status: 'streaming' })
    expect(state.streamingMessage?.createdAt).toBe('2026-06-06T10:00:00.000Z')
    expect(state.streamingMessage?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(state.streamingMessage?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('backfills createdAt when message-start arrives after a streaming placeholder', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-delta', seq: 2, messageId: 'a1', partId: 'p1', kind: 'text', delta: 'Hello' },
      { type: 'message-start', seq: 3, messageId: 'a1', role: 'assistant', createdAt: '2026-06-06T10:00:00.000Z' },
    ])

    expect(state.streamingMessage).toMatchObject({
      id: 'a1',
      createdAt: '2026-06-06T10:00:00.000Z',
    })
  })

  it('coalesces a committed same-turn tool row when the final assistant starts streaming', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      {
        type: 'message-end',
        seq: 5,
        messageId: 'a-tool',
        final: {
          id: 'a-tool',
          role: 'assistant',
          status: 'done',
          turnId: 'turn-1',
          parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } }],
        },
      },
      { type: 'message-start', seq: 6, messageId: 'a-final', role: 'assistant' },
      { type: 'message-delta', seq: 7, messageId: 'a-final', partId: 't-live', kind: 'text', delta: 'done' },
    ])

    expect(state.committedMessages).toHaveLength(0)
    expect(state.streamingMessage).toMatchObject({ id: 'a-final', role: 'assistant', status: 'streaming', turnId: 'turn-1' })
    expect(state.streamingMessage?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
    expect(state.streamingMessage?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
    expect(state.streamingMessage?.parts).toContainEqual({ type: 'text', id: 't-live', text: 'done' })
  })

  it('does not remove older same-id assistant history while coalescing the current turn row', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          { ...assistantFinal('a-tool', 'old done'), turnId: 'turn-old' },
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } }],
          },
        ],
      }),
    })
    const withFinalStart = piChatReducer(hydrated, {
      type: 'event',
      event: { type: 'message-start', seq: 11, messageId: 'a-final', role: 'assistant' },
    })
    const state = piChatReducer(withFinalStart, {
      type: 'event',
      event: { type: 'message-delta', seq: 12, messageId: 'a-final', partId: 't-live', kind: 'text', delta: 'new done' },
    })

    expect(state.committedMessages.map((message) => [message.id, message.turnId])).toEqual([['a-tool', 'turn-old']])
    expect(state.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old done' }])
    expect(state.streamingMessage).toMatchObject({ id: 'a-final', turnId: 'turn-new', status: 'streaming' })
    expect(state.streamingMessage?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
  })

  it('preserves non-overlapping assistant text while coalescing split tool and final rows', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'a-tool:text', kind: 'text', delta: 'ran command' },
      { type: 'tool-call', seq: 4, messageId: 'a-tool', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 5, messageId: 'a-tool', toolCallId: 'call-1', output: { content: 'ok' } },
      { type: 'message-start', seq: 6, messageId: 'a-final', role: 'assistant' },
      { type: 'message-delta', seq: 7, messageId: 'a-final', partId: 'a-final:text', kind: 'text', delta: 'done' },
      { type: 'message-end', seq: 8, messageId: 'a-final', final: assistantFinal('a-final', 'done') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'ran command' },
      { type: 'text', id: 'p1', text: 'done' },
    ])
  })

  it('does not drop final text merely because it is a substring of earlier assistant text', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'a-tool:text', kind: 'text', delta: 'command completed' },
      { type: 'message-start', seq: 4, messageId: 'a-final', role: 'assistant' },
      { type: 'message-end', seq: 5, messageId: 'a-final', final: assistantFinal('a-final', 'completed') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command completed' },
      { type: 'text', id: 'p1', text: 'completed' },
    ])
  })

  it('does not drop earlier assistant text merely because it is a prefix of final text', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'a-tool:text', kind: 'text', delta: 'command' },
      { type: 'message-start', seq: 4, messageId: 'a-final', role: 'assistant' },
      { type: 'message-end', seq: 5, messageId: 'a-final', final: assistantFinal('a-final', 'command completed') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command' },
      { type: 'text', id: 'p1', text: 'command completed' },
    ])
  })

  it('preserves folded adjacent text when a final text part reuses the same id', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'p1', kind: 'text', delta: 'command' },
      { type: 'message-start', seq: 4, messageId: 'a-final', role: 'assistant' },
      { type: 'message-end', seq: 5, messageId: 'a-final', final: assistantFinal('a-final', 'command completed') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command' },
      { type: 'text', id: 'p1', text: 'command completed' },
    ])
  })

  it('does not let a reused streaming text id mutate folded adjacent text', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'p1', kind: 'text', delta: 'command' },
      { type: 'message-start', seq: 4, messageId: 'a-final', role: 'assistant' },
      { type: 'message-delta', seq: 5, messageId: 'a-final', partId: 'p1', kind: 'text', delta: ' completed' },
      { type: 'message-end', seq: 6, messageId: 'a-final', final: assistantFinal('a-final', 'command completed') },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command' },
      { type: 'text', id: 'p1', text: 'command completed' },
    ])
  })

  it('does not let arbitrary provider ids target folded adjacent text', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a-tool', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-tool', partId: 'p1:preserved-folded', kind: 'text', delta: 'command' },
      { type: 'message-start', seq: 4, messageId: 'a-final', role: 'assistant' },
      { type: 'message-delta', seq: 5, messageId: 'a-final', partId: 'p1:preserved-folded', kind: 'text', delta: ' completed' },
      {
        type: 'message-end',
        seq: 6,
        messageId: 'a-final',
        final: {
          id: 'a-final',
          role: 'assistant',
          status: 'done',
          parts: [{ type: 'text', id: 'p1:preserved-folded', text: 'command completed' }],
        },
      },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'command' },
      { type: 'text', id: 'p1:preserved-folded', text: 'command completed' },
    ])
  })

  it('does not fold stale streaming assistant rows without matching turn evidence', () => {
    const state = reduceEvents([
      { type: 'message-start', seq: 1, messageId: 'a-old', role: 'assistant' },
      { type: 'message-delta', seq: 2, messageId: 'a-old', partId: 'old-text', kind: 'text', delta: 'old partial' },
      { type: 'agent-start', seq: 3, turnId: 'turn-new' },
      { type: 'message-start', seq: 4, messageId: 'a-new', role: 'assistant' },
      { type: 'message-delta', seq: 5, messageId: 'a-new', partId: 'new-text', kind: 'text', delta: 'new partial' },
    ])

    expect(state.committedMessages).toEqual([])
    expect(state.streamingMessage).toMatchObject({ id: 'a-new', turnId: 'turn-new' })
    expect(state.streamingMessage?.parts).toEqual([{ type: 'text', id: 'new-text', text: 'new partial' }])
  })

  it('does not replace older same-id history while coalescing adjacent split-final rows', () => {
    const hydrated = piChatReducer(initial(), {
      type: 'hydrate',
      snapshot: snapshot({
        seq: 10,
        status: 'streaming',
        activeTurnId: 'turn-new',
        messages: [
          {
            id: 'a-final',
            role: 'assistant',
            status: 'done',
            turnId: 'turn-old',
            parts: [{ type: 'text', id: 'old-text', text: 'old answer' }],
          },
          {
            id: 'a-tool',
            role: 'assistant',
            status: 'streaming',
            turnId: 'turn-new',
            parts: [{ type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } }],
          },
        ],
      }),
    })

    const state = piChatReducer(hydrated, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 11,
        messageId: 'a-final',
        final: {
          id: 'a-final',
          role: 'assistant',
          status: 'done',
          turnId: 'turn-new',
          parts: [{ type: 'text', id: 'new-text', text: 'new answer' }],
        },
      },
    })

    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]).toMatchObject({ id: 'a-final', turnId: 'turn-old' })
    expect(state.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'old-text', text: 'old answer' }])
    expect(state.committedMessages[1]).toMatchObject({ id: 'a-final', turnId: 'turn-new', status: 'done' })
    expect(state.committedMessages[1]?.parts.map((part) => part.type)).toEqual(['tool-call', 'text'])
  })

  it('does not downgrade a settled tool when final text carries a stale request-only tool part', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    ])

    const finalized = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'input-available' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(finalized.pendingToolCallIds.size).toBe(0)
    expect(finalized.streamingMessage).toBeUndefined()
    expect(finalized.committedMessages).toHaveLength(1)
    expect(finalized.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )

    const ended = piChatReducer(finalized, {
      type: 'event',
      event: { type: 'agent-end', seq: 6, turnId: 'turn-1', status: 'ok' },
    })

    expect(ended.pendingToolCallIds.size).toBe(0)
    expect(ended.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('keeps live reasoning when a rewritten final reasoning part is shorter', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r-live', kind: 'reasoning', delta: 'complete live thought' },
      { type: 'tool-call', seq: 4, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: 't-live', kind: 'text', delta: 'done' },
      {
        type: 'message-end',
        seq: 6,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r-final', text: 'short', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages).toHaveLength(1)
    expect(state.pendingToolCallIds).toEqual(new Set(['call-1']))
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'reasoning', 'tool-call', 'text'])
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'reasoning', id: 'r-live', text: 'complete live thought', state: 'done' }),
    )
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'reasoning', id: 'r-final', text: 'short', state: 'done' }),
    )
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'input-available' }),
    )
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'done' }])
  })

  it('uses the fuller final reasoning when a live reasoning id is rewritten', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r-live', kind: 'reasoning', delta: 'partial thought' },
      {
        type: 'message-end',
        seq: 4,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r-final', text: 'partial thought completed', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'text'])
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r-final', text: 'partial thought completed', state: 'done' },
    ])
  })

  it('keeps fuller live reasoning when a same-id final reasoning part is shorter', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r1', kind: 'reasoning', delta: 'complete live thought' },
      {
        type: 'message-end',
        seq: 4,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r1', text: 'short', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r1', text: 'complete live thought', state: 'done' },
    ])
  })

  it('does not keep live reasoning fragments already covered by coalesced final reasoning', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r1', kind: 'reasoning', delta: 'first thought' },
      { type: 'message-delta', seq: 4, messageId: 'a1', partId: 'r2', kind: 'reasoning', delta: 'second thought' },
      {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r-final', text: 'first thought second thought', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'text'])
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r-final', text: 'first thought second thought', state: 'done' },
    ])
  })

  it('dedupes duplicate final reasoning ids to the fullest text', () => {
    const state = reduceEvents([
      {
        type: 'message-end',
        seq: 1,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r1', text: 'think', state: 'done' },
            { type: 'reasoning', id: 'r1', text: 'thinking more', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r1', text: 'thinking more', state: 'done' },
    ])
  })

  it('preserves distinct reasoning fragments when rewritten final reasoning does not overlap', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r-live', kind: 'reasoning', delta: 'first thought' },
      {
        type: 'message-end',
        seq: 4,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r-final', text: 'second thought', state: 'done' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r-live', text: 'first thought', state: 'done' },
      { type: 'reasoning', id: 'r-final', text: 'second thought', state: 'done' },
    ])
  })

  it('does not append duplicate final reasoning after text when reasoning ids differ but text matches', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r-live', kind: 'reasoning', delta: 'same thought' },
      { type: 'tool-call', seq: 4, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: 't-live', kind: 'text', delta: 'done' },
      {
        type: 'message-end',
        seq: 6,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'text', id: 'p1', text: 'done' },
            { type: 'reasoning', id: 'r-final', text: 'same thought', state: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'reasoning')).toEqual([
      { type: 'reasoning', id: 'r-final', text: 'same thought', state: 'done' },
    ])
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'text')).toEqual([{ type: 'text', id: 'p1', text: 'done' }])
  })

  it('keeps final-only reasoning before preserved tools and text', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
      { type: 'message-delta', seq: 5, messageId: 'a1', partId: 't-live', kind: 'text', delta: 'done' },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 6,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'reasoning', id: 'r-final', text: 'final thought', state: 'done' },
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'input-available' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('preserves settled tool output when a final tool part omits the result payload', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('preserves live tool input metadata when a final tool part is thinner', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      {
        type: 'tool-call',
        seq: 3,
        messageId: 'a1',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'pwd' },
        ui: { rendererId: 'shell-command', displayGroup: 'terminal', icon: 'terminal', details: { startedAt: 1 } },
      },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', ui: { details: { elapsedMs: 10, status: 'ok' } } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        id: 'call-1',
        input: { command: 'pwd' },
        output: { content: 'ok' },
        ui: { rendererId: 'shell-command', displayGroup: 'terminal', icon: 'terminal', details: { startedAt: 1, elapsedMs: 10, status: 'ok' } },
      }),
    )
  })

  it('preserves pending live tool input metadata when final tool output arrives thinner', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 4,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', input: { command: 'pwd' }, output: { content: 'ok' } }),
    )
  })

  it('preserves settled tool output when a final tool part carries a placeholder payload', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'real result' } },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: {} },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'real result' } }),
    )
  })

  it('uses a richer final tool payload when the live result only had a placeholder', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: {} },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'full result' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'full result' } }),
    )
  })

  it('preserves failed tool state when a final tool part reports stale success', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      {
        type: 'tool-result',
        seq: 4,
        messageId: 'a1',
        toolCallId: 'call-1',
        isError: true,
        errorText: 'failed',
        output: { content: 'error' },
      },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-error', errorText: 'failed', output: { content: 'error' } }),
    )
  })

  it('preserves successful tool state when a final tool part reports stale failure', () => {
    const beforeFinal = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'tool-call', seq: 3, messageId: 'a1', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'tool-result', seq: 4, messageId: 'a1', toolCallId: 'call-1', output: { content: 'ok' } },
    ])

    const state = piChatReducer(beforeFinal, {
      type: 'event',
      event: {
        type: 'message-end',
        seq: 5,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-error', errorText: 'stale failure' },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    })

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts).toContainEqual(
      expect.objectContaining({ type: 'tool-call', id: 'call-1', state: 'output-available', output: { content: 'ok' } }),
    )
  })

  it('normalizes final-only assistant part order', () => {
    const state = reduceEvents([
      {
        type: 'message-end',
        seq: 1,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'text', id: 'p1', text: 'done' },
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } },
            { type: 'reasoning', id: 'r1', text: 'thinking', state: 'done' },
          ],
        },
      },
    ])

    expect(state.committedMessages[0]?.parts.map((part) => part.type)).toEqual(['reasoning', 'tool-call', 'text'])
  })

  it('dedupes duplicate final tool ids during final-message merge', () => {
    const state = reduceEvents([
      {
        type: 'message-end',
        seq: 1,
        messageId: 'a1',
        final: {
          id: 'a1',
          role: 'assistant',
          status: 'done',
          parts: [
            { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'input-available' },
            { type: 'tool-call', id: 'call-1', toolName: 'bash', state: 'output-available', output: { content: 'ok' } },
            { type: 'text', id: 'p1', text: 'done' },
          ],
        },
      },
    ])

    expect(state.pendingToolCallIds.size).toBe(0)
    expect(state.committedMessages[0]?.parts.filter((part) => part.type === 'tool-call')).toEqual([
      { type: 'tool-call', id: 'call-1', toolName: 'bash', input: { command: 'pwd' }, state: 'output-available', output: { content: 'ok' } },
    ])
  })

  it('marks interrupted streaming assistant messages aborted even without pending tools', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-1' },
      { type: 'message-start', seq: 2, messageId: 'a1', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a1', partId: 'r1', kind: 'reasoning', delta: 'thinking' },
      { type: 'agent-end', seq: 4, turnId: 'turn-1', status: 'aborted' },
    ])

    expect(state.status).toBe('idle')
    expect(state.streamingMessage).toBeUndefined()
    expect(state.committedMessages).toHaveLength(1)
    expect(state.committedMessages[0]).toMatchObject({ id: 'a1', status: 'aborted' })
    expect(state.committedMessages[0]?.parts).toContainEqual(expect.objectContaining({ type: 'reasoning', id: 'r1', state: 'done' }))
    expect(state.pendingToolCallIds.size).toBe(0)
  })

  it('does not overwrite older repeated-id history when settling an aborted streaming row', () => {
    const state = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-old' },
      { type: 'message-start', seq: 2, messageId: 'a-shared', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-shared', partId: 'old-text', kind: 'text', delta: 'old answer' },
      { type: 'message-end', seq: 4, messageId: 'a-shared', final: { ...assistantFinal('a-shared', 'old answer'), turnId: 'turn-old' } },
      { type: 'agent-end', seq: 5, turnId: 'turn-old', status: 'ok' },
      { type: 'agent-start', seq: 6, turnId: 'turn-new' },
      { type: 'message-start', seq: 7, messageId: 'a-shared', role: 'assistant' },
      { type: 'message-delta', seq: 8, messageId: 'a-shared', partId: 'new-thought', kind: 'reasoning', delta: 'new partial' },
      { type: 'agent-end', seq: 9, turnId: 'turn-new', status: 'aborted' },
    ])

    expect(state.streamingMessage).toBeUndefined()
    expect(state.committedMessages).toHaveLength(2)
    expect(state.committedMessages[0]).toMatchObject({ id: 'a-shared', turnId: 'turn-old', status: 'done' })
    expect(state.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'p1', text: 'old answer' }])
    expect(state.committedMessages[1]).toMatchObject({ id: 'a-shared', turnId: 'turn-new', status: 'aborted' })
    expect(state.committedMessages[1]?.parts).toContainEqual(expect.objectContaining({ type: 'reasoning', id: 'new-thought', state: 'done' }))
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

  it('ignores stale turn-scoped errors and agent-end events while a newer turn is active', () => {
    const active = reduceEvents([
      { type: 'agent-start', seq: 1, turnId: 'turn-old' },
      { type: 'message-start', seq: 2, messageId: 'a-old', role: 'assistant' },
      { type: 'message-delta', seq: 3, messageId: 'a-old', partId: 'a-old:text', kind: 'text', delta: 'old partial' },
      { type: 'agent-start', seq: 4, turnId: 'turn-new' },
      { type: 'message-start', seq: 5, messageId: 'a-new', role: 'assistant' },
      { type: 'message-delta', seq: 6, messageId: 'a-new', partId: 'a-new:text', kind: 'text', delta: 'new partial' },
      {
        type: 'error',
        seq: 7,
        turnId: 'turn-old',
        retryable: false,
        error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'old failure', retryable: false },
      },
      { type: 'agent-end', seq: 8, turnId: 'turn-old', status: 'error' },
    ])

    expect(active.lastSeq).toBe(8)
    expect(active.status).toBe('streaming')
    expect(active.turnId).toBe('turn-new')
    expect(active.error).toBeUndefined()
    expect(active.streamingMessage).toMatchObject({ id: 'a-new', status: 'streaming' })
    expect(active.streamingMessage?.parts).toEqual([{ type: 'text', id: 'a-new:text', text: 'new partial' }])
    expect(active.notices).not.toContainEqual(expect.objectContaining({ text: 'old failure' }))

    const failed = piChatReducer(active, {
      type: 'event',
      event: {
        type: 'error',
        seq: 9,
        turnId: 'turn-new',
        retryable: false,
        error: { code: ErrorCode.enum.INTERNAL_ERROR, message: 'new failure', retryable: false },
      },
    })

    expect(failed.lastSeq).toBe(9)
    expect(failed.status).toBe('error')
    expect(failed.turnId).toBeUndefined()
    expect(failed.streamingMessage).toBeUndefined()
    expect(failed.committedMessages).toHaveLength(1)
    expect(failed.committedMessages[0]).toMatchObject({ id: 'a-new', role: 'assistant', status: 'error' })
    expect(failed.committedMessages[0]?.parts).toEqual([{ type: 'text', id: 'a-new:text', text: 'new partial' }])
    expect(failed.notices).toContainEqual(expect.objectContaining({ id: 'turn-error:turn-new', level: 'error', text: 'new failure' }))
    expect(failed.notices).not.toContainEqual(expect.objectContaining({ text: 'old failure' }))

    const lateOkEnd = piChatReducer(failed, {
      type: 'event',
      event: { type: 'agent-end', seq: 10, turnId: 'turn-new', status: 'ok' },
    })

    expect(lateOkEnd.lastSeq).toBe(10)
    expect(lateOkEnd.status).toBe('error')
    expect(lateOkEnd.error?.message).toBe('new failure')
    expect(lateOkEnd.committedMessages).toEqual(failed.committedMessages)
    expect(lateOkEnd.notices).toContainEqual(expect.objectContaining({ id: 'turn-error:turn-new', level: 'error', text: 'new failure' }))
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
