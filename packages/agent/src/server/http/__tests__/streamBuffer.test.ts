import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TurnBuffer, StreamBufferStore } from '../streamBuffer'
import type { UIMessageChunk } from '../sse'

function chunk(text: string): UIMessageChunk {
  return { type: 'text-delta', delta: text } as UIMessageChunk
}

describe('TurnBuffer', () => {
  it('append returns monotonic idx starting at 0', () => {
    const buf = new TurnBuffer()
    expect(buf.append(chunk('a'))).toBe(0)
    expect(buf.append(chunk('b'))).toBe(1)
    expect(buf.append(chunk('c'))).toBe(2)
  })

  it('replay returns all chunks when cursor is -1', () => {
    const buf = new TurnBuffer()
    buf.append(chunk('a'))
    buf.append(chunk('b'))
    buf.append(chunk('c'))

    const replayed = buf.replay(-1)
    expect(replayed).toHaveLength(3)
    expect(replayed.map((e) => e.idx)).toEqual([0, 1, 2])
  })

  it('replay returns only chunks > cursor', () => {
    const buf = new TurnBuffer()
    buf.append(chunk('a'))
    buf.append(chunk('b'))
    buf.append(chunk('c'))

    const replayed = buf.replay(0)
    expect(replayed).toHaveLength(2)
    expect(replayed[0].idx).toBe(1)
    expect(replayed[1].idx).toBe(2)
  })

  it('replay returns empty when cursor >= highIdx', () => {
    const buf = new TurnBuffer()
    buf.append(chunk('a'))
    buf.append(chunk('b'))

    expect(buf.replay(1)).toHaveLength(0)
    expect(buf.replay(5)).toHaveLength(0)
  })

  it('subscribe receives new chunks', () => {
    const buf = new TurnBuffer()
    const received: number[] = []

    buf.subscribe(
      (e) => received.push(e.idx),
      () => {},
    )

    buf.append(chunk('a'))
    buf.append(chunk('b'))

    expect(received).toEqual([0, 1])
  })

  it('markComplete notifies done handlers', () => {
    vi.useFakeTimers()
    const buf = new TurnBuffer()
    let doneCount = 0

    buf.subscribe(
      () => {},
      () => doneCount++,
    )
    buf.markComplete(() => {})

    expect(doneCount).toBe(1)
    vi.useRealTimers()
  })

  it('markComplete + subscribe calls done immediately', () => {
    vi.useFakeTimers()
    const buf = new TurnBuffer()
    buf.markComplete(() => {})

    let doneCalled = false
    buf.subscribe(
      () => {},
      () => {
        doneCalled = true
      },
    )

    expect(doneCalled).toBe(true)
    vi.useRealTimers()
  })

  it('evicts ring after 60s TTL', () => {
    vi.useFakeTimers()
    const buf = new TurnBuffer()
    buf.append(chunk('a'))
    buf.append(chunk('b'))

    let evicted = false
    buf.markComplete(() => {
      evicted = true
    })

    expect(buf.replay(-1)).toHaveLength(2)

    vi.advanceTimersByTime(59_999)
    expect(evicted).toBe(false)
    expect(buf.replay(-1)).toHaveLength(2)

    vi.advanceTimersByTime(1)
    expect(evicted).toBe(true)
    expect(buf.replay(-1)).toHaveLength(0)

    vi.useRealTimers()
  })

  it('dispose clears ring and cancels gc timer', () => {
    vi.useFakeTimers()
    const buf = new TurnBuffer()
    buf.append(chunk('a'))

    let evicted = false
    buf.markComplete(() => {
      evicted = true
    })

    buf.dispose()
    vi.advanceTimersByTime(120_000)
    expect(evicted).toBe(false)
    expect(buf.replay(-1)).toHaveLength(0)

    vi.useRealTimers()
  })

  it('evicts oldest when exceeding max capacity', () => {
    const buf = new TurnBuffer()
    for (let i = 0; i < 2001; i++) buf.append(chunk(`c${i}`))

    expect(buf.highIdx).toBe(2000)
    expect(buf.minIdx).toBe(1)
    const all = buf.replay(-1)
    expect(all).toHaveLength(2000)
    expect(all[0].idx).toBe(1)
  })

  it('highIdx / minIdx report correct values', () => {
    const buf = new TurnBuffer()
    expect(buf.highIdx).toBe(-1)

    buf.append(chunk('a'))
    expect(buf.highIdx).toBe(0)
    expect(buf.minIdx).toBe(0)

    buf.append(chunk('b'))
    expect(buf.highIdx).toBe(1)
    expect(buf.minIdx).toBe(0)
  })
})

describe('StreamBufferStore', () => {
  it('create and get roundtrip', () => {
    const store = new StreamBufferStore()
    const buf = store.create('s1', 't1')
    expect(store.get('s1', 't1')).toBe(buf)
  })

  it('getActive returns latest turn', () => {
    const store = new StreamBufferStore()
    store.create('s1', 't1')
    store.create('s1', 't2')

    const active = store.getActive('s1')
    expect(active?.turnId).toBe('t2')
  })

  it('evict removes buffer and clears active', () => {
    const store = new StreamBufferStore()
    store.create('s1', 't1')
    store.evict('s1', 't1')

    expect(store.get('s1', 't1')).toBeUndefined()
    expect(store.getActive('s1')).toBeUndefined()
  })

  it('getActive returns undefined for unknown session', () => {
    const store = new StreamBufferStore()
    expect(store.getActive('nope')).toBeUndefined()
  })

  it('independent sessions have independent buffers', () => {
    const store = new StreamBufferStore()
    const b1 = store.create('s1', 't1')
    const b2 = store.create('s2', 't1')

    b1.append(chunk('a'))
    expect(b1.highIdx).toBe(0)
    expect(b2.highIdx).toBe(-1)
  })
})
