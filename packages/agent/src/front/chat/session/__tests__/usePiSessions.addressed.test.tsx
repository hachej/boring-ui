// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { RemotePiSession, RemotePiSessionOptions } from '../../pi/remotePiSession'
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
