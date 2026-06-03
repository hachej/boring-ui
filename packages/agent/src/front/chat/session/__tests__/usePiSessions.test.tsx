// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionSummary } from '../../../../shared/session'
import type { RemotePiSession, RemotePiSessionOptions } from '../../pi/remotePiSession'
import { activeSessionStorageKey, type ActiveSessionStorageLike } from '../activeSessionStorage'
import { usePiSessions } from '../usePiSessions'

function session(id: string, updatedAt = '2026-06-03T00:00:00.000Z'): SessionSummary {
  return { id, title: `Session ${id}`, createdAt: updatedAt, updatedAt, turnCount: 0 }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function storage(initial: Record<string, string> = {}): ActiveSessionStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

function remoteFactory() {
  const created: Array<{ options: RemotePiSessionOptions; dispose: ReturnType<typeof vi.fn> }> = []
  const factory = vi.fn((options: RemotePiSessionOptions) => {
    const dispose = vi.fn()
    created.push({ options, dispose })
    return { dispose } as unknown as RemotePiSession
  })
  return { factory, created }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('usePiSessions', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  test('preserves a valid v2 persisted active session while streaming and opens one remote session', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-running' })
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([session('pi-running')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      workspaceId: 'workspace-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      requestHeaders: { authorization: 'Bearer redacted' },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.activeSessionId).toBe('pi-running')
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-running'])
    expect(remote.factory).toHaveBeenCalledTimes(1)
    expect(remote.created[0]?.options).toMatchObject({ sessionId: 'pi-running', workspaceId: 'workspace-a', storageScope: 'scope-a' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions', {
      headers: { authorization: 'Bearer redacted', 'x-boring-storage-scope': 'scope-a' },
    })
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-running')
  })

  test('falls back safely when persisted active id is invalid and persists the fallback', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'missing' })
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([session('pi-fallback')]))

    const { result } = renderHook(() => usePiSessions({ storageScope: 'scope-a', storage: persisted, fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.activeSessionId).toBe('pi-fallback')
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-fallback')
    expect(remote.created).toHaveLength(1)
  })

  test('switching sessions disposes the previous RemotePiSession', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([session('pi-1'), session('pi-2')]))

    const { result } = renderHook(() => usePiSessions({ storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory }))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-1'))

    act(() => result.current.switch('pi-2'))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-2'))

    expect(remote.created).toHaveLength(2)
    expect(remote.created[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(remote.created[1]?.options.sessionId).toBe('pi-2')
  })

  test('created-session overlay prevents stale refreshes from hiding a just-created session and keeps one list entry', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-old')]))
      .mockResolvedValueOnce(jsonResponse(session('pi-new')))
      .mockResolvedValueOnce(jsonResponse([session('pi-old')]))
      .mockResolvedValueOnce(jsonResponse([session('pi-new'), session('pi-old')]))

    const { result } = renderHook(() => usePiSessions({ storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory }))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-old'))

    await act(async () => {
      await result.current.create({ title: 'New' })
    })

    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-new', 'pi-old']))
    expect(result.current.activeSessionId).toBe('pi-new')

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.sessions.filter((item) => item.id === 'pi-new')).toHaveLength(1)
  })

  test('retries transient cold-runtime 503s with a bounded cancellable loop', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'preparing' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'preparing' } }, 503))
      .mockResolvedValueOnce(jsonResponse([session('pi-ready')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      retry: { baseMs: 1, maxMs: 1, maxRetries: 4 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.activeSessionId).toBe('pi-ready')
    expect(result.current.error).toBeUndefined()
  })

  test('unmount cancels cold-runtime retries and does not create a remote session', async () => {
    vi.useFakeTimers()
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'preparing' } }, 503))

    const { unmount } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      retry: { baseMs: 100, maxMs: 100, maxRetries: 4 },
    }))

    await act(async () => {})
    unmount()
    await vi.runAllTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(remote.factory).not.toHaveBeenCalled()
  })

  test('delete of active session clears storage when no fallback remains and disposes remote session', async () => {
    const persisted = storage()
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-delete')]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    const { result } = renderHook(() => usePiSessions({ storageScope: 'scope-a', storage: persisted, fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory }))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-delete'))

    await act(async () => {
      await result.current.delete('pi-delete')
    })

    await waitFor(() => expect(result.current.activeSessionId).toBeUndefined())
    expect(persisted.values.has(activeSessionStorageKey('scope-a'))).toBe(false)
    expect(remote.created[0]?.dispose).toHaveBeenCalled()
  })
})
