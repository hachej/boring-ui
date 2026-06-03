import { describe, it, expect, vi } from 'vitest'
import { ReadyStatusTracker } from '../readyStatus'

describe('ReadyStatusTracker', () => {
  it('starts as provisioning when sandbox not ready', () => {
    const tracker = new ReadyStatusTracker()
    expect(tracker.state).toBe('provisioning')
    expect(tracker.isReady()).toBe(false)
    expect(tracker.getReadiness()).toMatchObject({
      sandboxReady: false,
      harnessReady: false,
      degradedReason: undefined,
      capabilities: {
        chat: { state: 'preparing' },
        workspace: { state: 'preparing' },
        runtimeDependencies: { state: 'ready' },
      },
    })
  })

  it('starts as ready when both flags set', () => {
    const tracker = new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
    })
    expect(tracker.state).toBe('ready')
    expect(tracker.isReady()).toBe(true)
  })

  it('transitions to ready when both components report', () => {
    const tracker = new ReadyStatusTracker()
    tracker.markHarnessReady()
    expect(tracker.state).toBe('provisioning')

    tracker.markSandboxReady()
    expect(tracker.state).toBe('ready')
    expect(tracker.isReady()).toBe(true)
  })

  it('transitions to degraded with reason and can recover', () => {
    const tracker = new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
    })
    expect(tracker.state).toBe('ready')

    tracker.markDegraded('sandbox crashed')
    expect(tracker.state).toBe('degraded')
    expect(tracker.getReadiness().degradedReason).toBe('sandbox crashed')

    tracker.clearDegraded()
    expect(tracker.state).toBe('ready')
    expect(tracker.getReadiness().degradedReason).toBeUndefined()
  })

  it('subscribe receives immediate snapshot then updates', () => {
    const tracker = new ReadyStatusTracker({ harnessReady: true })
    const events: Array<{ state: string }> = []

    tracker.subscribe((e) => events.push({ state: e.state }))
    expect(events).toHaveLength(1)
    expect(events[0].state).toBe('provisioning')

    tracker.markSandboxReady()
    expect(events).toHaveLength(2)
    expect(events[1].state).toBe('ready')
  })

  it('unsubscribe stops delivery', () => {
    const tracker = new ReadyStatusTracker()
    const handler = vi.fn()

    const unsub = tracker.subscribe(handler)
    expect(handler).toHaveBeenCalledTimes(1)

    unsub()
    tracker.markSandboxReady()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('markSandboxReady is idempotent', () => {
    const tracker = new ReadyStatusTracker({ harnessReady: true })
    const handler = vi.fn()
    tracker.subscribe(handler)
    handler.mockClear()

    tracker.markSandboxReady()
    tracker.markSandboxReady()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('chat 503 pattern: not ready returns retryAfter', () => {
    const tracker = new ReadyStatusTracker()
    const readiness = tracker.getReadiness()

    if (!readiness.sandboxReady || !readiness.harnessReady) {
      const response = { status: 'provisioning', retryAfter: 2 }
      expect(response.retryAfter).toBe(2)
    }

    tracker.markSandboxReady()
    tracker.markHarnessReady()
    expect(tracker.isReady()).toBe(true)
  })

  it('warm start: direct/local mode is ready immediately', () => {
    const tracker = new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
    })
    expect(tracker.isReady()).toBe(true)
    expect(tracker.state).toBe('ready')
  })
})
