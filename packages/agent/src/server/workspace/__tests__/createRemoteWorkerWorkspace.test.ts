import { afterEach, expect, test, vi } from 'vitest'

import type { WorkspaceChangeEvent, WorkspaceWatchControlEvent } from '../../../shared/workspace'
import { createRemoteWorkerWorkspace } from '../createRemoteWorkerWorkspace'
import type { RemoteWorkerClient } from '../../sandbox/remote-worker/workerClient'

afterEach(() => {
  vi.useRealTimers()
})

test('remote watcher reconnects after the worker event stream closes', async () => {
  vi.useFakeTimers()

  const handles: Array<{
    onEvent: (event: WorkspaceChangeEvent) => void
    onError?: (error: Error) => void
    closed: boolean
  }> = []
  const client = {
    watch(onEvent: (event: WorkspaceChangeEvent) => void, onError?: (error: Error) => void) {
      const handle = { onEvent, onError, closed: false }
      handles.push(handle)
      return {
        close() {
          handle.closed = true
        },
      }
    },
  } as unknown as RemoteWorkerClient
  const workspace = createRemoteWorkerWorkspace(client)
  const watcher = workspace.watch?.()
  const events: WorkspaceChangeEvent[] = []
  const controlEvents: WorkspaceWatchControlEvent[] = []

  const unsubscribe = watcher?.subscribe(
    (event) => events.push(event),
    { onControlEvent: (event) => controlEvents.push(event) },
  )
  expect(handles).toHaveLength(1)

  handles[0]?.onError?.(new Error('stream closed'))
  expect(handles).toHaveLength(1)
  expect(controlEvents).toEqual([
    { type: 'resync-required', reason: 'remote_worker_stream_closed' },
  ])

  await vi.advanceTimersByTimeAsync(1_000)
  expect(handles).toHaveLength(2)

  handles[1]?.onEvent({ op: 'write', path: 'reconnected.txt' })
  expect(events).toEqual([{ op: 'write', path: 'reconnected.txt' }])

  unsubscribe?.()
  expect(handles[1]?.closed).toBe(true)
})
