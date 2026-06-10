import { describe, expect, it } from 'vitest'
import type { PiChatEvent } from '../../../shared/chat'
import { PiChatReplayBuffer, PI_CHAT_CURSOR_AHEAD, PI_CHAT_REPLAY_GAP } from '../piChatReplayBuffer'

function event(seq: number, type: PiChatEvent['type'] = 'agent-start'): PiChatEvent {
  if (type === 'agent-start') return { type, seq, turnId: `turn-${seq}` }
  return { type: 'agent-end', seq, turnId: `turn-${seq}`, status: 'ok' }
}

describe('PiChatReplayBuffer', () => {
  it('keeps bounded session-scoped replay storage and evicts old events', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 3 })
    for (let seq = 1; seq <= 5; seq += 1) buffer.publish(event(seq))

    expect(buffer.size).toBe(3)
    expect(buffer.latestSeq).toBe(5)
    expect(buffer.minReplaySeq).toBe(3)
    expect(buffer.replay(2)).toMatchObject({ type: 'ok', events: [{ seq: 3 }, { seq: 4 }, { seq: 5 }] })
  })

  it('returns replay_gap when cursor is outside the retained range', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 2 })
    for (let seq = 1; seq <= 5; seq += 1) buffer.publish(event(seq))

    expect(buffer.replay(2)).toEqual({ type: PI_CHAT_REPLAY_GAP, latestSeq: 5, minReplaySeq: 4 })
    expect(buffer.replay(3)).toMatchObject({ type: 'ok', events: [{ seq: 4 }, { seq: 5 }] })
  })

  it('returns cursor_ahead when browser cursor is newer than the server', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 5, initialLatestSeq: 2 })

    expect(buffer.replay(3)).toEqual({ type: PI_CHAT_CURSOR_AHEAD, latestSeq: 2, minReplaySeq: 3 })
  })

  it('returns replay_gap when latest seq exists but no events are retained', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 5, initialLatestSeq: 2 })

    expect(buffer.replay(0)).toEqual({ type: PI_CHAT_REPLAY_GAP, latestSeq: 2, minReplaySeq: 3 })
    expect(buffer.replay(2)).toMatchObject({ type: 'ok', events: [] })
  })

  it('replays only events with seq greater than the cursor', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 5 })
    for (let seq = 1; seq <= 4; seq += 1) buffer.publish(event(seq))

    expect(buffer.replay(0)).toMatchObject({ type: 'ok', events: [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }] })
    expect(buffer.replay(2)).toMatchObject({ type: 'ok', events: [{ seq: 3 }, { seq: 4 }] })
    expect(buffer.replay(4)).toMatchObject({ type: 'ok', events: [] })
  })

  it('registers live subscribers before replay without duplicating setup-time events', () => {
    const buffer = new PiChatReplayBuffer({ maxEvents: 10 })
    buffer.publish(event(1))
    buffer.publish(event(2))
    const seen: PiChatEvent[] = []

    const subscription = buffer.subscribe(0, (next) => seen.push(next), {
      beforeReplay() {
        buffer.publish(event(3))
      },
    })

    expect(subscription.type).toBe('ok')
    expect(seen.map((item) => item.seq)).toEqual([1, 2, 3])

    buffer.publish(event(4))
    expect(seen.map((item) => item.seq)).toEqual([1, 2, 3, 4])

    if (subscription.type === 'ok') subscription.unsubscribe()
    buffer.publish(event(5))
    expect(seen.map((item) => item.seq)).toEqual([1, 2, 3, 4])
  })

  it('rejects non-monotonic event publication', () => {
    const buffer = new PiChatReplayBuffer()
    buffer.publish(event(1))

    expect(() => buffer.publish(event(1))).toThrow(/increase monotonically/)
  })
})
