import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkspaceRouter from '../../hooks/useWorkspaceRouter'

vi.mock('../../utils/transport', () => ({
  apiFetch: vi.fn(),
  apiFetchJson: vi.fn(),
}))

const makeProps = (overrides = {}) => ({
  workspaceOptions: [],
  workspaceListStatus: 'idle',
  fetchWorkspaceList: vi.fn().mockResolvedValue([]),
  userMenuAuthStatus: 'authenticated',
  storagePrefix: 'boring-ui',
  projectRoot: '/workspace/root',
  controlPlaneOnboardingEnabled: false,
  backendWorkspaceRuntimeEnabled: false,
  controlPlaneEnabled: true,
  ...overrides,
})

describe('useWorkspaceRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
    localStorage.clear()
  })

  it('syncs currentWorkspaceId and route flags from the URL, including popstate', async () => {
    window.history.replaceState(null, '', '/w/ws-1/settings')

    const { result } = renderHook(() => useWorkspaceRouter(makeProps()))

    expect(result.current.currentWorkspaceId).toBe('ws-1')
    expect(result.current.isWorkspaceSettingsPage).toBe(true)
    expect(result.current.isWorkspaceSetupPage).toBe(false)

    await act(async () => {
      window.history.pushState(null, '', '/w/ws-2/setup')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.currentWorkspaceId).toBe('ws-2')
    expect(result.current.isWorkspaceSettingsPage).toBe(false)
    expect(result.current.isWorkspaceSetupPage).toBe(true)
  })

  it('redirects unauthenticated users to login when opening user settings', async () => {
    window.history.replaceState(null, '', '/w/ws-1/?doc=README.md')
    const assign = vi.fn()

    const { result } = renderHook(() => useWorkspaceRouter(makeProps({
      userMenuAuthStatus: 'unauthenticated',
      assign,
    })))

    await act(async () => {
      result.current.handleOpenUserSettings()
    })

    expect(assign).toHaveBeenCalledWith(
      '/auth/login?redirect_uri=%2Fw%2Fws-1%2F%3Fdoc%3DREADME.md',
    )
  })

  it('creates a workspace and redirects to the matching scoped route when onboarding is disabled', async () => {
    const { apiFetchJson } = await import('../../utils/transport')
    apiFetchJson.mockResolvedValueOnce({
      response: { ok: true, status: 200 },
      data: { id: 'ws-new' },
    })
    const fetchWorkspaceList = vi.fn().mockResolvedValue([{ id: 'ws-new', name: 'New Workspace' }])
    const assign = vi.fn()
    window.history.replaceState(null, '', '/w/ws-current/review')

    const { result } = renderHook(() => useWorkspaceRouter(makeProps({
      fetchWorkspaceList,
      assign,
    })))

    act(() => {
      result.current.handleCreateWorkspace()
    })
    expect(result.current.showCreateWorkspaceModal).toBe(true)

    await act(async () => {
      await result.current.handleCreateWorkspaceSubmit('My Workspace')
    })

    expect(fetchWorkspaceList).toHaveBeenCalledTimes(1)
    expect(result.current.showCreateWorkspaceModal).toBe(false)
    expect(assign).toHaveBeenCalledWith('/w/ws-new/review')
  })

  it('auto-redirects authenticated root users to their first workspace after the list resolves', async () => {
    window.history.replaceState(null, '', '/')
    const replaceRoute = vi.fn((path) => {
      window.history.replaceState(null, '', path)
    })

    const { result } = renderHook(() => useWorkspaceRouter(makeProps({
      workspaceOptions: [{ id: 'ws-1', name: 'Workspace One' }],
      workspaceListStatus: 'success',
      replaceRoute,
    })))

    await waitFor(() => {
      expect(result.current.currentWorkspaceId).toBe('ws-1')
    })

    expect(replaceRoute).toHaveBeenCalledWith('/w/ws-1/')
  })

  it('switches to a selected workspace using the current subpath when onboarding is disabled', async () => {
    window.history.replaceState(null, '', '/w/ws-current/settings')
    const promptForWorkspace = vi.fn(() => 'ws-target')
    const assign = vi.fn()
    const fetchWorkspaceList = vi.fn().mockResolvedValue([
      { id: 'ws-current', name: 'Current' },
      { id: 'ws-target', name: 'Target' },
    ])

    const { result } = renderHook(() => useWorkspaceRouter(makeProps({
      fetchWorkspaceList,
      promptForWorkspace,
      assign,
    })))

    await act(async () => {
      await result.current.handleSwitchWorkspace()
    })

    expect(fetchWorkspaceList).toHaveBeenCalledTimes(1)
    expect(promptForWorkspace).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/w/ws-target/settings')
  })
})
