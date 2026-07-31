// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../../pi/remotePiSession'
import {
  NativeFirstSendErrorKind,
  nativeFirstDataSourceIdentity,
  sendNativeFirst,
} from '../../pi/nativeFirstSendTransactions'
import { AgentGatewayErrorCode } from '../../../../shared/gateway/errors'
import { GatewayResponseError, RUNTIME_SCOPE_MISMATCH_MESSAGE } from '../../gatewayResponseError'
import { activeSessionStorageKey } from '../activeSessionStorage'
import { usePiSessions } from '../usePiSessions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('usePiSessions addressed Agent transport', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('carries agentTypeId through list, cursor continuation, create, and delete', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if ((init?.method ?? 'GET') === 'POST') {
        return new Response(JSON.stringify({ agentTypeId: 'alpha', sessionId: 'created' }), { status: 201 })
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      const cursor = new URL(url, 'http://local').searchParams.get('cursor')
      return new Response(JSON.stringify(cursor
        ? {
            sessions: [{
              ref: { agentTypeId: 'alpha', sessionId: 'second' },
              title: 'Second',
              status: 'idle',
              createdAt: 3,
              updatedAt: 4,
            }],
          }
        : {
            sessions: [{
              ref: { agentTypeId: 'alpha', sessionId: 'first' },
              title: 'First',
              status: 'idle',
              createdAt: 1,
              updatedAt: 2,
            }],
            nextCursor: 'page-2',
          }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as typeof fetch,
      connectActiveSession: false,
      storageScope: 'default',
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sessions.map((session) => session.id)).toEqual(['first'])
    expect(result.current.hasMore).toBe(true)
    expect(calls[0]?.url).toContain('/api/v1/agents/alpha/sessions?limit=50')

    await act(async () => { await result.current.loadMore() })
    expect(result.current.sessions.map((session) => session.id)).toEqual(['first', 'second'])
    expect(calls.some((call) => call.url.includes('cursor=page-2'))).toBe(true)

    await act(async () => { await result.current.create({ title: 'Created' }) })
    const create = calls.find((call) => call.init?.method === 'POST')
    expect(create?.url).toContain('/api/v1/agents/alpha/sessions')
    expect(JSON.parse(String(create?.init?.body))).toEqual({ title: 'Created' })

    await act(async () => { await result.current.delete('created') })
    const deletion = calls.find((call) => call.init?.method === 'DELETE')
    expect(deletion?.url).toContain('/api/v1/agents/alpha/sessions/created')
  })

  test('keeps a new addressed chat local until the remote first-send adopts its native id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/native-1/rename')) {
        return new Response(JSON.stringify({
          ref: { agentTypeId: 'alpha', sessionId: 'native-1' },
          title: 'Renamed',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    })
    const created: RemotePiSessionOptions[] = []
    const createRemoteSession = vi.fn((options: RemotePiSessionOptions) => {
      created.push(options)
      return { dispose: vi.fn() } as unknown as RemotePiSession
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      workspaceId: 'workspace-a',
      storageScope: 'workspace-a',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession,
      localCreateUntilPrompt: true,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let draft!: Awaited<ReturnType<typeof result.current.create>>
    await act(async () => {
      draft = await result.current.create()
    })

    expect(draft).toMatchObject({ id: expect.stringMatching(/^local-/), ephemeral: true })
    expect(result.current.activeSessionId).toBe(draft.id)
    expect(calls.filter((call) => call.init?.method === 'POST')).toHaveLength(0)
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toMatchObject({
      sessionId: draft.id,
      agentTypeId: 'alpha',
      workspaceId: 'workspace-a',
      autoStart: false,
      nativeFirstPrompt: { onAdopt: expect.any(Function) },
    })

    act(() => {
      created[0].nativeFirstPrompt?.onAdopt({
        id: 'native-1',
        title: 'Untitled',
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(2).toISOString(),
        turnCount: 0,
      })
    })
    await waitFor(() => expect(result.current.activeSessionId).toBe('native-1'))
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ id: 'native-1', ephemeral: false }),
    ])
    expect(localStorage.getItem(activeSessionStorageKey('workspace-a', 'alpha'))).toBe('native-1')

    await act(async () => {
      await result.current.rename('native-1', 'Renamed')
    })
    expect(result.current.sessions[0]).toMatchObject({ id: 'native-1', title: 'Renamed' })
    const renameCall = calls.find((call) => call.url.endsWith('/native-1/rename'))
    expect(renameCall?.init?.method).toBe('POST')
    expect(JSON.parse(String(renameCall?.init?.body))).toEqual({
      requestId: expect.stringMatching(/^rename-/),
      title: 'Renamed',
    })
  })

  test('deletes the native session when a local draft is deleted during first-send adoption', async () => {
    const firstSend = deferred<{ receipt: { accepted: true }; session: { id: string } }>()
    const deleteResponse = deferred<Response>()
    let listNativeSession = false
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (init?.method === 'DELETE') return deleteResponse.promise
      return new Response(JSON.stringify({
        sessions: listNativeSession ? [{
          ref: { agentTypeId: 'alpha', sessionId: 'native-delete' },
          title: 'Native delete',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }] : [],
      }), { status: 200 })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      workspaceId: 'workspace-a',
      storageScope: 'workspace-a',
      fetch: fetchMock as unknown as typeof fetch,
      localCreateUntilPrompt: true,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let draft!: Awaited<ReturnType<typeof result.current.create>>
    await act(async () => {
      draft = await result.current.create()
    })
    const dataSource = nativeFirstDataSourceIdentity('', 'workspace-a', 'workspace-a', 'alpha')
    const send = sendNativeFirst(
      dataSource,
      draft.id,
      10_000,
      'first prompt',
      async () => firstSend.promise,
      () => NativeFirstSendErrorKind.Definite,
    )
    let deletion!: Promise<void>
    act(() => {
      deletion = result.current.delete(draft.id)
    })

    firstSend.resolve({ receipt: { accepted: true }, session: { id: 'native-delete' } })
    await waitFor(() => expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(true))
    listNativeSession = true
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.sessions.map((session) => session.id)).not.toContain('native-delete')

    deleteResponse.resolve(new Response(null, { status: 204 }))
    await act(async () => {
      await Promise.all([send, deletion])
    })

    expect(result.current.sessions).toEqual([])
    expect(calls).toContainEqual(expect.objectContaining({
      url: '/api/v1/agents/alpha/sessions/native-delete',
      init: expect.objectContaining({ method: 'DELETE' }),
    }))
  })

  test('adopts the native id when draft cleanup fails so deletion can be retried', async () => {
    const dataSource = nativeFirstDataSourceIdentity('', 'workspace-a', 'workspace-a', 'alpha')
    let deleteAttempts = 0
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE' && ++deleteAttempts === 1) throw new TypeError('network unavailable')
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      workspaceId: 'workspace-a',
      storageScope: 'workspace-a',
      fetch: fetchMock as unknown as typeof fetch,
      localCreateUntilPrompt: true,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let draft!: Awaited<ReturnType<typeof result.current.create>>
    await act(async () => {
      draft = await result.current.create()
    })
    const send = sendNativeFirst(
      dataSource,
      draft.id,
      10_000,
      'first prompt retry',
      async () => ({ receipt: { accepted: true }, session: { id: 'native-retry' } }),
      () => NativeFirstSendErrorKind.Definite,
    )

    await expect(result.current.delete(draft.id)).rejects.toThrow('network unavailable')
    await send
    await waitFor(() => expect(result.current.sessions.map((session) => session.id)).toEqual(['native-retry']))

    await act(async () => {
      await result.current.delete('native-retry')
    })
    expect(deleteAttempts).toBe(2)
    expect(result.current.sessions).toEqual([])
  })

  test('parses a runtime-scope rename failure and lazily marks the listed chat read-only', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          error: {
            code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
            message: 'session is pinned to a different runtime scope',
          },
        }), { status: 409, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId: 'alpha', sessionId: 'orphaned' },
          title: 'Previous runtime chat',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let error: unknown
    await act(async () => {
      error = await result.current.rename('orphaned', 'New title').catch((reason) => reason)
    })

    expect(error).toMatchObject({
      code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
      message: RUNTIME_SCOPE_MISMATCH_MESSAGE,
    })
    expect((error as Error).message).not.toContain('409')
    expect(result.current.sessions).toEqual([
      expect.objectContaining({
        id: 'orphaned',
        readOnly: true,
        readOnlyReason: RUNTIME_SCOPE_MISMATCH_MESSAGE,
      }),
    ])
  })

  test('keeps a chat listed when delete is rejected and marks a scope mismatch read-only', async () => {
    const deleteResponse = deferred<Response>()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return deleteResponse.promise
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId: 'alpha', sessionId: 'orphaned' },
          title: 'Previous runtime chat',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let deletion!: Promise<void>
    act(() => {
      deletion = result.current.delete('orphaned')
    })
    expect(result.current.sessions.map((session) => session.id)).toEqual(['orphaned'])

    await act(async () => {
      deleteResponse.resolve(new Response(JSON.stringify({
        error: {
          code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
          message: 'session is pinned to a different runtime scope',
        },
      }), { status: 409, headers: { 'content-type': 'application/json' } }))
      await deletion.catch(() => undefined)
    })

    expect(result.current.sessions).toEqual([
      expect.objectContaining({ id: 'orphaned', readOnly: true }),
    ])
    expect(result.current.error?.message).toBe(RUNTIME_SCOPE_MISMATCH_MESSAGE)
  })

  test('marks a mismatch before notifying a consumer callback that throws', async () => {
    const created: RemotePiSessionOptions[] = []
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessions: [{
        ref: { agentTypeId: 'alpha', sessionId: 'orphaned' },
        title: 'Previous runtime chat',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const createRemoteSession = vi.fn((options: RemotePiSessionOptions) => {
      created.push(options)
      return { dispose: vi.fn() } as unknown as RemotePiSession
    })
    const consumerError = new Error('consumer observer failed')
    const remoteSessionOptions = {
      onGatewayError: () => {
        throw consumerError
      },
    }
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as unknown as typeof fetch,
      createRemoteSession,
      remoteSessionOptions,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(created).toHaveLength(1))
    const mismatch = new GatewayResponseError(
      409,
      RUNTIME_SCOPE_MISMATCH_MESSAGE,
      AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
    )
    let observedError: unknown
    act(() => {
      try {
        created[0]?.onGatewayError?.(mismatch)
      } catch (error) {
        observedError = error
      }
    })

    expect(observedError).toBe(consumerError)
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ id: 'orphaned', readOnly: true }),
    ])
  })

  test('tags a network delete failure with its action so load-error observers can ignore it', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new TypeError('network unavailable')
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId: 'alpha', sessionId: 'healthy' },
          title: 'Healthy chat',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as unknown as typeof fetch,
      connectActiveSession: false,
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    const error = await result.current.delete('healthy').catch((reason) => reason)

    expect(error).toMatchObject({
      message: 'network unavailable',
      operation: 'delete chat',
    })
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ id: 'healthy' }),
    ])
  })

  test('switches the addressed collection and remote wire without connecting a stale session id', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const agentTypeId = url.includes('review%2Fagent') ? 'review/agent' : 'alpha'
      const sessionId = agentTypeId === 'alpha' ? 'alpha-session' : 'review-session'
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId, sessionId },
          title: sessionId,
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const created: Array<{ options: RemotePiSessionOptions; dispose: ReturnType<typeof vi.fn> }> = []
    const createRemoteSession = vi.fn((options: RemotePiSessionOptions) => {
      const dispose = vi.fn()
      created.push({ options, dispose })
      return { dispose } as unknown as RemotePiSession
    })

    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        createRemoteSession,
        storageScope: 'workspace-a',
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-session'))
    expect(result.current.dataAgentTypeId).toBe('alpha')
    expect(created[0]?.options).toMatchObject({ agentTypeId: 'alpha', sessionId: 'alpha-session' })

    rerender({ agentTypeId: 'review/agent' })

    expect(result.current.sessions).toEqual([])
    expect(result.current.activeSessionId).toBeUndefined()
    expect(result.current.dataAgentTypeId).toBe('alpha')
    await waitFor(() => expect(result.current.activeSessionId).toBe('review-session'))
    expect(result.current.dataAgentTypeId).toBe('review/agent')
    await waitFor(() => expect(created).toHaveLength(2))
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(created[1]?.options).toMatchObject({ agentTypeId: 'review/agent', sessionId: 'review-session' })
    expect(calls).toContain('/api/v1/agents/alpha/sessions?limit=50')
    expect(calls).toContain('/api/v1/agents/review%2Fagent/sessions?limit=50')
    expect(calls.some((url) => url.includes('/api/v1/agent/pi-chat/'))).toBe(false)
  })

  test('restores each addressed agent active session from its changing storage adapter', async () => {
    const values = new Map<string, string>([
      ['alpha', 'alpha-second'],
      ['beta', 'beta-second'],
    ])
    const storageFor = (agentTypeId: string) => ({
      getItem: () => values.get(agentTypeId) ?? null,
      setItem: (_key: string, value: string) => values.set(agentTypeId, value),
      removeItem: () => values.delete(agentTypeId),
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const agentTypeId = String(input).includes('/beta/') ? 'beta' : 'alpha'
      return new Response(JSON.stringify({
        sessions: [
          {
            ref: { agentTypeId, sessionId: `${agentTypeId}-first` },
            title: `${agentTypeId} first`,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
          },
          {
            ref: { agentTypeId, sessionId: `${agentTypeId}-second` },
            title: `${agentTypeId} second`,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }))
    })

    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        storage: storageFor(agentTypeId),
        storageScope: 'workspace-a',
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-second'))
    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-second'))
    rerender({ agentTypeId: 'alpha' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-second'))

    expect(values).toEqual(new Map([
      ['alpha', 'alpha-second'],
      ['beta', 'beta-second'],
    ]))
  })

  test('restores each addressed agent from shared default storage when session ids collide', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const agentTypeId = String(input).includes('/beta/') ? 'beta' : 'alpha'
      return new Response(JSON.stringify({
        sessions: [
          {
            ref: { agentTypeId, sessionId: 'shared' },
            title: `${agentTypeId} shared`,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
          },
          {
            ref: { agentTypeId, sessionId: `${agentTypeId}-second` },
            title: `${agentTypeId} second`,
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }))
    })

    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        storageScope: 'workspace-a',
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('shared'))
    act(() => result.current.switch('alpha-second'))
    expect(result.current.activeSessionId).toBe('alpha-second')

    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('shared'))
    act(() => result.current.switch('beta-second'))
    expect(result.current.activeSessionId).toBe('beta-second')

    rerender({ agentTypeId: 'alpha' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-second'))
    act(() => result.current.switch('shared'))
    expect(result.current.activeSessionId).toBe('shared')
    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-second'))

    expect(localStorage.getItem(activeSessionStorageKey('workspace-a', 'alpha'))).toBe('shared')
    expect(localStorage.getItem(activeSessionStorageKey('workspace-a', 'beta'))).toBe('beta-second')
    expect(localStorage.getItem(activeSessionStorageKey('workspace-a'))).toBeNull()
  })

  test('ignores an old-agent create completion after the selected agent changes', async () => {
    const createResponse = deferred<Response>()
    const calls: Array<{ url: string; method: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (method === 'POST') return createResponse.promise
      const agentTypeId = url.includes('/beta/') ? 'beta' : 'alpha'
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId, sessionId: `${agentTypeId}-session` },
          title: agentTypeId,
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }))
    })
    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-session'))
    let createPromise!: Promise<unknown>
    act(() => {
      createPromise = result.current.create({ title: 'Old alpha create' })
    })
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))

    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-session'))

    await act(async () => {
      createResponse.resolve(new Response(JSON.stringify({ agentTypeId: 'alpha', sessionId: 'alpha-created' }), { status: 201 }))
      await createPromise
    })

    expect(result.current.sessions.map((session) => session.id)).toEqual(['beta-session'])
    expect(result.current.activeSessionId).toBe('beta-session')
    expect(calls.filter((call) => call.method === 'GET' && call.url.includes('/alpha/'))).toHaveLength(1)
  })

  test('ignores an old-agent delete completion after the selected agent changes', async () => {
    const deleteResponse = deferred<Response>()
    const calls: Array<{ url: string; method: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method })
      if (method === 'DELETE') return deleteResponse.promise
      const agentTypeId = url.includes('/beta/') ? 'beta' : 'alpha'
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId, sessionId: `${agentTypeId}-session` },
          title: agentTypeId,
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }))
    })
    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-session'))
    let deletePromise!: Promise<void>
    act(() => {
      deletePromise = result.current.delete('alpha-session')
    })
    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true))

    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-session'))

    await act(async () => {
      deleteResponse.resolve(new Response(null, { status: 204 }))
      await deletePromise
    })

    expect(result.current.sessions.map((session) => session.id)).toEqual(['beta-session'])
    expect(result.current.activeSessionId).toBe('beta-session')
    expect(calls.filter((call) => call.method === 'GET' && call.url.includes('/alpha/'))).toHaveLength(1)
  })

  test('ignores an old-agent refresh completion after the selected agent changes', async () => {
    const staleRefresh = deferred<Response>()
    let alphaGets = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const agentTypeId = url.includes('/beta/') ? 'beta' : 'alpha'
      if (agentTypeId === 'alpha' && ++alphaGets === 2) return staleRefresh.promise
      return new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId, sessionId: `${agentTypeId}-session` },
          title: agentTypeId,
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      }))
    })
    const { result, rerender } = renderHook(
      ({ agentTypeId }) => usePiSessions({
        agentTypeId,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
        retry: { maxRetries: 0 },
      }),
      { initialProps: { agentTypeId: 'alpha' } },
    )

    await waitFor(() => expect(result.current.activeSessionId).toBe('alpha-session'))
    act(() => {
      void result.current.refresh()
    })
    await waitFor(() => expect(alphaGets).toBe(2))

    rerender({ agentTypeId: 'beta' })
    await waitFor(() => expect(result.current.activeSessionId).toBe('beta-session'))

    await act(async () => {
      staleRefresh.resolve(new Response(JSON.stringify({
        sessions: [{
          ref: { agentTypeId: 'alpha', sessionId: 'alpha-stale' },
          title: 'stale',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
        }],
      })))
      await staleRefresh.promise
    })

    expect(result.current.sessions.map((session) => session.id)).toEqual(['beta-session'])
    expect(result.current.activeSessionId).toBe('beta-session')
  })
})
