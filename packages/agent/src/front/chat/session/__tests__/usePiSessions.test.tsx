// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { Suspense, startTransition, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/error-codes'
import type { SessionSummary } from '../../../../shared/session'
import { RemotePiSession, type RemotePiSessionOptions } from '../../pi/remotePiSession'
import { activeSessionStorageKey, bootResumeSessionStorageKey, type ActiveSessionStorageLike } from '../activeSessionStorage'
import { usePiSessions } from '../usePiSessions'

function session(id: string, updatedAt = '2026-06-03T00:00:00.000Z'): SessionSummary {
  return { id, title: `Session ${id}`, createdAt: updatedAt, updatedAt, turnCount: 0 }
}

function addressedBootResumeKey({
  agentTypeId = 'alpha',
  apiBaseUrl = '',
  workspaceId,
  storageScope = 'scope-a',
}: {
  agentTypeId?: string
  apiBaseUrl?: string
  workspaceId?: string
  storageScope?: string
} = {}): string {
  return bootResumeSessionStorageKey({
    apiBaseUrl,
    sessionsApiPath: `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`,
    agentTypeId,
    workspaceId,
    storageScope,
  })
}

function addressedSession(id: string) {
  return {
    ref: { agentTypeId: 'alpha', sessionId: id },
    title: `Session ${id}`,
    status: 'idle',
    createdAt: Date.parse('2026-06-03T00:00:00.000Z'),
    updatedAt: Date.parse('2026-06-03T00:00:00.000Z'),
    turnCount: 1,
  }
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

  test('preserves a tab-owned hidden addressed id for exact boot resume without connecting it', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-hidden-empty' })
    const tabStorage = storage({ [addressedBootResumeKey()]: 'pi-hidden-empty' })
    const remote = remoteFactory()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [addressedSession('pi-visible')] }))
      .mockResolvedValueOnce(jsonResponse({ agentTypeId: 'alpha', sessionId: 'pi-hidden-empty' }, 201))
      .mockResolvedValue(jsonResponse({ sessions: [addressedSession('pi-visible')] }))

    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      storageScope: 'scope-a',
      storage: persisted,
      bootResumeStorage: tabStorage,
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-visible'])
    expect(result.current.activeSessionId).toBeUndefined()
    expect(result.current.resumeSessionId).toBe('pi-hidden-empty')
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-hidden-empty')
    expect(tabStorage.values.get(addressedBootResumeKey())).toBe('pi-hidden-empty')
    expect(remote.factory).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.create({ title: 'Boot', resumeSessionId: result.current.resumeSessionId })
    })
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      title: 'Boot',
      resumeSessionId: 'pi-hidden-empty',
    })
    expect(result.current.activeSessionId).toBe('pi-hidden-empty')
    expect(result.current.resumeSessionId).toBeUndefined()
  })

  test('never exposes a persisted addressed id as active before listing validates it', async () => {
    const persisted = storage({ [activeSessionStorageKey('scope-a')]: 'pi-hidden-empty' })
    const tabStorage = storage({ [addressedBootResumeKey()]: 'pi-hidden-empty' })
    const listResponse = deferred<Response>()
    fetchMock.mockReturnValueOnce(listResponse.promise)

    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      storageScope: 'scope-a',
      storage: persisted,
      bootResumeStorage: tabStorage,
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
    }))

    expect(result.current.loading).toBe(true)
    expect(result.current.activeSessionId).toBeUndefined()
    expect(result.current.activeSession).toBeUndefined()
    expect(result.current.resumeSessionId).toBe('pi-hidden-empty')

    await act(async () => {
      listResponse.resolve(jsonResponse({ sessions: [addressedSession('pi-hidden-empty')] }))
      await listResponse.promise
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activeSessionId).toBe('pi-hidden-empty')
    expect(result.current.resumeSessionId).toBeUndefined()
    expect(tabStorage.values.has(addressedBootResumeKey())).toBe(false)
  })

  test('keeps hidden boot resume ownership isolated between tabs sharing active preference storage', async () => {
    const sharedActiveStorage = storage({ [activeSessionStorageKey('scope-a')]: 'pi-tab-a-empty' })
    const tabAStorage = storage({ [addressedBootResumeKey()]: 'pi-tab-a-empty' })
    const tabBStorage = storage()
    const fetchA = vi.fn().mockResolvedValue(jsonResponse({ sessions: [] }))
    const fetchB = vi.fn().mockResolvedValue(jsonResponse({ sessions: [] }))

    const tabA = renderHook(() => usePiSessions({
      agentTypeId: 'alpha', storageScope: 'scope-a', storage: sharedActiveStorage, bootResumeStorage: tabAStorage,
      fetch: fetchA as unknown as typeof fetch, connectActiveSession: false,
    }))
    const tabB = renderHook(() => usePiSessions({
      agentTypeId: 'alpha', storageScope: 'scope-a', storage: sharedActiveStorage, bootResumeStorage: tabBStorage,
      fetch: fetchB as unknown as typeof fetch, connectActiveSession: false,
    }))

    await waitFor(() => expect(tabA.result.current.loading).toBe(false))
    await waitFor(() => expect(tabB.result.current.loading).toBe(false))
    expect(tabA.result.current.resumeSessionId).toBe('pi-tab-a-empty')
    expect(tabB.result.current.resumeSessionId).toBeUndefined()
    expect(tabBStorage.values.has(addressedBootResumeKey())).toBe(false)
  })

  test.each([
    { name: 'agent', initialAgent: 'alpha', nextAgent: 'beta', initialApiBaseUrl: '', nextApiBaseUrl: '' },
    { name: 'API base', initialAgent: 'alpha', nextAgent: 'alpha', initialApiBaseUrl: '/source-a/', nextApiBaseUrl: '/source-b' },
  ])('does not expose another $name source boot candidate after a same-tab switch', async ({ initialAgent, nextAgent, initialApiBaseUrl, nextApiBaseUrl }) => {
    const tabStorage = storage({
      [addressedBootResumeKey({ agentTypeId: initialAgent, apiBaseUrl: initialApiBaseUrl })]: 'old-source-empty',
    })
    const sourceFetch = vi.fn().mockImplementation(async () => jsonResponse({ sessions: [] }))
    const { result, rerender } = renderHook(
      ({ agentTypeId, apiBaseUrl }) => usePiSessions({
        agentTypeId,
        apiBaseUrl,
        storageScope: 'scope-a',
        bootResumeStorage: tabStorage,
        fetch: sourceFetch as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { agentTypeId: initialAgent, apiBaseUrl: initialApiBaseUrl } },
    )

    await waitFor(() => expect(result.current.resumeSessionId).toBe('old-source-empty'))
    rerender({ agentTypeId: nextAgent, apiBaseUrl: nextApiBaseUrl })

    expect(result.current.resumeSessionId).toBeUndefined()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.resumeSessionId).toBeUndefined()
    expect(sourceFetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })

  test('isolates fixed-path boot ownership and late mutations across an alpha to beta switch', async () => {
    const persisted = storage()
    const fixedPath = '/custom/sessions'
    const alphaBootKey = bootResumeSessionStorageKey({
      sessionsApiPath: fixedPath, agentTypeId: 'alpha', workspaceId: 'workspace-a', storageScope: 'workspace-a',
    })
    const betaBootKey = bootResumeSessionStorageKey({
      sessionsApiPath: fixedPath, agentTypeId: 'beta', workspaceId: 'workspace-a', storageScope: 'workspace-a',
    })
    const tabStorage = storage({ [alphaBootKey]: 'alpha-empty' })
    const createResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
      .mockReturnValueOnce(createResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ sessions: [{ ...addressedSession('beta-visible'), ref: { agentTypeId: 'beta', sessionId: 'beta-visible' } }] }))

    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        sessionsApiPath: fixedPath,
        workspaceId: 'workspace-a',
        storageScope: 'workspace-a',
        storage: persisted,
        bootResumeStorage: tabStorage,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )
    await waitFor(() => expect(result.current.resumeSessionId).toBe('alpha-empty'))

    let createPromise!: Promise<SessionSummary>
    act(() => { createPromise = result.current.create({ title: 'Old source' }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    rerender({ agentTypeId: 'beta' })
    expect(result.current.resumeSessionId).toBeUndefined()
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-visible'))

    await act(async () => {
      createResponse.resolve(jsonResponse({ agentTypeId: 'alpha', sessionId: 'alpha-late' }, 201))
      await expect(createPromise).resolves.toMatchObject({ id: 'alpha-late' })
    })

    expect(alphaBootKey).not.toBe(betaBootKey)
    expect(result.current.sessions.map((item) => item.id)).toEqual(['beta-visible'])
    expect(result.current.activeSessionId).toBe('beta-visible')
    expect(tabStorage.values.get(alphaBootKey)).toBe('alpha-empty')
    expect(tabStorage.values.has(betaBootKey)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('fences deferred create, rename, and delete completions when only sourceIdentity changes', async () => {
    const createResponse = deferred<Response>()
    const renameResponse = deferred<Response>()
    const deleteResponse = deferred<Response>()
    let listRequests = 0
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return createResponse.promise
      if (init?.method === 'PATCH') return renameResponse.promise
      if (init?.method === 'DELETE') return deleteResponse.promise
      listRequests += 1
      return Promise.resolve(jsonResponse([session(listRequests === 1 ? 'alpha-row' : 'beta-row')]))
    })

    const { result, rerender } = renderHook(
      ({ sourceIdentity }) => usePiSessions({
        storageScope: 'scope-a',
        sourceIdentity,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { sourceIdentity: 'identity-alpha' } },
    )
    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-row'))

    let createPromise!: Promise<SessionSummary>
    let renamePromise!: Promise<SessionSummary>
    let deletePromise!: Promise<void>
    act(() => {
      createPromise = result.current.create({ title: 'Old create' })
      renamePromise = result.current.rename('alpha-row', 'Old rename')
      deletePromise = result.current.delete('alpha-row')
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    rerender({ sourceIdentity: 'identity-beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-row'))
    expect(result.current.sourceIdentity).toBe('identity-beta')

    await act(async () => {
      createResponse.resolve(jsonResponse(session('created-by-alpha'), 201))
      renameResponse.resolve(jsonResponse({ ...session('alpha-row'), title: 'Old rename' }))
      deleteResponse.resolve(new Response(null, { status: 204 }))
      await expect(createPromise).resolves.toMatchObject({ id: 'created-by-alpha' })
      await expect(renamePromise).resolves.toMatchObject({ id: 'alpha-row', title: 'Old rename' })
      await expect(deletePromise).resolves.toBeUndefined()
    })

    expect(result.current.sessions.map((item) => item.id)).toEqual(['beta-row'])
    expect(result.current.activeSessionId).toBe('beta-row')
    expect(listRequests).toBe(2)
  })

  test('drops optimistic create and boot confirmation on a sourceIdentity-only transition', async () => {
    const staleRefresh = deferred<Response>()
    const tabStorage = storage()
    let listRequests = 0
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ agentTypeId: 'alpha', sessionId: 'optimistic-old-source' }, 201))
      }
      listRequests += 1
      if (listRequests === 1) return Promise.resolve(jsonResponse({ sessions: [addressedSession('existing')] }))
      if (listRequests === 2) return staleRefresh.promise
      return Promise.resolve(jsonResponse({ sessions: [] }))
    })

    const { result, rerender } = renderHook(
      ({ sourceIdentity }) => usePiSessions({
        agentTypeId: 'alpha',
        storageScope: 'scope-a',
        sourceIdentity,
        bootResumeStorage: tabStorage,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { sourceIdentity: 'source-a' } },
    )
    await waitFor(() => expect(result.current.activeSessionId).toBe('existing'))

    await act(async () => {
      await result.current.create({ title: 'Optimistic old source' })
    })
    expect(result.current.sessions.map((item) => item.id)).toContain('optimistic-old-source')
    expect(tabStorage.values.get(addressedBootResumeKey())).toBe('optimistic-old-source')
    await waitFor(() => expect(listRequests).toBe(2))

    rerender({ sourceIdentity: 'source-b' })
    await waitFor(() => expect(result.current.sourceIdentity).toBe('source-b'))

    expect(result.current.sessions).toEqual([])
    expect(result.current.activeSessionId).toBeUndefined()
    expect(result.current.resumeSessionId).toBe('optimistic-old-source')
  })

  test('drops an optimistic rename across a disabled then enabled transition', async () => {
    const staleRefresh = deferred<Response>()
    let listRequests = 0
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...session('row'), title: 'Optimistic rename' }))
      }
      listRequests += 1
      if (listRequests === 2) return staleRefresh.promise
      return Promise.resolve(jsonResponse([{ ...session('row'), title: 'Canonical title' }]))
    })

    const { result, rerender } = renderHook(
      ({ enabled }) => usePiSessions({
        storageScope: 'scope-a',
        sourceIdentity: 'same-source',
        enabled,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.activeSessionId).toBe('row'))

    await act(async () => {
      await result.current.rename('row', 'Optimistic rename')
    })
    expect(result.current.sessions[0]?.title).toBe('Optimistic rename')
    await waitFor(() => expect(listRequests).toBe(2))

    rerender({ enabled: false })
    await waitFor(() => expect(result.current.sessions).toEqual([]))
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.sourceIdentity).toBe('same-source'))

    expect(result.current.sessions).toEqual([expect.objectContaining({ id: 'row', title: 'Canonical title' })])
  })

  test('fences deferred create, load-more, and refresh completions when sessions are disabled', async () => {
    const createResponse = deferred<Response>()
    const loadMoreResponse = deferred<Response>()
    const refreshResponse = deferred<Response>()
    let listRequests = 0
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === 'POST') return createResponse.promise
      listRequests += 1
      if (listRequests === 1) return Promise.resolve(jsonResponse(Array.from({ length: 50 }, (_, index) => session(`row-${index}`))))
      if (listRequests === 2) return loadMoreResponse.promise
      return refreshResponse.promise
    })

    const { result, rerender } = renderHook(
      ({ enabled }) => usePiSessions({
        storageScope: 'scope-a',
        enabled,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    let createPromise!: Promise<SessionSummary>
    let loadMorePromise!: Promise<void>
    let refreshPromise!: Promise<void>
    act(() => {
      createPromise = result.current.create({ title: 'Late create' })
      loadMorePromise = result.current.loadMore()
      refreshPromise = result.current.refresh()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    rerender({ enabled: false })
    await waitFor(() => expect(result.current.sessions).toEqual([]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      createResponse.resolve(jsonResponse(session('late-created'), 201))
      loadMoreResponse.resolve(jsonResponse([session('late-page')]))
      refreshResponse.resolve(jsonResponse([session('late-refresh')]))
      await expect(createPromise).resolves.toMatchObject({ id: 'late-created' })
      await expect(loadMorePromise).resolves.toBeUndefined()
      await expect(refreshPromise).resolves.toBeUndefined()
    })

    expect(result.current.sessions).toEqual([])
    expect(result.current.activeSessionId).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test('saved source callbacks are inert after a new source commits, including while its refresh is in flight', async () => {
    const persisted = storage()
    const betaRefresh = deferred<Response>()
    const alphaRows = Array.from({ length: 50 }, (_, index) => ({
      ...addressedSession(index === 0 ? 'shared' : `alpha-${index}`),
      ref: { agentTypeId: 'alpha', sessionId: index === 0 ? 'shared' : `alpha-${index}` },
    }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: alphaRows }))
      .mockReturnValueOnce(betaRefresh.promise)

    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        workspaceId: 'workspace-a',
        storageScope: 'workspace-a',
        storage: persisted,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const savedAlpha = result.current

    vi.mocked(persisted.setItem).mockClear()
    vi.mocked(persisted.removeItem).mockClear()
    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await savedAlpha.refresh()
      await savedAlpha.loadMore()
      savedAlpha.switch('shared')
      savedAlpha.reset()
      await expect(savedAlpha.create({ title: 'stale create' })).rejects.toThrow('Pi sessions source is stale')
      await expect(savedAlpha.rename('shared', 'stale rename')).rejects.toThrow('Pi sessions source is stale')
      await expect(savedAlpha.delete('shared')).rejects.toThrow('Pi sessions source is stale')
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(true)
    expect(persisted.setItem).not.toHaveBeenCalled()
    expect(persisted.removeItem).not.toHaveBeenCalled()

    await act(async () => {
      betaRefresh.resolve(jsonResponse({ sessions: [
        { ...addressedSession('shared'), ref: { agentTypeId: 'beta', sessionId: 'shared' } },
        { ...addressedSession('beta-only'), ref: { agentTypeId: 'beta', sessionId: 'beta-only' } },
      ] }))
      await betaRefresh.promise
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((item) => item.id)).toEqual(['shared', 'beta-only'])
    expect(result.current.activeSessionId).toBe('shared')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('preserves source A in-flight work across an interrupted source B render', async () => {
    const createResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
      .mockReturnValueOnce(createResponse.promise)
    let current!: ReturnType<typeof usePiSessions>
    let transitionToB!: () => void
    let suspendedBRenders = 0
    const never = new Promise<void>(() => {})

    function SuspendB(): null {
      suspendedBRenders += 1
      throw never
    }

    function Harness() {
      const [agentTypeId, setAgentTypeId] = useState('alpha')
      transitionToB = () => startTransition(() => setAgentTypeId('beta'))
      current = usePiSessions({
        agentTypeId,
        sessionsApiPath: '/custom/sessions',
        storageScope: 'scope-a',
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      })
      return agentTypeId === 'beta' ? <SuspendB /> : null
    }

    render(<Suspense fallback={<div>Suspended B</div>}><Harness /></Suspense>)
    await waitFor(() => expect(current.loading).toBe(false))

    let createPromise!: Promise<SessionSummary>
    act(() => { createPromise = current.create({ title: 'Committed A' }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    act(() => { transitionToB() })
    expect(suspendedBRenders).toBeGreaterThan(0)

    await act(async () => {
      createResponse.resolve(jsonResponse({ agentTypeId: 'alpha', sessionId: 'alpha-created' }, 201))
      await createPromise
    })

    expect(current.sessions.map((item) => item.id)).toContain('alpha-created')
    expect(current.activeSessionId).toBe('alpha-created')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('explicit addressed New chat mints and records ordinary active preference plus tab ownership', async () => {
    const persisted = storage()
    const tabStorage = storage()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [addressedSession('pi-visible')] }))
      .mockResolvedValueOnce(jsonResponse({ agentTypeId: 'alpha', sessionId: 'pi-new' }, 201))
      .mockResolvedValue(jsonResponse({ sessions: [addressedSession('pi-visible')] }))

    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha', storageScope: 'scope-a', storage: persisted, bootResumeStorage: tabStorage,
      fetch: fetchMock as unknown as typeof fetch, connectActiveSession: false,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.create({ title: 'New chat' }) })

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ title: 'New chat' })
    expect(result.current.activeSessionId).toBe('pi-new')
    expect(persisted.values.get(activeSessionStorageKey('scope-a'))).toBe('pi-new')
    expect(tabStorage.values.get(addressedBootResumeKey())).toBe('pi-new')
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

  test('keeps the server-selected first session active while sorting the visible list', async () => {
    const remote = remoteFactory()
    fetchMock.mockResolvedValue(jsonResponse([
      session('server-selected', '2026-06-01T00:00:00.000Z'),
      session('newest', '2026-06-03T00:00:00.000Z'),
    ]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(remote.factory).toHaveBeenCalledTimes(1))

    expect(result.current.activeSessionId).toBe('server-selected')
    expect(result.current.sessions.map((item) => item.id)).toEqual(['newest', 'server-selected'])
    expect(remote.created[0]?.options.sessionId).toBe('server-selected')
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
    expect(result.current.error).toEqual(expect.objectContaining({
      kind: 'recoverable',
      message: 'Failed to load sessions: 500',
    }))
    expect(result.current.hasMore).toBe(true)

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

  test('failed delete preserves authoritative rows and remains retryable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-keep')]))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'delete failed' } }, 500))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      sourceIdentity: 'source-a',
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
    }))
    await waitFor(() => expect(result.current.activeSessionId).toBe('pi-keep'))

    await act(async () => {
      await expect(result.current.delete('pi-keep')).rejects.toThrow('Failed to delete session: 500')
    })

    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-keep'])
    expect(result.current.activeSessionId).toBe('pi-keep')
    expect(result.current.sourceIdentity).toBe('source-a')
    expect(result.current.error).toEqual(expect.objectContaining({ kind: 'recoverable' }))

    await act(async () => {
      await result.current.delete('pi-keep')
    })
    await waitFor(() => expect(result.current.sessions).toEqual([]))
    expect(fetchMock).toHaveBeenCalledTimes(4)
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

  test('exits loading and surfaces a terminal network error after retries are exhausted', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('terminal network failure'))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toEqual(expect.objectContaining({
      kind: 'fatal',
      message: 'terminal network failure',
    }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('hides and sanitizes a fatal error immediately on a headers-only source switch', async () => {
    const nextResponse = deferred<Response>()
    const privateError = Object.assign(new Error('scoped load failed'), {
      requestHeaders: { 'x-test-tenant': 'alpha' },
      sourceKey: 'alpha-private-source',
      requestScopeKey: 'alpha-private-scope',
    })
    fetchMock
      .mockRejectedValueOnce(privateError)
      .mockReturnValueOnce(nextResponse.promise)

    const { result, rerender } = renderHook(
      ({ tenant }) => usePiSessions({
        storageScope: 'scope-a',
        sourceIdentity: 'session-source',
        requestHeaders: { 'x-test-tenant': tenant },
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { tenant: 'alpha' } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toEqual(expect.objectContaining({ kind: 'fatal', message: 'scoped load failed' }))
    expect(result.current.error).not.toBe(privateError)
    expect(result.current.error).not.toHaveProperty('requestHeaders')
    expect(result.current.error).not.toHaveProperty('sourceKey')
    expect(result.current.error).not.toHaveProperty('requestScopeKey')
    expect(result.current.sourceIdentity).toBe('session-source')

    const publicError = result.current.error
    rerender({ tenant: 'alpha' })
    expect(result.current.error).toBe(publicError)

    rerender({ tenant: 'beta' })
    expect(result.current.error).toBeUndefined()
    expect(result.current.sourceIdentity).toBeUndefined()

    await act(async () => {
      nextResponse.resolve(jsonResponse([]))
      await nextResponse.promise
    })
  })

  test('hides a fatal error and attestation on a sourceIdentity-only change', async () => {
    const nextResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'first identity failed' } }, 500))
      .mockReturnValueOnce(nextResponse.promise)

    const { result, rerender } = renderHook(
      ({ sourceIdentity }) => usePiSessions({
        storageScope: 'scope-a',
        sourceIdentity,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { sourceIdentity: 'source-a' } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toEqual(expect.objectContaining({ kind: 'fatal', message: 'Failed to load sessions: 500' }))
    expect(result.current.sourceIdentity).toBe('source-a')

    rerender({ sourceIdentity: 'source-b' })

    expect(result.current.error).toBeUndefined()
    expect(result.current.sourceIdentity).toBeUndefined()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    await act(async () => {
      nextResponse.resolve(jsonResponse([]))
      await nextResponse.promise
    })
  })

  test('does not let an old-source fatal error attest a new foreground load', async () => {
    const betaResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'alpha failed' } }, 500))
      .mockReturnValueOnce(betaResponse.promise)

    const { result, rerender } = renderHook(
      ({ agentTypeId, sourceIdentity }) => usePiSessions({
        agentTypeId,
        workspaceId: 'workspace-a',
        storageScope: 'workspace-a',
        sourceIdentity,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha', sourceIdentity: 'alpha-source' } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toEqual(expect.objectContaining({ kind: 'fatal' }))
    expect(result.current.sourceIdentity).toBe('alpha-source')

    rerender({ agentTypeId: 'beta', sourceIdentity: 'beta-source' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeUndefined()
    expect(result.current.sourceIdentity).toBeUndefined()

    await act(async () => {
      betaResponse.resolve(jsonResponse({ sessions: [addressedSession('beta-row')] }))
      await betaResponse.promise
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sourceIdentity).toBe('beta-source')
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

  test('keeps a rename through one coalesced stale response, then clears it on a matching canonical response', async () => {
    const remote = remoteFactory()
    const staleRefresh = deferred<Response>()
    const canonicalRefresh = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('pi-existing')]))
      .mockResolvedValueOnce(jsonResponse({ ...session('pi-existing'), title: 'Renamed' }))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(canonicalRefresh.promise)

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let rename!: Promise<SessionSummary>
    act(() => { rename = result.current.rename('pi-existing', 'Renamed') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await expect(rename).resolves.toMatchObject({ id: 'pi-existing', title: 'Renamed' })

    await act(async () => { staleRefresh.resolve(jsonResponse([session('pi-existing')])) })
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Renamed' })

    act(() => { void result.current.refresh({ background: true }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await act(async () => { canonicalRefresh.resolve(jsonResponse([{ ...session('pi-existing'), title: 'Renamed' }])) })
    await waitFor(() => expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Renamed' }))

    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...session('pi-existing'), title: 'Externally renamed' }]))
    await act(async () => { await result.current.refresh({ background: true }) })
    expect(result.current.sessions[0]).toMatchObject({ id: 'pi-existing', title: 'Externally renamed' })
  })

  test('accepts a newer server title after two later rename mismatches and settles stale load-more', async () => {
    const remote = remoteFactory()
    const staleLoadMore = deferred<Response>()
    const firstRefresh = deferred<Response>()
    const secondRefresh = deferred<Response>()
    const firstPage = [session('pi-existing'), ...Array.from({ length: 49 }, (_, index) => session(`pi-${index}`))]
    fetchMock
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockReturnValueOnce(staleLoadMore.promise)
      .mockResolvedValueOnce(jsonResponse({ ...session('pi-existing'), title: 'Renamed' }))
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise)

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.hasMore).toBe(true))
    act(() => { void result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    let rename!: Promise<SessionSummary>
    act(() => { rename = result.current.rename('pi-existing', 'Renamed') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await expect(rename).resolves.toMatchObject({ id: 'pi-existing', title: 'Renamed' })
    await act(async () => { firstRefresh.resolve(jsonResponse(firstPage)) })
    expect(result.current.sessions.find((item) => item.id === 'pi-existing')).toMatchObject({ title: 'Renamed' })

    act(() => { void result.current.refresh({ background: true }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    await act(async () => { secondRefresh.resolve(jsonResponse([{ ...session('pi-existing'), title: 'Externally renamed' }, ...firstPage.slice(1)])) })
    await waitFor(() => expect(result.current.sessions.find((item) => item.id === 'pi-existing')).toMatchObject({ title: 'Externally renamed' }))

    await act(async () => { staleLoadMore.resolve(jsonResponse([session('pi-existing')])) })
    expect(result.current.loading).toBe(false)
    expect(result.current.loadingMore).toBe(false)
  })

  test('failed rename rejects without changing sessions', async () => {
    const remote = remoteFactory()
    const existing = session('pi-existing')
    fetchMock
      .mockResolvedValueOnce(jsonResponse([existing]))
      .mockResolvedValueOnce(jsonResponse({}, 500))

    const { result } = renderHook(() => usePiSessions({
      storageScope: 'scope-a', fetch: fetchMock as unknown as typeof fetch, createRemoteSession: remote.factory,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(result.current.rename(existing.id, 'Renamed')).rejects.toThrow('Failed to rename session: 500')

    expect(result.current.sessions).toEqual([existing])
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

  test('can reject a background refresh when a host needs authoritative failure reporting', async () => {
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

    await expect(act(async () => {
      await result.current.refresh({ background: true, throwOnError: true })
    })).rejects.toThrow('Failed to load sessions: 500')
    expect(result.current.sessions.map((item) => item.id)).toEqual(['pi-existing'])
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

  test('does not persist or refresh when create resolves after unmount', async () => {
    const persisted = storage()
    const tabStorage = storage()
    const createResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
      .mockReturnValueOnce(createResponse.promise)

    const { result, unmount } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      storageScope: 'scope-a',
      storage: persisted,
      bootResumeStorage: tabStorage,
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let createPromise!: Promise<SessionSummary>
    act(() => { createPromise = result.current.create({ title: 'Unmounted' }) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    unmount()
    createResponse.resolve(jsonResponse({ agentTypeId: 'alpha', sessionId: 'late-create' }, 201))
    await expect(createPromise).resolves.toMatchObject({ id: 'late-create' })

    expect(persisted.values.size).toBe(0)
    expect(tabStorage.values.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('does not refresh or surface an old delete after its source switches', async () => {
    const deleteResponse = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(jsonResponse([session('source-a')]))
      .mockReturnValueOnce(deleteResponse.promise)
      .mockResolvedValueOnce(jsonResponse([session('source-b')]))

    const { result, rerender } = renderHook(
      ({ apiBaseUrl }) => usePiSessions({
        apiBaseUrl,
        storageScope: 'scope-a',
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      }),
      { initialProps: { apiBaseUrl: '/source-a' } },
    )
    await waitFor(() => expect(result.current.activeSessionId).toBe('source-a'))
    let deletePromise!: Promise<void>
    act(() => { deletePromise = result.current.delete('source-a') })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    rerender({ apiBaseUrl: '/source-b' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('source-b'))
    deleteResponse.resolve(new Response(null, { status: 204 }))
    await expect(deletePromise).resolves.toBeUndefined()

    expect(result.current.sessions.map((item) => item.id)).toEqual(['source-b'])
    expect(result.current.error).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
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
