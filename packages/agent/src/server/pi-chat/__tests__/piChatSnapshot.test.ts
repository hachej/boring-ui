import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import type { PiAgentSessionAdapter, PiAgentSessionSnapshot } from '../PiAgentSessionAdapter'
import { buildPiChatSnapshot } from '../piChatSnapshot'

function createAdapter(snapshot: Partial<PiAgentSessionSnapshot>): PiAgentSessionAdapter {
  const fullSnapshot: PiAgentSessionSnapshot = {
    state: {},
    messages: [],
    isStreaming: false,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 0,
    steeringMessages: [],
    followUpMessages: [],
    followUpMode: 'one-at-a-time',
    sessionId: 'pi-session-1',
    ...snapshot,
  }

  return {
    readSnapshot: () => fullSnapshot,
    subscribe: () => () => {},
    prompt: async () => {},
    followUp: async () => {},
    clearFollowUp: () => {},
    abort: async () => {},
  }
}

describe('buildPiChatSnapshot', () => {
  it('builds active /state-equivalent snapshot without browser transcript cache', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({
        sessionId: 'pi-active',
        isStreaming: true,
        pendingMessageCount: 2,
        followUpMessages: ['queued follow-up'],
        messages: [
          { id: 'entry-user', message: { role: 'user', content: 'start', timestamp: 1 } },
          { id: 'entry-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }], stopReason: 'stop', timestamp: 2 } },
        ],
      }),
      { seq: 42, activeTurnId: 'turn-active' },
    )

    expect(snapshot).toEqual({
      protocolVersion: 1,
      sessionId: 'pi-active',
      seq: 42,
      status: 'streaming',
      activeTurnId: 'turn-active',
      messages: [
        expect.objectContaining({ id: 'entry-user', role: 'user', piEntryId: 'entry-user' }),
        expect.objectContaining({ id: 'entry-assistant', role: 'assistant', piEntryId: 'entry-assistant' }),
      ],
      queue: {
        followUps: [
          {
            id: 'queue:pi-active:followup:0:1b93jre',
            kind: 'followup',
            displayText: 'queued follow-up',
          },
        ],
      },
      followUpMode: 'one-at-a-time',
      error: undefined,
    })
    expect(snapshot.messages.map((message) => message.turnId)).toEqual([undefined, undefined])
    expect(snapshot.messages[0]?.parts).toEqual([{ type: 'text', id: 'entry-user:text:0', text: 'start' }])
    expect(snapshot.messages[1]?.parts).toEqual([{ type: 'text', id: 'entry-assistant:text:0', text: 'working' }])
  })

  it('only applies active turn ids to live-mapped snapshot messages during in-flight reload', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({
        sessionId: 'pi-active',
        isStreaming: true,
        messages: [
          { id: 'old-user', message: { role: 'user', content: 'old prompt', timestamp: 1 } },
          { id: 'old-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'old answer' }], stopReason: 'stop', timestamp: 2 } },
          { id: 'active-user', message: { role: 'user', content: 'active prompt', timestamp: 3 } },
          { id: 'active-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }], timestamp: 4 } },
        ],
      }),
      {
        seq: 42,
        activeTurnId: 'turn-active',
        messageTurnIds: new Map([
          ['active-user', 'turn-active'],
          ['active-assistant', 'turn-active'],
        ]),
      },
    )

    expect(snapshot.messages.map((message) => [message.id, message.turnId])).toEqual([
      ['old-user', undefined],
      ['old-assistant', undefined],
      ['active-user', 'turn-active'],
      ['active-assistant', 'turn-active'],
    ])
  })

  it('pins followUpMode to one-at-a-time and derives stable queue preview ids', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({
        sessionId: 'pi-queue',
        followUpMode: 'all',
        followUpMessages: ['same text', 'same text'],
      }),
      { seq: 7 },
    )

    expect(snapshot.followUpMode).toBe('one-at-a-time')
    expect(snapshot.queue.followUps).toEqual([
      { id: 'queue:pi-queue:followup:0:c1n3xj', kind: 'followup', displayText: 'same text' },
      { id: 'queue:pi-queue:followup:1:c1n3xj', kind: 'followup', displayText: 'same text' },
    ])
  })

  it('can canonicalize linked native Pi snapshots to the browser-visible session id', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({
        sessionId: 'native-pi-session',
        followUpMessages: ['queued'],
      }),
      { seq: 1, sessionId: 'boring-session' },
    )

    expect(snapshot.sessionId).toBe('boring-session')
    expect(snapshot.queue.followUps[0]?.id).toContain('queue:boring-session:followup:0')
  })

  it('maps idle and error state without mutating canonical history', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({
        state: { errorMessage: 'provider failed' },
        messages: [{ id: 'entry-user', message: { role: 'user', content: 'hello' } }],
      }),
      { seq: 9 },
    )

    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toEqual({ code: ErrorCode.enum.INTERNAL_ERROR, message: 'provider failed', retryable: false })
    expect(snapshot.messages).toHaveLength(1)
  })

  it('allows explicit status and error supplied by PiSessionService to win', () => {
    const snapshot = buildPiChatSnapshot(
      createAdapter({ isStreaming: true, state: { errorMessage: 'ignored' } }),
      {
        seq: 10,
        status: 'aborting',
        error: { code: ErrorCode.enum.ABORTED, message: 'stopping', retryable: false },
      },
    )

    expect(snapshot.status).toBe('aborting')
    expect(snapshot.error).toEqual({ code: ErrorCode.enum.ABORTED, message: 'stopping', retryable: false })
  })
})
