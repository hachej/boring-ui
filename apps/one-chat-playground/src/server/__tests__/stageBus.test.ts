import { describe, expect, it, vi } from 'vitest'

import { createStageBus } from '../stageBus.js'

describe('createStageBus', () => {
  it('fans an event out to every subscriber', () => {
    const bus = createStageBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(a)
    bus.subscribe(b)

    bus.emit({ type: 'stage.show', url: 'http://localhost:1/', title: 'T' })

    expect(a).toHaveBeenCalledWith({ type: 'stage.show', url: 'http://localhost:1/', title: 'T' })
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = createStageBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)
    unsubscribe()
    bus.emit({ type: 'stage.clear' })
    expect(listener).not.toHaveBeenCalled()
    expect(bus.subscriberCount).toBe(0)
  })

  it('keeps delivering when one subscriber throws', () => {
    const bus = createStageBus()
    const healthy = vi.fn()
    bus.subscribe(() => {
      throw new Error('dead socket')
    })
    bus.subscribe(healthy)
    expect(() => bus.emit({ type: 'stage.clear' })).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
