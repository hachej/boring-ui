import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { PiChatEvent, PiChatSnapshot, PiChatStreamFrame } from '../../../../shared/chat'
import {
  buildPiChatEventsUrl,
  buildReloadReconnectPlan,
  calculateJitteredBackoffDelayMs,
  createPiChatFrameProcessor,
  parsePiChatNdjsonLine,
  parsePiChatReplayRangeError,
  PI_CHAT_CURSOR_AHEAD_CODE,
  PI_CHAT_REPLAY_GAP_CODE,
  readPiChatNdjsonStream,
  replayRangeErrorToRecovery,
  schedulePiChatReconnect,
} from '../piChatStream'

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function messageDelta(seq: number, delta = 'hi'): PiChatEvent {
  return {
    type: 'message-delta',
    seq,
    messageId: 'assistant-1',
    partId: 'text-1',
    kind: 'text',
    delta,
  }
}

function activeSnapshot(seq: number): PiChatSnapshot {
  return {
    protocolVersion: 1,
    sessionId: 'pi session/active',
    seq,
    status: 'streaming',
    activeTurnId: 'turn-1',
    messages: [
      {
        id: 'entry-user-1',
        role: 'user',
        status: 'done',
        parts: [{ type: 'text', text: 'hello' }],
        piEntryId: 'entry-user-1',
        turnId: 'turn-1',
      },
    ],
    queue: {
      followUps: [
        {
          id: 'queued-1',
          kind: 'followup',
          clientNonce: 'nonce-1',
          clientSeq: 1,
          displayText: 'next question',
        },
      ],
    },
    followUpMode: 'one-at-a-time',
  }
}

describe('parsePiChatNdjsonLine', () => {
  it('ignores blank lines, strips unknown fields, and rejects unknown event types', () => {
    expect(parsePiChatNdjsonLine('')).toEqual({ type: 'blank' })
    expect(parsePiChatNdjsonLine('   ')).toEqual({ type: 'blank' })

    expect(
      parsePiChatNdjsonLine(
        JSON.stringify({
          type: 'message-delta',
          seq: 1,
          messageId: 'assistant-1',
          partId: 'text-1',
          kind: 'text',
          delta: 'hello',
          futureField: 'ignored',
        }),
      ),
    ).toEqual({
      type: 'frame',
      frame: { type: 'message-delta', seq: 1, messageId: 'assistant-1', partId: 'text-1', kind: 'text', delta: 'hello' },
    })

    expect(parsePiChatNdjsonLine(JSON.stringify({ type: 'new-future-event', seq: 1 })).type).toBe('schema-error')
  })

  it('classifies malformed JSON and schema failures as protocol errors', () => {
    expect(parsePiChatNdjsonLine('{not json').type).toBe('malformed-json')
    expect(parsePiChatNdjsonLine(JSON.stringify({ type: 'message-delta', seq: 1, messageId: 'm1' })).type).toBe('schema-error')
  })
})

describe('readPiChatNdjsonStream', () => {
  it('handles split chunks, split UTF-8, blank lines, heartbeats, and malformed frames', async () => {
    const encoder = new TextEncoder()
    const encoded = encoder.encode(
      [
        JSON.stringify({ type: 'message-delta', seq: 1, messageId: 'assistant-1', partId: 'text-1', kind: 'text', delta: 'hé' }),
        '',
        JSON.stringify({ type: 'heartbeat', now: '2026-06-03T00:00:00.000Z' }),
        '{bad json',
        JSON.stringify({ type: 'message-delta', seq: 2, messageId: 'assistant-1', partId: 'text-1', kind: 'text', delta: 'llo' }),
      ].join('\n'),
    )
    const splitInsideUtf8 = Array.from(encoded).findIndex((byte) => byte === 0xc3) + 1
    const chunks = [encoded.slice(0, 17), encoded.slice(17, splitInsideUtf8), encoded.slice(splitInsideUtf8, splitInsideUtf8 + 1), encoded.slice(splitInsideUtf8 + 1)]
    const frames: PiChatStreamFrame[] = []
    const errors: string[] = []

    await readPiChatNdjsonStream(streamFromChunks(chunks), {
      onFrame: (frame) => frames.push(frame),
      onProtocolError: (error) => errors.push(error.type),
    })

    expect(frames).toEqual([
      { type: 'message-delta', seq: 1, messageId: 'assistant-1', partId: 'text-1', kind: 'text', delta: 'hé' },
      { type: 'heartbeat', now: '2026-06-03T00:00:00.000Z' },
      { type: 'message-delta', seq: 2, messageId: 'assistant-1', partId: 'text-1', kind: 'text', delta: 'llo' },
    ])
    expect(errors).toEqual(['malformed-json'])
  })
})

