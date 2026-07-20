// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { SessionSummary } from '../../../../shared/session'
import { clearNativeFirst, NativeFirstSendErrorKind, sendNativeFirst } from '../../pi/nativeFirstSendTransactions'
import { RemotePiSession, type RemotePiSessionOptions } from '../../pi/remotePiSession'
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

const holdNativeFirstAdoption = (() => 0) as unknown as typeof setTimeout

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
    ].sort())
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

  test('reset removes an unsent local draft while retaining durable sessions', async () => {
    const durable = session('pi-durable')
    fetchMock.mockResolvedValue(jsonResponse([durable]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    expect(result.current.sessions.map((item) => item.id)).toContain(localId)

    act(() => { result.current.reset() })

    expect(result.current.sessions).toEqual([durable])
    expect(result.current.activeSessionId).toBeUndefined()
  })

  test('reset removes a local first send until its accepted native receipt adopts once', async () => {
    const nativeResponse = deferred<Response>()
    const native = { ...session('native-after-reset'), nativeSessionId: 'native-after-reset', hasAssistantReply: false }
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockReturnValueOnce(nativeResponse.promise)
      .mockResolvedValueOnce(jsonResponse([native]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    act(() => { result.current.reset() })
    expect(result.current.sessions).toEqual([])

    nativeResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: native.id, session: native }, 202))
    await act(async () => { await expect(prompt).resolves.toMatchObject({ accepted: true }) })

    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual([native.id]))
    expect(result.current.sessions).toHaveLength(1)
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

  test('keeps a capability-gated new chat in browser memory until native Pi adoption', async () => {
    const remote = remoteFactory()
    const persisted = storage()
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([session('pi-native')]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', storage: persisted, localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create({ title: 'Draft' })).id })
    expect(localId).toMatch(/^local-/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.activeSessionId).toBe(localId)
    expect(result.current.activeSession?.ephemeral).toBe(true)
    expect(remote.created.at(-1)?.options).toMatchObject({ sessionId: localId, autoStart: false })
    expect(remote.created.at(-1)?.options.nativeFirstPrompt).toBeDefined()
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBeUndefined()

    act(() => result.current.adoptNative(localId, session('pi-native')))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-native'))
    expect(result.current.activeSession?.ephemeral).toBe(false)
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-native'])
  })

  test('releases terminal local first sends when unmounted', async () => {
    const dataSource = '\n\nscope-a'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const terminalRequest = vi.fn(async () => { throw terminal })
    fetchMock.mockResolvedValue(jsonResponse([]))

    const { result, unmount } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    for (let index = 0; index < 32; index += 1) {
      let localId = ''
      await act(async () => { localId = (await result.current.create()).id })
      await expect(sendNativeFirst<string>(dataSource, localId, 1_000, 'terminal', terminalRequest, () => NativeFirstSendErrorKind.TerminalUnknown))
        .rejects.toBe(terminal)
    }

    const blockedRequest = vi.fn(async () => 'blocked')
    await expect(sendNativeFirst<string>(dataSource, 'local-blocked', 1_000, 'blocked', blockedRequest, () => NativeFirstSendErrorKind.Definite))
      .rejects.toMatchObject({ errorCode: ErrorCode.enum.SESSION_LOCKED })
    expect(blockedRequest).not.toHaveBeenCalled()

    unmount()

    const acceptedRequest = vi.fn(async () => 'accepted')
    await expect(sendNativeFirst<string>(dataSource, 'local-accepted', 1_000, 'accepted', acceptedRequest, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('accepted')
    expect(acceptedRequest).toHaveBeenCalledOnce()
    clearNativeFirst(dataSource, 'local-accepted')
  })

  test('reset releases terminal local first sends', async () => {
    const dataSource = '\n\nscope-a'
    const terminal = Object.assign(new Error('outcome unknown'), {
      errorCode: ErrorCode.enum.NATIVE_SESSION_START_OUTCOME_UNKNOWN,
    })
    const terminalRequest = vi.fn(async () => { throw terminal })
    fetchMock.mockResolvedValue(jsonResponse([]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    for (let index = 0; index < 32; index += 1) {
      let localId = ''
      await act(async () => { localId = (await result.current.create()).id })
      await expect(sendNativeFirst<string>(dataSource, localId, 1_000, 'terminal', terminalRequest, () => NativeFirstSendErrorKind.TerminalUnknown))
        .rejects.toBe(terminal)
    }

    act(() => { result.current.reset() })
    expect(result.current.sessions).toEqual([])

    const acceptedRequest = vi.fn(async () => 'accepted')
    await expect(sendNativeFirst<string>(dataSource, 'local-accepted-after-reset', 1_000, 'accepted', acceptedRequest, () => NativeFirstSendErrorKind.Definite))
      .resolves.toBe('accepted')
    expect(acceptedRequest).toHaveBeenCalledOnce()
    clearNativeFirst(dataSource, 'local-accepted-after-reset')
  })

  test('completes a deferred native first receipt after unmount and clears its transaction', async () => {
    const dataSource = '\n\nscope-a'
    const nativeResponse = deferred<Response>()
    const nativeSession = { ...session('native-after-unmount'), nativeSessionId: 'native-after-unmount', hasAssistantReply: false }
    const fetch = vi.fn((url: string) => (
      url.endsWith('/sessions/native-prompt')
        ? nativeResponse.promise
        : Promise.resolve(jsonResponse([]))
    ))
    const { result, unmount } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetch as unknown as typeof globalThis.fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    unmount()
    nativeResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: 'native-after-unmount', session: nativeSession }, 202))
    await expect(prompt).resolves.toMatchObject({ accepted: true })

    const nextRequest = vi.fn(async () => 'next')
    await waitFor(async () => {
      await expect(sendNativeFirst<string>(dataSource, localId, 1_000, 'next', nextRequest, () => NativeFirstSendErrorKind.Definite))
        .resolves.toBe('next')
    })
    expect(nextRequest).toHaveBeenCalledOnce()
    clearNativeFirst(dataSource, localId)
  })

  test('orders native adoptions, local drafts, and server refreshes without changing the active session', async () => {
    const remote = remoteFactory()
    const nativeB = { ...session('pi-b', '2026-06-03T00:00:00.000Z'), title: 'B' }
    const renamedB = { ...nativeB, title: 'B renamed' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([nativeB]))
      .mockResolvedValueOnce(jsonResponse(renamedB))
      .mockResolvedValueOnce(jsonResponse([renamedB]))
    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    let a!: SessionSummary
    await act(async () => { a = await result.current.create({ title: 'A' }) })
    vi.setSystemTime(new Date('2026-06-02T00:00:00.000Z'))
    let b!: SessionSummary
    await act(async () => { b = await result.current.create({ title: 'B draft' }) })
    act(() => result.current.switch(a.id))

    await act(async () => {
      result.current.adoptNative(b.id, nativeB)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-b', a.id])
    expect(result.current.activeSessionId).toBe(a.id)

    vi.setSystemTime(new Date('2026-06-04T00:00:00.000Z'))
    let c!: SessionSummary
    await act(async () => { c = await result.current.create({ title: 'C' }) })
    expect(result.current.sessions.map((item) => item.id)).toEqual([c.id, 'pi-b', a.id])

    act(() => result.current.switch(a.id))
    await act(async () => { await result.current.rename('pi-b', 'B renamed') })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current.sessions.map((item) => item.id)).toEqual([c.id, 'pi-b', a.id])
    expect(result.current.activeSessionId).toBe(a.id)
  })

  test('deletes the settled native transcript when a local first send is discarded in flight', async () => {
    const nativeResponse = deferred<Response>()
    const nativeReceipt = {
      accepted: true,
      cursor: 1,
      clientNonce: 'nonce',
      nativeSessionId: 'native-1',
      session: { ...session('native-1'), nativeSessionId: 'native-1', hasAssistantReply: false },
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockReturnValueOnce(nativeResponse.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const deletion = result.current.delete(localId)

    nativeResponse.resolve(jsonResponse(nativeReceipt, 202))
    await act(async () => {
      await expect(deletion).resolves.toBeUndefined()
      await expect(prompt).resolves.toMatchObject({ accepted: true })
    })

    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/sessions/native-prompt') && init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions/native-1', {
      method: 'DELETE',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    await waitFor(() => expect(result.current.sessions).toEqual([]))
    expect(result.current.activeSessionId).toBeUndefined()
  })

  test('deletes a settled local draft before deferred native adoption without recreating it', async () => {
    try {
      const nativeReceipt = {
        accepted: true,
        cursor: 1,
        clientNonce: 'nonce',
        nativeSessionId: 'native-1',
        session: { ...session('native-1'), nativeSessionId: 'native-1', hasAssistantReply: false },
      }
      const onAdopts: ReturnType<typeof vi.fn>[] = []
      const createNativeRemote = vi.fn((options: RemotePiSessionOptions) => {
        const onAdopt = vi.fn((native: SessionSummary) => options.nativeFirstPrompt?.onAdopt(native))
        if (options.nativeFirstPrompt) onAdopts.push(onAdopt)
        return new RemotePiSession({
          ...options,
          nativeFirstPrompt: options.nativeFirstPrompt ? { onAdopt } : undefined,
        })
      })
      fetchMock
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(nativeReceipt, 202))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(jsonResponse([]))

      const { result } = renderHook(() => usePiSessions({
        storageScope: 'scope-a', localCreateUntilPrompt: true,
        fetch: fetchMock as unknown as typeof fetch, createRemoteSession: createNativeRemote,
      }))
      await waitFor(() => expect(result.current.loading).toBe(false))
      vi.useFakeTimers()

      let localId = ''
      await act(async () => { localId = (await result.current.create()).id })
      const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
      await act(async () => { await expect(prompt).resolves.toMatchObject({ accepted: true }) })
      expect(onAdopts).toHaveLength(1)
      expect(onAdopts[0]).not.toHaveBeenCalled()

      await act(async () => { await expect(result.current.delete(localId)).resolves.toBeUndefined() })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })

      expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/sessions/native-1') && init?.method === 'DELETE')).toHaveLength(1)
      expect(onAdopts[0]).not.toHaveBeenCalled()
      expect(result.current.sessions).toEqual([])
      expect(result.current.activeSessionId).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('retains the native retry target when deleting a settled local draft fails', async () => {
    const nativeResponse = deferred<Response>()
    const nativeReceipt = {
      accepted: false,
      clientNonce: 'nonce',
      nativeSessionId: 'native-2',
      session: { ...session('native-2'), nativeSessionId: 'native-2', hasAssistantReply: false },
      error: { code: ErrorCode.enum.SESSION_LOCKED, message: 'first prompt failed', retryable: true },
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockReturnValueOnce(nativeResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ error: 'delete failed' }, 500))
      .mockResolvedValueOnce(jsonResponse([nativeReceipt.session]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const deletion = result.current.delete(localId)

    nativeResponse.resolve(jsonResponse(nativeReceipt, 202))
    await act(async () => {
      await expect(deletion).rejects.toThrow('Failed to delete session: 500')
      await expect(prompt).rejects.toMatchObject({ errorCode: ErrorCode.enum.SESSION_LOCKED })
    })

    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['native-2']))
    expect(result.current.error).toMatchObject({ message: 'Failed to delete session: 500' })
  })

  test('does not update scope B when a deferred local delete from scope A succeeds', async () => {
    const deleteResponse = deferred<Response>()
    const nativeSession = { ...session('a-native'), nativeSessionId: 'a-native', hasAssistantReply: false }
    const fetchA = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/sessions/native-prompt')) return Promise.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: 'a-native', session: nativeSession }, 202))
      if (url.endsWith('/sessions/a-native') && init?.method === 'DELETE') return deleteResponse.promise
      return Promise.resolve(jsonResponse([]))
    })
    const fetchB = vi.fn(() => Promise.resolve(jsonResponse([session('b-session')])))
    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        localCreateUntilPrompt: true,
        fetch: (scope === 'scope-a' ? fetchA : fetchB) as unknown as typeof fetch,
        remoteSessionOptions: { autoStart: false, setTimeoutFn: holdNativeFirstAdoption },
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    await act(async () => { await expect(result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })).resolves.toMatchObject({ accepted: true }) })
    const deletion = result.current.delete(localId)
    await waitFor(() => expect(fetchA).toHaveBeenCalledTimes(3))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session']))

    deleteResponse.resolve(new Response(null, { status: 204 }))
    await act(async () => { await expect(deletion).resolves.toBeUndefined() })

    expect(fetchA).toHaveBeenCalledWith('/api/v1/agent/pi-chat/sessions/a-native', {
      method: 'DELETE',
      headers: { 'x-boring-storage-scope': 'scope-a' },
    })
    expect(fetchB).toHaveBeenCalledOnce()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session'])
    expect(result.current.activeSessionId).toBe('b-session')
    expect(result.current.error).toBeUndefined()
  })

  test('rejects a deferred scope A local delete without updating scope B and leaves A canonical', async () => {
    const deleteResponse = deferred<Response>()
    const nativeSession = { ...session('a-native'), nativeSessionId: 'a-native', hasAssistantReply: false }
    let aRows: SessionSummary[] = []
    const fetchA = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/sessions/native-prompt')) return Promise.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: 'a-native', session: nativeSession }, 202))
      if (url.endsWith('/sessions/a-native') && init?.method === 'DELETE') return deleteResponse.promise
      return Promise.resolve(jsonResponse(aRows))
    })
    const fetchB = vi.fn(() => Promise.resolve(jsonResponse([session('b-session')])))
    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        localCreateUntilPrompt: true,
        fetch: (scope === 'scope-a' ? fetchA : fetchB) as unknown as typeof fetch,
        remoteSessionOptions: { autoStart: false, setTimeoutFn: holdNativeFirstAdoption },
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    await act(async () => { await expect(result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })).resolves.toMatchObject({ accepted: true }) })
    const deletion = result.current.delete(localId)
    await waitFor(() => expect(fetchA).toHaveBeenCalledTimes(3))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session']))

    deleteResponse.resolve(jsonResponse({ error: 'delete failed' }, 500))
    await act(async () => { await expect(deletion).rejects.toThrow('Failed to delete session: 500') })

    expect(fetchB).toHaveBeenCalledOnce()
    expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session'])
    expect(result.current.activeSessionId).toBe('b-session')
    expect(result.current.error).toBeUndefined()

    aRows = [nativeSession]
    rerender({ scope: 'scope-a' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['a-native']))
    expect(result.current.error).toBeUndefined()
  })

  test('does not treat persisted server local-* IDs as ephemeral', async () => {
    const remote = remoteFactory()
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'local-work' })
    fetchMock.mockResolvedValue(jsonResponse([session('local-work')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', storage: persisted, localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.activeSessionId).toBe('local-work'))
    await waitFor(() => expect(remote.created.at(-1)?.options).toMatchObject({ sessionId: 'local-work' }))
    expect(result.current.activeSession?.ephemeral).toBeUndefined()
    expect(remote.created.at(-1)?.options.nativeFirstPrompt).toBeUndefined()
  })

  test('keeps the destination persisted active id when clearing a local session across scopes', async () => {
    const remote = remoteFactory()
    const persisted = storage({ [activeSessionStorageKey('scope-b')]: 'b-2' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([session('b-2')]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        storage: persisted,
        localCreateUntilPrompt: true,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.create() })
    rerender({ scope: 'scope-b' })

    await waitFor(() => expect(result.current.activeSessionId).toBe('b-2'))
    expect(persisted.values.get(activeSessionStorageKey('scope-b'))).toBe('b-2')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/agent/pi-chat/sessions?activeSessionId=b-2', {
      headers: { 'x-boring-storage-scope': 'scope-b' },
    })
  })

  test('ignores a late local adoption after its data source changes and finds the native session on return', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([session('a-native')]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        localCreateUntilPrompt: true,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    const lateAdopt = remote.created.at(-1)?.options.nativeFirstPrompt?.onAdopt
    expect(lateAdopt).toBeDefined()

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => lateAdopt?.(session('a-native')))

    expect(result.current.sessions).toEqual([])
    expect(result.current.activeSessionId).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rerender({ scope: 'scope-a' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['a-native']))
    expect(result.current.activeSessionId).toBe('a-native')
  })

  test('keeps the active source unchanged when an old-source native receipt settles', async () => {
    const nativeResponse = deferred<Response>()
    const nativeSession = { ...session('a-native'), nativeSessionId: 'a-native', hasAssistantReply: false }
    let aRows: SessionSummary[] = []
    const fetchA = vi.fn((url: string) => (
      url.endsWith('/sessions/native-prompt')
        ? nativeResponse.promise
        : Promise.resolve(jsonResponse(aRows))
    ))
    const fetchB = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse([session('b-session')])))
    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        localCreateUntilPrompt: true,
        fetch: (scope === 'scope-a' ? fetchA : fetchB) as unknown as typeof fetch,
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.create() })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetchA).toHaveBeenCalledTimes(2))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session']))

    vi.useFakeTimers()
    nativeResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: 'a-native', session: nativeSession }, 202))
    await act(async () => {
      await expect(prompt).resolves.toMatchObject({ accepted: true })
      await vi.advanceTimersByTimeAsync(0)
    })
    vi.useRealTimers()

    expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session'])
    expect(fetchB.mock.calls.some(([url]) => url.endsWith('/sessions/native-prompt'))).toBe(false)

    aRows = [nativeSession]
    rerender({ scope: 'scope-a' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['a-native']))
  })

  test('adopts one native receipt when the original source returns before it settles', async () => {
    const nativeResponse = deferred<Response>()
    const nativeSession = { ...session('a-native'), nativeSessionId: 'a-native', hasAssistantReply: false }
    const fetchA = vi.fn((url: string) => (
      url.endsWith('/sessions/native-prompt')
        ? nativeResponse.promise
        : Promise.resolve(jsonResponse([]))
    ))
    const fetchB = vi.fn(() => Promise.resolve(jsonResponse([session('b-session')])))
    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        localCreateUntilPrompt: true,
        fetch: (scope === 'scope-a' ? fetchA : fetchB) as unknown as typeof fetch,
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.create() })
    const prompt = result.current.activePiSession!.prompt({ message: 'hello', clientNonce: 'nonce' })
    await waitFor(() => expect(fetchA).toHaveBeenCalledTimes(2))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-session']))
    rerender({ scope: 'scope-a' })
    await waitFor(() => expect(result.current.sessions).toEqual([]))

    vi.useFakeTimers()
    nativeResponse.resolve(jsonResponse({ accepted: true, cursor: 1, clientNonce: 'nonce', nativeSessionId: 'a-native', session: nativeSession }, 202))
    await act(async () => {
      await expect(prompt).resolves.toMatchObject({ accepted: true })
      await vi.advanceTimersByTimeAsync(0)
    })
    vi.useRealTimers()

    await waitFor(() => expect(result.current.sessions.filter((item) => item.id === 'a-native')).toEqual([expect.objectContaining({ ephemeral: false })]))
  })

  test('does not carry an unsent local session into a different storage/workspace scope', async () => {
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([session('b-native')]))

    const { result, rerender } = renderHook(
      ({ storageScope, workspaceId }) => usePiSessions({
        storageScope,
        workspaceId,
        localCreateUntilPrompt: true,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { storageScope: 'scope-a', workspaceId: 'workspace-a' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let localId = ''
    await act(async () => { localId = (await result.current.create()).id })
    expect(result.current.activeSessionId).toBe(localId)

    rerender({ storageScope: 'scope-b', workspaceId: 'workspace-b' })

    await waitFor(() => expect(result.current.sessions.map((item) => item.id)).toEqual(['b-native']))
    expect(result.current.activeSessionId).toBe('b-native')
    expect(remote.created.some(({ options }) => options.storageScope === 'scope-b' && options.sessionId === localId)).toBe(false)
  })

  test('keeps browser-local drafts newest-first across refresh without changing the active draft', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', localCreateUntilPrompt: true,
      fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let first!: SessionSummary
    let second!: SessionSummary
    await act(async () => { first = await result.current.create({ title: 'First draft' }) })
    await act(async () => { second = await result.current.create({ title: 'Second draft' }) })
    expect(result.current.sessions.map((item) => item.id)).toEqual([second.id, first.id])
    expect(result.current.activeSessionId).toBe(second.id)

    fetchMock.mockResolvedValueOnce(jsonResponse([session('pi-canonical')]))
    await act(async () => { await result.current.refresh() })

    expect(result.current.sessions.map((item) => item.id)).toEqual([second.id, first.id, 'pi-canonical'])
    expect(result.current.activeSessionId).toBe(second.id)
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

  test('ignores a rename completion from an old scope without disturbing the new scope', async () => {
    const remote = remoteFactory()
    const renameResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('a-0')]))
      .mockReturnValueOnce(renameResponse.promise)
      .mockResolvedValueOnce(jsonResponse([{ ...session('a-0'), title: 'Scope B title' }]))

    const { result, rerender } = renderHook(
      ({ scope }) => usePiSessions({
        storageScope: scope,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession: remote.factory,
      }),
      { initialProps: { scope: 'scope-a' } },
    )
    await waitFor(() => expect(result.current.activeSessionId).toBe('a-0'))

    let rename!: Promise<SessionSummary>
    act(() => { rename = result.current.rename('a-0', 'Renamed A') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    rerender({ scope: 'scope-b' })
    await waitFor(() => expect(result.current.sessions[0]).toMatchObject({ id: 'a-0', title: 'Scope B title' }))

    await act(async () => {
      renameResponse.resolve(jsonResponse({ ...session('a-0'), title: 'Renamed A' }))
      await expect(rename).resolves.toMatchObject({ id: 'a-0', title: 'Renamed A' })
    })

    expect(result.current.sessions).toEqual([expect.objectContaining({ id: 'a-0', title: 'Scope B title' })])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('rename protects against a stale refresh, then accepts the first later canonical title', async () => {
    const remote = remoteFactory()
    const staleRefresh = deferred<Response>()
    const canonicalRefresh = deferred<Response>()
    fetchMock.mockResolvedValueOnce(jsonResponse([session('pi-existing')]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    fetchMock.mockReturnValueOnce(staleRefresh.promise)
    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...session('pi-existing'), title: 'Renamed' }))
      .mockReturnValueOnce(canonicalRefresh.promise)
    await act(async () => {
      await result.current.rename('pi-existing', 'Renamed')
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Renamed' })
    expect(result.current.loading).toBe(false)

    await act(async () => {
      staleRefresh.resolve(jsonResponse([session('pi-existing')]))
      await refreshPromise
    })
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Renamed' })

    await act(async () => {
      canonicalRefresh.resolve(jsonResponse([{ ...session('pi-existing'), title: 'Externally renamed' }]))
      await canonicalRefresh.promise
    })
    await waitFor(() => expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Externally renamed' }))
    expect(result.current.loading).toBe(false)
  })

  test('rename protects against a stale load-more response and settles its loading flags', async () => {
    const remote = remoteFactory()
    const staleLoadMore = deferred<Response>()
    const canonicalRefresh = deferred<Response>()
    const firstPage = [session('pi-existing'), ...Array.from({ length: 49 }, (_, index) => session(`pi-${index}`))]
    fetchMock.mockResolvedValueOnce(jsonResponse(firstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))
    fetchMock.mockReturnValueOnce(staleLoadMore.promise)
    act(() => { void result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...session('pi-existing'), title: 'Renamed' }))
      .mockReturnValueOnce(canonicalRefresh.promise)
    await act(async () => { await result.current.rename('pi-existing', 'Renamed') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    await act(async () => {
      staleLoadMore.resolve(jsonResponse([session('pi-existing')]))
      await staleLoadMore.promise
    })

    expect(result.current.sessions.find((item) => item.id === 'pi-existing')).toMatchObject({ title: 'Renamed' })
    expect(result.current.loading).toBe(false)
    expect(result.current.loadingMore).toBe(false)

    await act(async () => {
      canonicalRefresh.resolve(jsonResponse([{ ...session('pi-existing'), title: 'Externally renamed' }, ...firstPage.slice(1)]))
      await canonicalRefresh.promise
    })
    await waitFor(() => expect(result.current.sessions.find((item) => item.id === 'pi-existing')).toMatchObject({ title: 'Externally renamed' }))
    expect(result.current.loading).toBe(false)
    expect(result.current.loadingMore).toBe(false)
  })

  test('failed rename does not strand a deferred load-more spinner', async () => {
    const remote = remoteFactory()
    const staleLoadMore = deferred<Response>()
    const firstPage = Array.from({ length: 50 }, (_, index) => session(`pi-${index}`))
    fetchMock.mockResolvedValueOnce(jsonResponse(firstPage))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))
    fetchMock.mockReturnValueOnce(staleLoadMore.promise)
    act(() => { void result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    await expect(result.current.rename('pi-0', 'Renamed')).rejects.toThrow('Failed to rename session: 500')
    expect(result.current.loadingMore).toBe(true)

    await act(async () => {
      staleLoadMore.resolve(jsonResponse([]))
      await staleLoadMore.promise
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.loadingMore).toBe(false)
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
