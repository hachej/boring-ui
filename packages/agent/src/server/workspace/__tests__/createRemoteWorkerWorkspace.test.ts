import { afterEach, expect, test, vi } from 'vitest'

import { ErrorCode } from '../../../shared/error-codes'
import type { WorkspaceChangeEvent, WorkspaceWatchControlEvent } from '../../../shared/workspace'
import { createRemoteWorkerWorkspace } from '../createRemoteWorkerWorkspace'
import type { RemoteWorkerClient } from '../../sandbox/remote-worker/workerClient'

const EEXIST_CODE = 'EEXIST'

afterEach(() => {
  vi.useRealTimers()
})

test('exclusive binary create propagates the operation and normalizes remote EEXIST', async () => {
  const workspaceRequest = vi.fn()
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValueOnce(Object.assign(new Error('already exists'), { code: ErrorCode.enum.REMOTE_WORKER_ALREADY_EXISTS }))
  const workspace = createRemoteWorkerWorkspace(
    { workspace: workspaceRequest } as unknown as RemoteWorkerClient,
    true,
  )
  const bytes = new TextEncoder().encode('binary')

  await workspace.createBinaryFile?.('new.bin', bytes)
  expect(workspaceRequest).toHaveBeenCalledWith({
    op: 'createBinaryFile',
    path: 'new.bin',
    dataBase64: 'YmluYXJ5',
  })
  await expect(workspace.createBinaryFile?.('existing.bin', bytes)).rejects.toMatchObject({ code: EEXIST_CODE })
})

test('new client omits exclusive create when an old worker advertises no capability', () => {
  const workspace = createRemoteWorkerWorkspace({} as RemoteWorkerClient, false)
  expect(workspace.createBinaryFile).toBeUndefined()
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
