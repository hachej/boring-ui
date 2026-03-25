import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkspaceAuth from '../../hooks/useWorkspaceAuth'

vi.mock('../../utils/transport', () => ({
  apiFetchJson: vi.fn(),
  getHttpErrorDetail: vi.fn((response, data, fallback) => data?.message || fallback),
}))

describe('useWorkspaceAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hydrates authenticated identity and workspace options on success', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    apiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { id: 'user-1', email: 'john@example.com' },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { workspaces: [{ id: 'ws-1', name: 'Workspace One' }] },
      })

    const { result } = renderHook(() => useWorkspaceAuth({
      autoRefresh: false,
      baseStoragePrefix: 'boring-ui',
    }))

    let workspaces = []
    await act(async () => {
      workspaces = await result.current.refreshData()
    })

    expect(workspaces).toEqual([{ id: 'ws-1', name: 'Workspace One' }])
    expect(result.current.userId).toBe('user-1')
    expect(result.current.email).toBe('john@example.com')
    expect(result.current.authStatus).toBe('authenticated')
    expect(result.current.identityError).toBe('')
    expect(result.current.workspaces).toEqual([{ id: 'ws-1', name: 'Workspace One' }])
    expect(result.current.workspaceListStatus).toBe('success')
    expect(result.current.storagePrefix).toBe('boring-ui-u-user-1')
  })

  it('preserves recent authenticated identity when identity refresh fails', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    apiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { id: 'user-1', email: 'john@example.com' },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { workspaces: [{ id: 'ws-1', name: 'Workspace One' }] },
      })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { workspaces: [{ id: 'ws-2', name: 'Workspace Two' }] },
      })

    const { result } = renderHook(() => useWorkspaceAuth({
      autoRefresh: false,
      baseStoragePrefix: 'boring-ui',
    }))

    await act(async () => {
      await result.current.refreshData()
    })

    await act(async () => {
      await result.current.refreshData()
    })

    expect(result.current.userId).toBe('user-1')
    expect(result.current.email).toBe('john@example.com')
    expect(result.current.authStatus).toBe('authenticated')
    expect(result.current.identityError).toBe('Failed to reach control plane for identity.')
    expect(result.current.workspaces).toEqual([{ id: 'ws-2', name: 'Workspace Two' }])

    warnSpy.mockRestore()
  })

  it('clears stale workspace options when the workspace list request fails', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    apiFetchJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 },
        data: { workspaces: [{ id: 'ws-1', name: 'Workspace One' }] },
      })
      .mockResolvedValueOnce({
        response: { ok: false, status: 401 },
        data: {},
      })

    const { result } = renderHook(() => useWorkspaceAuth({
      autoRefresh: false,
      baseStoragePrefix: 'boring-ui',
    }))

    await act(async () => {
      await result.current.fetchWorkspaces()
    })
    expect(result.current.workspaces).toEqual([{ id: 'ws-1', name: 'Workspace One' }])

    let workspaces = []
    await act(async () => {
      workspaces = await result.current.fetchWorkspaces()
    })

    expect(workspaces).toEqual([])
    expect(result.current.workspaces).toEqual([])
    expect(result.current.workspaceListStatus).toBe('error')
    expect(result.current.workspaceError).toBe('Not signed in.')
  })

  it('marks the user unauthenticated when the identity endpoint returns 401', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    apiFetchJson
      .mockResolvedValueOnce({
        response: { ok: false, status: 401 },
        data: {},
      })
      .mockResolvedValueOnce({
        response: { ok: false, status: 401 },
        data: {},
      })

    const { result } = renderHook(() => useWorkspaceAuth({
      autoRefresh: false,
      baseStoragePrefix: 'boring-ui',
    }))

    await act(async () => {
      await result.current.refreshData()
    })

    expect(result.current.userId).toBe('')
    expect(result.current.email).toBe('')
    expect(result.current.authStatus).toBe('unauthenticated')
    expect(result.current.identityError).toBe('Not signed in.')
    expect(result.current.workspaceError).toBe('Not signed in.')
  })
})
