// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { usePiSessions } from '../usePiSessions'

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
})
