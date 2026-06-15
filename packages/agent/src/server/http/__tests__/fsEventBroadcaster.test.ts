import { describe, expect, it } from 'vitest'
import { createFsEventBroadcaster } from '../fsEventBroadcaster'
import type {
  WorkspaceChangeEvent,
  WorkspaceWatchControlEvent,
  WorkspaceWatchSubscribeOptions,
  WorkspaceWatcher,
} from '../../../shared/workspace'

function makeStubWatcher(): {
  watcher: WorkspaceWatcher
  emit: (e: WorkspaceChangeEvent) => void
  control: (e: WorkspaceWatchControlEvent) => void
} {
  const listeners = new Map<(e: WorkspaceChangeEvent) => void, WorkspaceWatchSubscribeOptions | undefined>()
  const emit = (e: WorkspaceChangeEvent) => {
    for (const l of [...listeners.keys()]) l(e)
  }
  const control = (e: WorkspaceWatchControlEvent) => {
    for (const opts of [...listeners.values()]) opts?.onControlEvent?.(e)
  }
  const watcher: WorkspaceWatcher = {
    subscribe(listener, opts) {
      listeners.set(listener, opts)
      return () => { listeners.delete(listener) }
    },
    close() {
      listeners.clear()
    },
  }
  return { watcher, emit, control }
}

describe('createFsEventBroadcaster', () => {
  it('assigns monotonic seq starting at 1 and unique eventIds', () => {
    const { watcher, emit } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher)

    const seen: Array<{ seq: number; eventId: string }> = []
    b.subscribe((env) => seen.push({ seq: env.seq, eventId: env.eventId }))

    emit({ op: 'write', path: 'a.ts' })
    emit({ op: 'write', path: 'b.ts' })
    emit({ op: 'unlink', path: 'c.ts' })

    expect(seen.map((s) => s.seq)).toEqual([1, 2, 3])
    expect(new Set(seen.map((s) => s.eventId)).size).toBe(3)
    b.close()
  })

  it('replays events strictly newer than lastSeenSeq on subscribe', () => {
    const { watcher, emit } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher)

    // Drain three events before subscriber arrives.
    b.subscribe(() => {}) // Anchor so the broadcaster keeps running.
    emit({ op: 'write', path: '1.ts' })
    emit({ op: 'write', path: '2.ts' })
    emit({ op: 'write', path: '3.ts' })

    const live: number[] = []
    const sub = b.subscribe((env) => live.push(env.seq), { lastSeenSeq: 1 })

    expect(sub.resyncRequired).toBe(false)
    expect(sub.replay.map((e) => e.seq)).toEqual([2, 3])

    emit({ op: 'write', path: '4.ts' })
    expect(live).toEqual([4])

    sub.unsubscribe()
    b.close()
  })

  it('flags resyncRequired when lastSeenSeq predates the buffer head', () => {
    const { watcher, emit } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher, { bufferSize: 2 })

    b.subscribe(() => {})
    // Push 5 events through a buffer of 2 → buffer holds [4, 5].
    for (let i = 0; i < 5; i++) emit({ op: 'write', path: `${i}.ts` })

    const sub = b.subscribe(() => {}, { lastSeenSeq: 1 })
    expect(sub.resyncRequired).toBe(true)
    expect(sub.replay).toEqual([])
    sub.unsubscribe()
    b.close()
  })

  it('does not require resync for a recent enough lastSeenSeq', () => {
    const { watcher, emit } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher, { bufferSize: 4 })

    b.subscribe(() => {})
    for (let i = 0; i < 4; i++) emit({ op: 'write', path: `${i}.ts` })

    const sub = b.subscribe(() => {}, { lastSeenSeq: 2 })
    expect(sub.resyncRequired).toBe(false)
    expect(sub.replay.map((e) => e.seq)).toEqual([3, 4])
    sub.unsubscribe()
    b.close()
  })

  it('signals resync when the underlying watcher reports a gap', () => {
    const { watcher, emit, control } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher)
    const seen: number[] = []
    const resyncs: number[] = []

    const sub = b.subscribe(
      (env) => seen.push(env.seq),
      { onResyncRequired: () => resyncs.push(Date.now()) },
    )
    emit({ op: 'write', path: 'before-gap.ts' })
    control({ type: 'resync-required', reason: 'stream_closed' })
    emit({ op: 'write', path: 'after-gap.ts' })

    expect(seen).toEqual([1, 2])
    expect(resyncs).toHaveLength(1)

    const stale = b.subscribe(() => {}, { lastSeenSeq: 1 })
    expect(stale.resyncRequired).toBe(true)
    stale.unsubscribe()
    sub.unsubscribe()
    b.close()
  })

  it('subscribers added after close receive nothing', () => {
    const { watcher, emit } = makeStubWatcher()
    const b = createFsEventBroadcaster(watcher)
    b.close()

    const seen: number[] = []
    const sub = b.subscribe((env) => seen.push(env.seq))
    emit({ op: 'write', path: 'x.ts' })
    expect(seen).toEqual([])
    sub.unsubscribe()
  })
})
