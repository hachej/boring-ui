import { randomUUID } from 'node:crypto'
import type {
  WorkspaceChangeEvent,
  WorkspaceWatchControlEvent,
  WorkspaceWatcher,
} from './workspaceTypes'

/**
 * Wraps a `WorkspaceWatcher` with two reliability primitives:
 *
 *   1. `seq` — monotonically increasing per-workspace sequence
 *      number. Becomes the SSE `id:` line so the browser
 *      EventSource auto-sends `Last-Event-ID` on reconnect.
 *
 *   2. `eventId` — opaque per-event UUID. Lets clients dedupe in
 *      case the same event slips through twice (e.g. replay-then-
 *      live-fan-out race), and lets logs join client/server views
 *      of the same change.
 *
 * Plus a small ring buffer for `Last-Event-ID` replay. If a client
 * reconnects with a `lastSeenSeq` older than the buffer head, the
 * broadcaster signals `resync-required` so the client drops its
 * caches instead of trying to fill the gap.
 *
 * Single broadcaster per workspace, fanned out to every SSE
 * connection. Codex's "one watcher per workspace, not per SSE
 * client" rule applies one level up; this layer just adds the
 * reliability envelope.
 */

export interface FsEventEnvelope {
  /** Monotonic, per-workspace. Survives reconnects via Last-Event-ID. */
  seq: number
  /** Opaque per-event ID. Stable across replay; used for client dedupe. */
  eventId: string
  /** Server-side timestamp (ms since epoch). */
  ts: number
  /** The underlying file change. */
  change: WorkspaceChangeEvent
}

export interface FsSubscribeResult {
  /** Backlog to replay before live events resume. Empty if no replay needed. */
  replay: FsEventEnvelope[]
  /**
   * True when the requested `lastSeenSeq` is older than the buffer
   * head, meaning we cannot safely fill the gap. The caller MUST
   * tell the client to resync (drop caches and refetch on demand).
   */
  resyncRequired: boolean
  unsubscribe: () => void
}

export interface FsEventBroadcaster {
  /**
   * Subscribe to live events. If `lastSeenSeq` is provided, returns a
   * replay slice followed by a live fan-out — the caller is responsible
   * for delivering the replay first, in order, then forwarding live
   * events to the same client.
   *
   * Live events are NOT buffered while the replay is being delivered:
   * the route should drain `replay` synchronously before unblocking
   * the next listener invocation. In practice that's a tight loop, so
   * any race window is sub-millisecond.
   */
  subscribe(
    listener: (env: FsEventEnvelope) => void,
    opts?: { lastSeenSeq?: number; onResyncRequired?: () => void },
  ): FsSubscribeResult

  /** Tear down the broadcaster (and its underlying watcher). */
  close(): void
}

const DEFAULT_BUFFER_SIZE = 1000

export function createFsEventBroadcaster(
  watcher: WorkspaceWatcher,
  opts: { bufferSize?: number } = {},
): FsEventBroadcaster {
  const bufferSize = opts.bufferSize ?? DEFAULT_BUFFER_SIZE
  const buffer: FsEventEnvelope[] = []
  const listeners = new Map<(env: FsEventEnvelope) => void, { onResyncRequired?: () => void }>()
  let nextSeq = 1
  let closed = false
  let gapAfterSeq: number | null = null

  const handleControlEvent = (event: WorkspaceWatchControlEvent): void => {
    if (closed || event.type !== 'resync-required') return
    gapAfterSeq = nextSeq - 1
    buffer.length = 0
    for (const { onResyncRequired } of [...listeners.values()]) {
      try { onResyncRequired?.() } catch { /* one bad listener doesn't kill the chain */ }
    }
  }

  const watcherUnsub = watcher.subscribe((change) => {
    if (closed) return
    const env: FsEventEnvelope = {
      seq: nextSeq++,
      eventId: randomUUID(),
      ts: Date.now(),
      change,
    }
    buffer.push(env)
    if (buffer.length > bufferSize) buffer.shift()
    for (const l of [...listeners.keys()]) {
      try { l(env) } catch { /* one bad listener doesn't kill the chain */ }
    }
  }, { onControlEvent: handleControlEvent })

  return {
    subscribe(listener, sopts) {
      if (closed) {
        return { replay: [], resyncRequired: false, unsubscribe: () => {} }
      }

      let replay: FsEventEnvelope[] = []
      let resyncRequired = false

      if (typeof sopts?.lastSeenSeq === 'number' && sopts.lastSeenSeq > 0) {
        const head = buffer.length > 0 ? buffer[0]!.seq : nextSeq
        if (
          (gapAfterSeq != null && sopts.lastSeenSeq <= gapAfterSeq) ||
          sopts.lastSeenSeq < head - 1
        ) {
          // Gap: client's last-seen is older than what we still
          // have buffered, or the watcher explicitly reported a
          // disconnect gap. We can't fill it — flag resync.
          resyncRequired = true
        } else {
          // Replay events strictly newer than lastSeenSeq.
          replay = buffer.filter((e) => e.seq > sopts.lastSeenSeq!)
        }
      }

      listeners.set(listener, { onResyncRequired: sopts?.onResyncRequired })
      return {
        replay,
        resyncRequired,
        unsubscribe: () => {
          listeners.delete(listener)
        },
      }
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      buffer.length = 0
      try { watcherUnsub() } catch { /* swallow */ }
    },
  }
}
