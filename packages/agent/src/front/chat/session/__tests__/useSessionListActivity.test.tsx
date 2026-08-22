// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useSessionListActivity } from '../useSessionListActivity'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  removeEventListener() {}
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent)
  }
  close() { this.closed = true }
}

function withFakeEventSource(run: () => void) {
  const previous = (globalThis as { EventSource?: unknown }).EventSource
  ;(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource
  FakeEventSource.instances = []
  try { run() } finally {
    if (previous === undefined) delete (globalThis as { EventSource?: unknown }).EventSource
    else (globalThis as { EventSource?: unknown }).EventSource = previous
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('useSessionListActivity', () => {
  test('opens the session-activity stream beside the rendered list and applies transitions', () => {
    const onActivity = vi.fn()
    withFakeEventSource(() => {
      const { unmount } = renderHook(() => useSessionListActivity({ apiBaseUrl: 'http://hub', enabled: true, onActivity }))
      const source = FakeEventSource.instances.at(-1)!
      expect(source.url).toBe('http://hub/api/v1/agents/session-activity/events')

      // A snapshot reconciles every listed row in one frame.
      source.emit('snapshot', { sessions: [
        { ref: { agentTypeId: 'alpha', sessionId: 's1' }, status: 'running' },
        { ref: { agentTypeId: 'alpha', sessionId: 's2' }, status: 'idle' },
      ] })
      expect(onActivity).toHaveBeenCalledWith('s1', 'running', 'alpha')
      expect(onActivity).toHaveBeenCalledWith('s2', 'idle', 'alpha')

      // Live edge: running → idle rides the activity event.
      source.emit('activity', { ref: { agentTypeId: 'alpha', sessionId: 's1' }, status: 'idle' })
      expect(onActivity).toHaveBeenCalledWith('s1', 'idle', 'alpha')
      expect(source.closed).toBe(false)

      unmount()
      expect(source.closed).toBe(true)
    })
  })

  test('ignores malformed frames and skips opening when disabled', () => {
    const onActivity = vi.fn()
    withFakeEventSource(() => {
      renderHook(() => useSessionListActivity({ enabled: false, onActivity }))
      expect(FakeEventSource.instances).toHaveLength(0)

      const { unmount } = renderHook(() => useSessionListActivity({ enabled: true, onActivity }))
      const source = FakeEventSource.instances[0]
      source.emit('activity', { ref: { sessionId: 's1' }, status: 'running' }) // missing agentTypeId
      source.emit('activity', { ref: { agentTypeId: 'a', sessionId: 's1' }, status: 'exploded' })
      source.emit('activity', undefined)
      expect(onActivity).not.toHaveBeenCalled()
      unmount()
    })
  })
})
