// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
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
    window.localStorage.clear()
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
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions?activeSessionId=pi-running', {
      headers: { authorization: 'Bearer redacted', 'x-boring-storage-scope': 'scope-a' },
    })
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-running')
  })

  test('does not dispose the active remote session when equal remote options are re-created by the host', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([session('pi-running')]))

    const { rerender } = renderHook(
      ({ timeout }) => usePiSessions({
        storageScope: 'scope-a',
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
        remoteSessionOptions: { requestTimeoutMs: timeout },
      }),
      { initialProps: { timeout: 60_000 } },
    )

    await waitFor(() => expect(remote.factory).toHaveBeenCalledTimes(1))

    rerender({ timeout: 60_000 })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remote.factory).toHaveBeenCalledTimes(1)
    expect(remote.created[0]?.dispose).not.toHaveBeenCalled()
  })

  test('recreates the active remote session when callback remote options change', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([session('pi-running')]))
    const onEventA = vi.fn()
    const onEventB = vi.fn()

    const { rerender } = renderHook(
      ({ onEvent }) => usePiSessions({
        storageScope: 'scope-a',
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
        remoteSessionOptions: { requestTimeoutMs: 60_000, onEvent },
      }),
      { initialProps: { onEvent: onEventA } },
    )

    await waitFor(() => expect(remote.factory).toHaveBeenCalledTimes(1))

    rerender({ onEvent: onEventB })

    await waitFor(() => expect(remote.factory).toHaveBeenCalledTimes(2))
    expect(remote.created[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(remote.created[1]?.options.onEvent).toBe(onEventB)
  })

  test('loads the first session page before fetching older sessions on demand', async () => {
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    const secondPage = [session('pi-50')]
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.sessions).toHaveLength(50)
    expect(result.current.hasMore).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions', {
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/agent/pi-chat/sessions?limit=50&offset=50', {
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(result.current.sessions.map((item) => item.id)).toEqual([
      ...firstPage.map((item) => item.id),
      'pi-50',
    ])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.loadingMore).toBe(false)
  })

  test('preserves a paged-out persisted active session instead of switching to the first page', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-older-active' })
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([
      ...Array.from({ length: 50 }, (_, index) => session(`pi-${index}`)),
      session('pi-older-active'),
    ]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(remote.factory).toHaveBeenCalledTimes(1))

    expect(result.current.activeSessionId).toBe('pi-older-active')
    expect(result.current.activeSession).toEqual(expect.objectContaining({ id: 'pi-older-active' }))
    expect(remote.created[0]?.options.sessionId).toBe('pi-older-active')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions?activeSessionId=pi-older-active', {
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-older-active')
  })

  test('falls back from a stale persisted active id when the server did not include it', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-stale' })
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.activeSessionId).toBe('pi-0')
    expect(remote.created[0]?.options.sessionId).toBe('pi-0')
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-0')
  })

  test('ignores stale load-more responses after the data scope changes', async () => {
    const remote = remoteFactory()
    const loadMoreResponse = deferred<Response>()
    const newScopeResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`a-${index}`))))
      .mockReturnValueOnce(loadMoreResponse.promise)
      .mockReturnValueOnce(newScopeResponse.promise)
      .mockResolvedValue(jsonResponse([session('b-0')]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      void result.current.loadMore()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    await act(async () => {
      loadMoreResponse.resolve(jsonResponse([session('a-stale')]))
      await loadMoreResponse.promise
    })

    expect(result.current.sessions.map((item) => item.id)).not.toContain('a-stale')

    await act(async () => {
      newScopeResponse.resolve(jsonResponse([session('b-0')]))
      await newScopeResponse.promise
    })

    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-0']))
    expect(result.current.sessions.map((item) => item.id)).toEqual(['b-0'])
    expect(result.current.activeSessionId).toBe('b-0')
  })

  test('ignores stale load-more failures after the data scope changes', async () => {
    const remote = remoteFactory()
    const loadMoreResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`a-${index}`))))
      .mockReturnValueOnce(loadMoreResponse.promise)
      .mockResolvedValueOnce(jsonResponse([session('b-0')]))
      .mockResolvedValue(jsonResponse([session('b-0')]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      void result.current.loadMore()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-0']))

    await act(async () => {
      loadMoreResponse.reject(new Error('stale load more failed'))
      await loadMoreResponse.promise.catch(() => {})
    })

    expect(result.current.error).toBeUndefined()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['b-0'])
  })

  test('uses the new scope persisted active id after storage scope changes', async () => {
    const persisted = storage({
      [activeSessionStorageKey('scope-a')]: 'a-active',
      [activeSessionStorageKey('scope-b')]: 'b-active',
    })
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('a-active')]))
      .mockResolvedValueOnce(jsonResponse([
        ...Array.from({ length: 50 }, (_, index) => session(`b-${index}`)),
        session('b-active'),
      ]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        storage: persisted,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('a-active'))

    rerender({ scope: 'scope-b' })

    await waitFor(() => expect(result.current.activeSessionId).toBe('b-active'))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/agent/pi-chat/sessions?activeSessionId=b-active', {
      headers: { 'x-boring-storage-scope': 'scope-b' },
    })
    expect(persisted.values.get(activeSessionStorageKey('scope-b'))).toBe('b-active')
  })

  test('does not start a second foreground refresh after storage scope changes', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('a-0')]))
      .mockResolvedValueOnce(jsonResponse([session('b-0')]))
      .mockRejectedValue(new Error('unexpected extra refresh'))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('a-0'))

    rerender({ scope: 'scope-b' })

    await waitFor(() => expect(result.current.activeSessionId).toBe('b-0'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeUndefined()
  })

  test('does not carry active session across API data source changes', async () => {
    const persisted = storage({
      [activeSessionStorageKey('scope-a')]: 'old-active',
    })
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('old-active')]))
      .mockResolvedValueOnce(jsonResponse([session('new-0')]))

    const { result, rerender } = renderHook(
      ({ apiBaseUrl }) => usePiSessions({
        apiBaseUrl,
        storageScope: 'scope-a',
        storage: persisted,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { apiBaseUrl: 'http://old.example' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('old-active'))

    rerender({ apiBaseUrl: 'http://new.example' })

    await waitFor(() => expect(result.current.activeSessionId).toBe('new-0'))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://new.example/api/v1/agent/pi-chat/sessions', {
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('new-0')
  })

  test('preserves a paged-out active session across request header changes', async () => {
    const persisted = storage({
      [activeSessionStorageKey('scope-a')]: 'pi-active',
    })
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    fetchMock
      .mockResolvedValueOnce(jsonResponse([...firstPage, session('pi-active')]))
      .mockResolvedValueOnce(jsonResponse([...firstPage, session('pi-active')]))

    const { result, rerender } = renderHook(
      ({ token }) => usePiSessions({
        storageScope: 'scope-a',
        requestHeaders: { authorization: `Bearer ${token}` },
        storage: persisted,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { token: 'old' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-active'))

    rerender({ token: 'new' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/agent/pi-chat/sessions?activeSessionId=pi-active', {
      headers: {
        authorization: 'Bearer new',
        'x-boring-storage-scope': 'scope-a',
      },
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-active'))
  })

  test('background refresh preserves pages already loaded by loadMore', async () => {
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    const refreshedFirstPage = firstPage.map((item, index) => (
      index === 0 ? { ...item, title: 'Renamed first session' } : item
    ))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([session('pi-50')]))
      .mockResolvedValueOnce(jsonResponse(refreshedFirstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.sessions).toHaveLength(51)

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.sessions).toHaveLength(51)
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-0', title: 'Renamed first session' })
    expect(result.current.sessions.map((item) => item.id)).toContain('pi-50')
    expect(result.current.hasMore).toBe(false)
  })

  test('background refresh drops a requested active session that the server omits', async () => {
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([session('pi-50')]))
      .mockResolvedValueOnce(jsonResponse(firstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    act(() => {
      result.current.switch('pi-50')
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-50'))

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.sessions.map((item) => item.id)).not.toContain('pi-50')
    expect(result.current.activeSessionId).toBe('pi-0')
  })

  test('background refresh keeps load-more exhausted for exactly one full page', async () => {
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(firstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.sessions).toHaveLength(50)
    expect(result.current.hasMore).toBe(false)

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.sessions).toHaveLength(50)
    expect(result.current.hasMore).toBe(false)
  })

  test('background refresh with a short first page drops stale loaded older sessions', async () => {
    const remote = remoteFactory()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    const shortRefresh = Array.from({ length: 10 }, (_, index) => session(`fresh-${index}`))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([session('pi-50')]))
      .mockResolvedValueOnce(jsonResponse(shortRefresh))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.sessions.map((item) => item.id)).toContain('pi-50')

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.sessions.map((item) => item.id)).toEqual(shortRefresh.map((item) => item.id))
    expect(result.current.hasMore).toBe(false)
  })

  test('background refresh clears an in-flight load-more spinner for the same scope', async () => {
    const remote = remoteFactory()
    const loadMoreResponse = deferred<Response>()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockReturnValueOnce(loadMoreResponse.promise)
      .mockResolvedValueOnce(jsonResponse(firstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      void result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.loadingMore).toBe(false)

    await act(async () => {
      loadMoreResponse.resolve(jsonResponse([session('pi-stale')]))
      await loadMoreResponse.promise
    })

    expect(result.current.loadingMore).toBe(false)
    expect(result.current.sessions.map((item) => item.id)).not.toContain('pi-stale')
  })

  test('does not start load-more while a foreground refresh is in flight', async () => {
    const remote = remoteFactory()
    const refreshResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))))
      .mockReturnValueOnce(refreshResponse.promise)

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      refreshResponse.resolve(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`fresh-${index}`))))
      await refreshPromise
    })

    expect(result.current.sessions[0]?.id).toBe('fresh-0')
  })

  test('reset keeps pagination offset aligned with retained sessions', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))))
      .mockResolvedValueOnce(jsonResponse([session('pi-50')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      result.current.reset()
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/agent/pi-chat/sessions?limit=50&offset=50', {
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(result.current.sessions.map((item) => item.id)).toContain('pi-50')
  })

  test('successful load-more retry clears the previous load-more error', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'older page failed' } }, 500))
      .mockResolvedValueOnce(jsonResponse([session('pi-50')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.error?.message).toBe('Failed to load sessions: 500')

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.error).toBeUndefined()
    expect(result.current.sessions.map((item) => item.id)).toContain('pi-50')
  })

  test('coalesces concurrent load-more calls before React commits loading state', async () => {
    const remote = remoteFactory()
    const loadMoreResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))))
      .mockReturnValueOnce(loadMoreResponse.promise)

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      void result.current.loadMore()
      void result.current.loadMore()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      loadMoreResponse.resolve(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`pi-${50 + index}`))))
      await loadMoreResponse.promise
    })

    expect(result.current.sessions).toHaveLength(100)
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

  test('keeps the request-scoped coordinator alive through StrictMode effect replay', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'strict-local',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      localCreateUntilPrompt: true,
    }), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> })

    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.create() })
    await waitFor(() => expect(remote.created[0]?.options.ephemeralSession?.localId).toMatch(/^local-/))
  })

  test('does not restore an unsent browser-local chat after reload', async () => {
    const persisted = storage()
    const remote = remoteFactory()
    fetchMock.mockImplementation(async () => jsonResponse([]))
    const options = {
      storageScope: 'scope-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      localCreateUntilPrompt: true,
    }

    const first = renderHook(() => usePiSessions(options))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await act(async () => { await first.result.current.create() })
    expect(first.result.current.activeSessionId).toMatch(/^local-/)
    expect(persisted.values.has(activeSessionStorageKey('scope-a'))).toBe(false)

    first.unmount()
    const reloaded = renderHook(() => usePiSessions(options))
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false))
    expect(reloaded.result.current.activeSessionId).toBeUndefined()
    expect(remote.created).toHaveLength(1)
  })

  test('keeps a New chat browser-local until its native first-send receipt materializes it', async () => {
    const persisted = storage()
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      localCreateUntilPrompt: true,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create()
    })
    const localId = result.current.activeSessionId
    expect(localId).toMatch(/^local-/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBeUndefined()
    await waitFor(() => expect(remote.created[0]?.options.sessionId).toBe(localId))
    expect(remote.created[0]?.options).toMatchObject({ autoStart: false, ephemeralSession: { localId } })

    act(() => {
      void result.current.materializeLocal(localId!, {
        id: 'native-1', nativeSessionId: 'native-1', title: 'First chat',
        createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 1, hasAssistantReply: false,
      })
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('native-1'))
    expect(result.current.sessions.map((item) => item.id)).toContain('native-1')
    expect(result.current.sessions.map((item) => item.id)).not.toContain(localId)
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('native-1')
  })

  test('adopts a persisted prompt_failed native ID so delete targets its only transcript', async () => {
    const persisted = storage()
    const remote = remoteFactory()
    const native = {
      id: 'native-failed', nativeSessionId: 'native-failed', title: 'First chat',
      createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z', turnCount: 1, hasAssistantReply: false,
    }
    let listReads = 0
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      listReads += 1
      return jsonResponse(listReads === 2 ? [native] : [])
    })
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      storage: persisted,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      localCreateUntilPrompt: true,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create()
    })
    const localId = result.current.activeSessionId!
    await waitFor(() => expect(remote.created[0]?.options.sessionId).toBe(localId))

    await act(async () => {
      await result.current.materializeLocal(localId, native)
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('native-failed'))
    expect(result.current.sessions.map((item) => item.id)).toEqual(['native-failed'])
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('native-failed')

    await act(async () => {
      await result.current.delete('native-failed')
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions/native-failed', {
      method: 'DELETE',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(result.current.sessions).toEqual([])
  })

  test('renaming an older session with unchanged activity keeps its canonical row position', async () => {
    const remote = remoteFactory()
    const newer = session('pi-newer', '2026-06-05T00:00:00.000Z')
    const older = session('pi-older', '2026-06-04T00:00:00.000Z')
    fetchMock
      .mockResolvedValueOnce(jsonResponse([newer, older]))
      .mockResolvedValueOnce(jsonResponse({ ...older, title: 'Renamed older session' }))
      .mockResolvedValue(jsonResponse([newer, { ...older, title: 'Renamed older session' }]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.rename('pi-older', 'Renamed older session')
    })

    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-newer', 'pi-older'])
    expect(result.current.sessions[1]).toMatchObject({ title: 'Renamed older session', updatedAt: older.updatedAt })
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

  test('created-session overlay clears when request headers change before refresh completes', async () => {
    const remote = remoteFactory()
    const oldHeaderRefresh = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(session('pi-new')))
      .mockReturnValueOnce(oldHeaderRefresh.promise)
      .mockResolvedValueOnce(jsonResponse([]))

    const { result, rerender } = renderHook(
      ({ token }) => usePiSessions({
        storageScope: 'scope-a',
        requestHeaders: { authorization: `Bearer ${token}` },
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { token: 'old' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.create({ title: 'New' })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-new'])

    rerender({ token: 'new' })
    await waitFor(() => expect(result.current.sessions).toEqual([]))

    await act(async () => {
      oldHeaderRefresh.resolve(jsonResponse([session('pi-new')]))
      await oldHeaderRefresh.promise
    })

    expect(result.current.sessions).toEqual([])
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

  test('retries network-level fetch failures (server restarting) instead of failing terminally', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse([session('pi-after-restart')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      retry: { baseMs: 1, maxMs: 1, maxRetries: 4 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.activeSessionId).toBe('pi-after-restart')
    expect(result.current.error).toBeUndefined()
  })

  test('preserves the current active session while retrying a transient cold-runtime 503 refresh', async () => {
    const remote = remoteFactory()
    const retryResponse = deferred<Response>()
    fetchMock.mockResolvedValueOnce(jsonResponse([session('pi-existing')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
      retry: { baseMs: 1, maxMs: 1, maxRetries: 4 },
    }))

    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-existing'))

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'preparing' } }, 503))
      .mockReturnValueOnce(retryResponse.promise)

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeUndefined()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-existing'])
    expect(result.current.activeSessionId).toBe('pi-existing')
    expect(remote.created).toHaveLength(1)

    await act(async () => {
      retryResponse.resolve(jsonResponse([session('pi-existing')]))
      await refreshPromise
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-existing'])
    expect(result.current.activeSessionId).toBe('pi-existing')
  })

  test('background refresh updates sessions without entering loading state', async () => {
    const remote = remoteFactory()
    const refreshResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-existing', '2026-06-03T00:00:00.000Z')]))
      .mockReturnValueOnce(refreshResponse.promise)

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Session pi-existing' })

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh({ background: true })
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(false)
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Session pi-existing' })

    await act(async () => {
      refreshResponse.resolve(jsonResponse([{
        ...session('pi-existing', '2026-06-05T00:00:00.000Z'),
        title: 'Session pi-existing renamed',
      }]))
      await refreshPromise
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.sessions[0]).toMatchObject({
      id: 'pi-existing',
      title: 'Session pi-existing renamed',
      updatedAt: '2026-06-05T00:00:00.000Z',
    })
  })

  test('background refresh failure preserves current sessions without surfacing an error', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-existing')]))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'metadata refresh failed' } }, 500))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refresh({ background: true })
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-existing'])
    expect(result.current.activeSessionId).toBe('pi-existing')
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
