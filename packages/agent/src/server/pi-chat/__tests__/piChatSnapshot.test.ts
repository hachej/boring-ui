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
    clearQueue: () => ({ steering: [], followUp: [] }),
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
        expect.objectContaining({ id: 'entry-user', role: 'user', piEntryId: 'entry-user', turnId: 'turn-active' }),
        expect.objectContaining({ id: 'entry-assistant', role: 'assistant', piEntryId: 'entry-assistant', turnId: 'turn-active' }),
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
    expect(snapshot.messages[0]?.parts).toEqual([{ type: 'text', id: 'entry-user:text:0', text: 'start' }])
    expect(snapshot.messages[1]?.parts).toEqual([{ type: 'text', id: 'entry-assistant:text:0', text: 'working' }])
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
