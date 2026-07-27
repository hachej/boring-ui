// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { useAddressedAgentSelection } from '../useAddressedAgentSelection'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('useAddressedAgentSelection', () => {
  test('fetches the scoped agent list from the configured base URL and defaults to the first agent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { agentTypeId: 'alpha', label: 'Alpha' },
      { agentTypeId: 'review/agent', label: 'Reviewer', description: 'Reviews changes' },
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
      { agentTypeId: 'review/agent', label: 'Reviewer', description: 'Reviews changes' },
    ])
    expect(result.current.selectedAgentTypeId).toBe('alpha')

    act(() => result.current.selectAgentTypeId('review/agent'))
    expect(result.current.selectedAgentTypeId).toBe('review/agent')
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
})
