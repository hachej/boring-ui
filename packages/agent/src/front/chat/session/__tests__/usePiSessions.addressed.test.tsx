// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { usePiSessions } from '../usePiSessions'

describe('usePiSessions addressed Agent transport', () => {
  test('pages archived inventory independently so sessions beyond 50 can be unarchived', async () => {
    const archivedRow = (index: number) => ({
      ref: { agentTypeId: 'alpha', sessionId: `archived-${index}` },
      title: `Archived ${index}`,
      status: 'idle',
      createdAt: index,
      updatedAt: index,
      archived: true,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://local')
      if (init?.method === 'POST') {
        const id = url.pathname.split('/').at(-2)!
        return new Response(JSON.stringify({
          ...archivedRow(Number(id.split('-').at(-1))),
          archived: undefined,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.searchParams.get('archived') === 'active') {
        return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const cursor = url.searchParams.get('cursor')
      return new Response(JSON.stringify(cursor
        ? { sessions: [archivedRow(50)] }
        : { sessions: Array.from({ length: 50 }, (_, index) => archivedRow(index)), nextCursor: 'archived-page-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha',
      fetch: fetchMock as typeof fetch,
      connectActiveSession: false,
      storageScope: 'default',
      retry: { maxRetries: 0 },
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.loadArchived() })
    expect(result.current.sessions).toHaveLength(50)
    expect(result.current.hasMoreArchived).toBe(true)
    await act(async () => { await result.current.loadArchived() })
    expect(result.current.sessions.map((session) => session.id)).toContain('archived-50')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('archived=archived&cursor=archived-page-2'))).toBe(true)

    await act(async () => { await result.current.setArchived('archived-50', false) })
    expect(result.current.sessions.find((session) => session.id === 'archived-50')?.archived).toBeUndefined()
  })

  test('refreshes every loaded archive filter after external mutations', async () => {
    const row = (id: string, archived: boolean) => ({
      ref: { agentTypeId: 'alpha', sessionId: id },
      title: id,
      status: 'idle',
      createdAt: 1,
      updatedAt: id === 'x' ? 2 : 1,
      ...(archived ? { archived: true } : {}),
    })
    let active = [row('x', false)]
    let archived = [row('y', true)]
    let archivedGets = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://local')
      const wantsArchived = url.searchParams.get('archived') === 'archived'
      if (wantsArchived) archivedGets += 1
      return new Response(JSON.stringify({ sessions: wantsArchived ? archived : active }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha', fetch: fetchMock as typeof fetch, connectActiveSession: false, retry: { maxRetries: 0 },
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.loadArchived() })
    expect(result.current.sessions.map((session) => `${session.id}:${session.archived ? 'archived' : 'active'}`)).toEqual(['x:active', 'y:archived'])

    active = []
    archived = [row('x', true), row('y', true)]
    await act(async () => { await result.current.refresh({ background: true }) })
    expect(result.current.sessions.map((session) => `${session.id}:${session.archived ? 'archived' : 'active'}`)).toEqual(['x:archived', 'y:archived'])
    expect(archivedGets).toBe(2)

    archived = [row('x', true)]
    await act(async () => { await result.current.refresh({ background: true }) })
    expect(result.current.sessions.map((session) => session.id)).toEqual(['x'])
  })

  test('fences older list responses against successful archive mutations', async () => {
    let resolveRefresh!: (response: Response) => void
    let activeGets = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://local')
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ref: { agentTypeId: 'alpha', sessionId: 'x' }, title: 'x', status: 'idle', createdAt: 1, updatedAt: 1, archived: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      activeGets += 1
      const response = new Response(JSON.stringify({ sessions: [{
        ref: { agentTypeId: 'alpha', sessionId: 'x' }, title: 'x', status: 'idle', createdAt: 1, updatedAt: 1,
      }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (activeGets === 1) return response
      return await new Promise<Response>((resolve) => { resolveRefresh = resolve })
    })
    const { result } = renderHook(() => usePiSessions({
      agentTypeId: 'alpha', fetch: fetchMock as typeof fetch, connectActiveSession: false, retry: { maxRetries: 0 },
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let refresh!: Promise<void>
    act(() => { refresh = result.current.refresh({ background: true }) })
    await waitFor(() => expect(activeGets).toBe(2))
    await act(async () => { await result.current.setArchived('x', true) })
    await act(async () => {
      resolveRefresh(new Response(JSON.stringify({ sessions: [{
        ref: { agentTypeId: 'alpha', sessionId: 'x' }, title: 'x', status: 'idle', createdAt: 1, updatedAt: 1,
      }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      await refresh
    })
    expect(result.current.sessions).toEqual([expect.objectContaining({ id: 'x', archived: true })])
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
    expect(result.current.sessions.find((session) => session.id === 'created')).toMatchObject({ agentTypeId: 'alpha' })
    const create = calls.find((call) => call.init?.method === 'POST')
    expect(create?.url).toContain('/api/v1/agents/alpha/sessions')
    expect(JSON.parse(String(create?.init?.body))).toEqual({ title: 'Created' })

    await act(async () => { await result.current.delete('created') })
    const deletion = calls.find((call) => call.init?.method === 'DELETE')
    expect(deletion?.url).toContain('/api/v1/agents/alpha/sessions/created')
  })
})