describe('createPiChatFrameProcessor', () => {
  it('applies next seq events, ignores stale/duplicate events, and reports gaps without mutating lastSeq', () => {
    const applied: PiChatEvent[] = []
    const stale: number[] = []
    const gaps: Array<{ expectedSeq: number; actualSeq: number }> = []
    const processor = createPiChatFrameProcessor(10, {
      onEvent: (event) => applied.push(event),
      onStaleEvent: (result) => stale.push(result.event.seq),
      onSeqGap: (result) => gaps.push({ expectedSeq: result.expectedSeq, actualSeq: result.actualSeq }),
    })

    expect(processor.handle(messageDelta(10))).toMatchObject({ type: 'stale' })
    expect(processor.handle(messageDelta(11))).toMatchObject({ type: 'applied', lastSeq: 11 })
    expect(processor.handle(messageDelta(13))).toMatchObject({ type: 'gap', expectedSeq: 12, actualSeq: 13 })

    expect(applied.map((event) => event.seq)).toEqual([11])
    expect(stale).toEqual([10])
    expect(gaps).toEqual([{ expectedSeq: 12, actualSeq: 13 }])
    expect(processor.getLastSeq()).toBe(11)
  })

  it('treats heartbeats as liveness only and does not notify message subscribers or advance seq', () => {
    const onEvent = vi.fn()
    const onHeartbeat = vi.fn()
    const processor = createPiChatFrameProcessor(5, { onEvent, onHeartbeat })

    expect(processor.handle({ type: 'heartbeat', now: '2026-06-03T00:00:00.000Z' })).toEqual({ type: 'heartbeat' })

    expect(onHeartbeat).toHaveBeenCalledWith({ type: 'heartbeat', now: '2026-06-03T00:00:00.000Z' })
    expect(onEvent).not.toHaveBeenCalled()
    expect(processor.getLastSeq()).toBe(5)
  })
})

describe('replay/gap recovery helpers', () => {
  it('maps replay_gap and cursor_ahead 409 responses to /state rehydrate recovery', () => {
    const gap = parsePiChatReplayRangeError(409, { error: { code: PI_CHAT_REPLAY_GAP_CODE, message: 'too old', details: { latestSeq: 42 } } })
    const ahead = parsePiChatReplayRangeError(409, { error: { code: PI_CHAT_CURSOR_AHEAD_CODE, message: 'ahead', latestSeq: 43 } })

    expect(gap).toEqual({ type: 'replay_gap', latestSeq: 42 })
    expect(ahead).toEqual({ type: 'cursor_ahead', latestSeq: 43 })
    expect(gap && replayRangeErrorToRecovery(gap)).toEqual({ action: 'rehydrate-state', reason: 'replay_gap', latestSeq: 42 })
    expect(ahead && replayRangeErrorToRecovery(ahead)).toEqual({ action: 'rehydrate-state', reason: 'cursor_ahead', latestSeq: 43 })

    expect(parsePiChatReplayRangeError(416, { error: { code: ErrorCode.enum.CURSOR_OUT_OF_RANGE, details: { latestSeq: 44 } } })).toBeNull()
  })

  it('builds active-reload reconnect URLs from /state seq without browser transcript cache', () => {
    const snapshot = activeSnapshot(37)

    expect(buildReloadReconnectPlan(snapshot, 'https://boring.test/')).toEqual({
      sessionId: 'pi session/active',
      cursor: 37,
      eventsUrl: 'https://boring.test/api/v1/agent/pi-chat/pi%20session%2Factive/events?cursor=37',
    })
    expect(buildPiChatEventsUrl({ sessionId: snapshot.sessionId, cursor: snapshot.seq })).toBe(
      '/api/v1/agent/pi-chat/pi%20session%2Factive/events?cursor=37',
    )
  })
})

describe('calculateJitteredBackoffDelayMs', () => {
  it('uses deterministic jittered exponential backoff with a max cap', () => {
    expect(calculateJitteredBackoffDelayMs({ attempt: 0, random: () => 0, jitterRatio: 0.25 })).toBe(750)
    expect(calculateJitteredBackoffDelayMs({ attempt: 1, random: () => 0.5, jitterRatio: 0.25 })).toBe(2_000)
    expect(calculateJitteredBackoffDelayMs({ attempt: 2, random: () => 1, jitterRatio: 0.25 })).toBe(5_000)
    expect(calculateJitteredBackoffDelayMs({ attempt: 10, random: () => 1, jitterRatio: 0.25 })).toBe(30_000)
  })

  it('schedules reconnects through injectable timers for deterministic fake-timer tests', () => {
    vi.useFakeTimers()
    try {
      const reconnect = vi.fn()
      const scheduled = schedulePiChatReconnect({ attempt: 1, reconnect, random: () => 0.5, jitterRatio: 0.25 })

      expect(scheduled.delayMs).toBe(2_000)
      vi.advanceTimersByTime(1_999)
      expect(reconnect).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(reconnect).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
