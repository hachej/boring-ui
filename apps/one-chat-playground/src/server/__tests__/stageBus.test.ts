import { describe, expect, it, vi } from 'vitest'

import { createStageBus } from '../stageBus.js'
import { devCspPolicy } from '../csp.js'

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

  it('replays active builder work after a reconnect but not a terminal milestone', () => {
    const bus = createStageBus()
    const activity = {
      type: 'activity.started' as const,
      slug: 'supplier-list',
      label: 'supplier list',
      stage: 'build' as const,
      startedAt: '2026-09-15T12:00:00.000Z',
    }
    bus.emit(activity)

    const reconnected = vi.fn()
    bus.subscribe(reconnected)
    expect(reconnected).toHaveBeenCalledWith(activity)

    bus.emit({ ...activity, type: 'activity.done' })
    const afterDone = vi.fn()
    bus.subscribe(afterDone)
    expect(afterDone).not.toHaveBeenCalled()
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

describe('devCspPolicy', () => {
  it('frames exactly what the show_on_screen allowlist permits', () => {
    const policy = devCspPolicy(['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*', 'https://preview.test'])
    expect(policy).toContain("frame-src 'self' http://localhost:* http://127.0.0.1:* https://preview.test")
    // Bracketed IPv6 literals are not valid CSP host-sources.
    expect(policy).not.toContain('[::1]')
    expect(policy).toContain("default-src 'self'")
  })
})
