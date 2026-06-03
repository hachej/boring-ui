import type { PiChatEvent } from '../../shared/chat'

export const PI_CHAT_REPLAY_GAP = 'replay_gap'
export const PI_CHAT_CURSOR_AHEAD = 'cursor_ahead'

export type PiChatReplayRangeError =
  | { type: typeof PI_CHAT_REPLAY_GAP; latestSeq: number; minReplaySeq: number }
  | { type: typeof PI_CHAT_CURSOR_AHEAD; latestSeq: number; minReplaySeq: number }

export type PiChatReplayRangeResult =
  | { type: 'ok'; events: PiChatEvent[]; latestSeq: number; minReplaySeq: number }
  | PiChatReplayRangeError

export type PiChatReplaySubscriber = (event: PiChatEvent) => void

export type PiChatReplaySubscriptionResult =
  | { type: 'ok'; unsubscribe: () => void; replayed: PiChatEvent[]; latestSeq: number; minReplaySeq: number }
  | PiChatReplayRangeError

export interface PiChatReplayBufferOptions {
  maxEvents?: number
  initialLatestSeq?: number
}

export interface PiChatSubscribeOptions {
  /** Test seam for proving live subscriber registration happens before replay. */
  beforeReplay?: () => void
}

export class PiChatReplayBuffer {
  private readonly maxEvents: number
  private events: PiChatEvent[] = []
  private latest = 0
  private subscribers = new Set<PiChatReplaySubscriber>()

  constructor(options: PiChatReplayBufferOptions = {}) {
    this.maxEvents = Math.max(1, Math.floor(options.maxEvents ?? 1_000))
    this.latest = Math.max(0, Math.floor(options.initialLatestSeq ?? 0))
  }

  get latestSeq(): number {
    return this.latest
  }

  get minReplaySeq(): number {
    return this.events[0]?.seq ?? this.latest + 1
  }

  get size(): number {
    return this.events.length
  }

  publish(event: PiChatEvent): void {
    if (event.seq <= this.latest) {
      throw new Error(`Pi chat event seq must increase monotonically: latest=${this.latest} next=${event.seq}`)
    }

    this.latest = event.seq
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    for (const subscriber of this.subscribers) {
      subscriber(event)
    }
  }

  validateCursor(cursor: number): PiChatReplayRangeError | null {
    const normalizedCursor = Math.floor(cursor)
    if (!Number.isFinite(cursor) || normalizedCursor !== cursor || cursor < 0) {
      return { type: PI_CHAT_REPLAY_GAP, latestSeq: this.latest, minReplaySeq: this.minReplaySeq }
    }
    if (cursor > this.latest) {
      return { type: PI_CHAT_CURSOR_AHEAD, latestSeq: this.latest, minReplaySeq: this.minReplaySeq }
    }
    if (this.events.length === 0 && this.latest > 0 && cursor < this.latest) {
      return { type: PI_CHAT_REPLAY_GAP, latestSeq: this.latest, minReplaySeq: this.minReplaySeq }
    }
    if (this.events.length > 0 && cursor < this.minReplaySeq - 1) {
      return { type: PI_CHAT_REPLAY_GAP, latestSeq: this.latest, minReplaySeq: this.minReplaySeq }
    }
    return null
  }

  replay(cursor: number, upperSeq = this.latest): PiChatReplayRangeResult {
    const error = this.validateCursor(cursor)
    if (error) return error

    const events = this.events.filter((event) => event.seq > cursor && event.seq <= upperSeq)
    return { type: 'ok', events, latestSeq: this.latest, minReplaySeq: this.minReplaySeq }
  }

  subscribe(cursor: number, subscriber: PiChatReplaySubscriber, options: PiChatSubscribeOptions = {}): PiChatReplaySubscriptionResult {
    const error = this.validateCursor(cursor)
    if (error) return error

    const replayUpperBound = this.latest
    const pendingLiveEvents: PiChatEvent[] = []
    let replaying = true
    const liveSubscriber: PiChatReplaySubscriber = (event) => {
      if (replaying) {
        pendingLiveEvents.push(event)
        return
      }
      subscriber(event)
    }
    this.subscribers.add(liveSubscriber)
    let active = true
    const unsubscribe = () => {
      if (!active) return
      active = false
      this.subscribers.delete(liveSubscriber)
    }

    options.beforeReplay?.()

    const replay = this.replay(cursor, replayUpperBound)
    if (replay.type !== 'ok') {
      unsubscribe()
      return replay
    }

    for (const event of replay.events) {
      subscriber(event)
    }
    replaying = false
    for (const event of pendingLiveEvents) {
      subscriber(event)
    }

    return {
      type: 'ok',
      unsubscribe,
      replayed: replay.events,
      latestSeq: this.latest,
      minReplaySeq: this.minReplaySeq,
    }
  }

  clearSubscribers(): void {
    this.subscribers.clear()
  }
}
