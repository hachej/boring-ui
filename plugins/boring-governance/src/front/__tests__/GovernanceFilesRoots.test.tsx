// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFileTreeRoots, type PluginProviderProps } from '@hachej/boring-workspace'
import { captureFrontPlugin } from '@hachej/boring-workspace/plugin'
import { createGovernanceFilesRootsPlugin } from '../GovernanceFilesRoots.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function RootsProbe() {
  const roots = useFileTreeRoots()
  return <pre data-testid="roots">{JSON.stringify(roots)}</pre>
}

function captureProvider(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  const captured = captureFrontPlugin(createGovernanceFilesRootsPlugin({ fetchImpl, ...options }))
  const Provider = captured.registrations.providers[0]!.component
  return { captured, Provider }
}

function providerProps(overrides: Partial<PluginProviderProps> = {}): PluginProviderProps {
  return {
    apiBaseUrl: '',
    children: <RootsProbe />,
    ...overrides,
  }
}

describe('createGovernanceFilesRootsPlugin', () => {
  it('contributes one roots provider and no Files workspace source', () => {
    const { captured } = captureProvider(vi.fn())

    expect(captured.registrations.providers.map((provider) => provider.id)).toEqual([
      'governance-files-roots',
    ])
    expect(captured.registrations.workspaceSources).toEqual([])
  })

  it('starts workspace-only and exposes company_context only for governed access', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ companyContextAccess: 'readonly' }))
    const { Provider } = captureProvider(fetchImpl, {
      workspaceRoot: {
        filesystem: 'user',
        label: 'My workspace',
        rootDir: 'home',
        access: 'readwrite',
      },
      companyContext: {
        label: 'Company docs',
        rootDir: '/docs',
        searchPlaceholder: 'Find company docs...',
      },
    })

    render(<Provider {...providerProps()} />)
    expect(screen.getByTestId('roots')).toHaveTextContent('My workspace')

    await waitFor(() => expect(screen.getByTestId('roots')).toHaveTextContent('company_context'))
    expect(screen.getByTestId('roots')).toHaveTextContent('Company docs')
    expect(screen.getByTestId('roots')).toHaveTextContent('Find company docs...')
    expect(screen.getByTestId('roots')).toHaveTextContent('readonly')
  })

  it('passes endpoint verbatim, forwards current auth headers, and keeps apiBaseUrl out of request identity', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ companyContextAccess: 'none' }))
      .mockResolvedValueOnce(jsonResponse({ companyContextAccess: 'readwrite' }))
    const { Provider } = captureProvider(fetchImpl)
    const { rerender } = render(
      <Provider {...providerProps({ apiBaseUrl: '/agent', authHeaders: { Authorization: 'Bearer one' } })} />,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/v1/governance/usage-summary')
    expect(fetchImpl.mock.calls[0]![1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: { Authorization: 'Bearer one' },
      signal: expect.any(AbortSignal),
    }))
    expect(screen.getByTestId('roots')).not.toHaveTextContent('company_context')

    rerender(<Provider {...providerProps({ apiBaseUrl: '/other', authHeaders: { Authorization: 'Bearer one' } })} />)
    await act(async () => Promise.resolve())
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    rerender(<Provider {...providerProps({ apiBaseUrl: '/other', authHeaders: { Authorization: 'Bearer two' } })} />)
    expect(screen.getByTestId('roots')).not.toHaveTextContent('company_context')
    await waitFor(() => expect(screen.getByTestId('roots')).toHaveTextContent('readwrite'))
  })

  it('fails closed on errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({}, 503))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Provider } = captureProvider(fetchImpl)

    render(<Provider {...providerProps()} />)

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('roots')).not.toHaveTextContent('company_context')
    error.mockRestore()
  })

  it('aborts superseded requests and ignores stale responses from an old user', async () => {
    let resolveOld!: (response: Response) => void
    let resolveNew!: (response: Response) => void
    const oldRequest = new Promise<Response>((resolve) => { resolveOld = resolve })
    const newRequest = new Promise<Response>((resolve) => { resolveNew = resolve })
    const signals: AbortSignal[] = []
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      signals.push(init!.signal as AbortSignal)
      return signals.length === 1 ? oldRequest : newRequest
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { Provider } = captureProvider(fetchImpl)
    const { rerender, unmount } = render(
      <Provider {...providerProps({ authHeaders: { 'X-User': 'old' } })} />,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    rerender(<Provider {...providerProps({ authHeaders: { 'X-User': 'new' } })} />)
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(signals[0]!.aborted).toBe(true)
    expect(screen.getByTestId('roots')).not.toHaveTextContent('company_context')

    await act(async () => {
      resolveNew(jsonResponse({ companyContextAccess: 'none' }))
      await newRequest
      resolveOld(jsonResponse({ companyContextAccess: 'readwrite' }))
      await oldRequest
    })
    expect(screen.getByTestId('roots')).not.toHaveTextContent('company_context')
    expect(error).not.toHaveBeenCalled()

    unmount()
    expect(signals[1]!.aborted).toBe(true)
    error.mockRestore()
  })
})
