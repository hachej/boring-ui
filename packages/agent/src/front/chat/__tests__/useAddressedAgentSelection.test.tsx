// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/gateway/errors'
import { useAddressedAgentSelection } from '../useAddressedAgentSelection'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('useAddressedAgentSelection', () => {
  test('fetches the scoped agent list from the configured base URL and defaults to the first agent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { agentTypeId: 'alpha', label: 'Alpha' },
      { agentTypeId: 'review/agent', label: 'Reviewer', description: 'Reviews changes', pluginIds: ['ask-user', 'pr-review'] },
    ]))

    const { result } = renderHook(
      () => useAddressedAgentSelection({
        apiBaseUrl: 'https://agent.test/root/',
        requestHeaders: { authorization: 'Bearer redacted', ignored: undefined },
        storageScope: 'workspace-a',
        fetch: fetchMock as unknown as typeof fetch,
        enabled: true,
      }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://agent.test/root/api/v1/agents', {
      headers: {
        authorization: 'Bearer redacted',
        'x-boring-storage-scope': 'workspace-a',
      },
    })
    expect(result.current.agents).toEqual([
      { agentTypeId: 'alpha', label: 'Alpha' },
      { agentTypeId: 'review/agent', label: 'Reviewer', description: 'Reviews changes', pluginIds: ['ask-user', 'pr-review'] },
    ])
    expect(result.current.selectedAgentTypeId).toBe('alpha')

    act(() => result.current.selectAgentTypeId('review/agent'))
    expect(result.current.selectedAgentTypeId).toBe('review/agent')
  })

  // gh-1296: `legacy` changes presentation, not the host's default owner.
  test('keeps the first default entry selected beside an authored fleet', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { agentTypeId: 'default', label: 'default', legacy: true },
      { agentTypeId: 'alpha', label: 'Alpha' },
    ]))
    const { result } = renderHook(() => useAddressedAgentSelection({
      fetch: fetchMock as unknown as typeof fetch,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.agents).toEqual([
      { agentTypeId: 'default', label: 'default', legacy: true },
      { agentTypeId: 'alpha', label: 'Alpha' },
    ])
    expect(result.current.selectedAgentTypeId).toBe('default')
    act(() => result.current.selectAgentTypeId('alpha'))
    expect(result.current.selectedAgentTypeId).toBe('alpha')
  })

  test('selects the legacy fallback when it is the whole fleet', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ agentTypeId: 'default', label: 'Agent' }]))
    const { result } = renderHook(() => useAddressedAgentSelection({
      fetch: fetchMock as unknown as typeof fetch,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.selectedAgentTypeId).toBe('default')
  })

  test('does not discover agents without the explicit opt-in', async () => {
    const fetchMock = vi.fn()
    const { result } = renderHook(() => useAddressedAgentSelection({
      fetch: fetchMock as unknown as typeof fetch,
    }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.selectedAgentTypeId).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('surfaces the structured server message when agent discovery fails', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: { code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED, message: 'Agent catalog is restarting.' },
    }, 503))
    const { result } = renderHook(() => useAddressedAgentSelection({
      fetch: fetchMock as unknown as typeof fetch,
      enabled: true,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatchObject({
      code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
      message: 'Agent catalog is restarting.',
    })
    expect(result.current.error?.message).not.toContain('503')
  })

  test('keeps a selected agent across refresh and falls back when it disappears', async () => {
    const initialFetch = vi.fn(async () => jsonResponse([
      { agentTypeId: 'alpha', label: 'Alpha' },
      { agentTypeId: 'beta', label: 'Beta' },
    ]))
    const refreshedFetch = vi.fn(async () => jsonResponse([
      { agentTypeId: 'alpha', label: 'Alpha' },
    ]))
    const { result, rerender } = renderHook(
      ({ fetchImpl }) => useAddressedAgentSelection({
        fetch: fetchImpl as unknown as typeof fetch,
        enabled: true,
      }),
      { initialProps: { fetchImpl: initialFetch } },
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.selectAgentTypeId('beta'))
    expect(result.current.selectedAgentTypeId).toBe('beta')

    rerender({ fetchImpl: refreshedFetch })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.agents.map((agent) => agent.agentTypeId)).toEqual(['alpha'])
    expect(result.current.selectedAgentTypeId).toBe('alpha')
  })
})
