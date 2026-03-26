import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import WorkspaceSetupPage from '../pages/WorkspaceSetupPage'

const mockApiFetchJson = vi.fn()

vi.mock('../utils/transport', () => ({
  apiFetchJson: (...args) => mockApiFetchJson(...args),
  apiFetch: vi.fn(),
}))

vi.mock('../utils/apiBase', () => ({
  buildApiUrl: (path) => path,
}))

vi.mock('../components/GitHubConnect', () => ({
  useGitHubConnection: () => ({
    status: null,
    loading: false,
    connect: vi.fn(),
  }),
}))

vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

describe('WorkspaceSetupPage', () => {
  const originalLocation = window.location

  beforeEach(() => {
    mockApiFetchJson.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/w/ws-123/setup',
        search: '',
        assign: vi.fn(),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('loads runtime JSON from the runtime endpoint and auto-completes when ready', async () => {
    const onComplete = vi.fn()

    mockApiFetchJson.mockImplementation(async (path) => {
      if (path === '/api/capabilities') {
        return {
          response: { ok: true, status: 200 },
          data: { features: { files: true } },
        }
      }
      if (path === '/api/v1/workspaces/ws-123/runtime') {
        return {
          response: { ok: true, status: 200 },
          data: { runtime: { state: 'ready' } },
        }
      }
      throw new Error(`unexpected path: ${path}`)
    })

    render(
      <WorkspaceSetupPage
        workspaceId="ws-123"
        workspaceName="Test Workspace"
        capabilities={null}
        capabilitiesPending={false}
        onComplete={onComplete}
      />,
    )

    await waitFor(() => {
      expect(mockApiFetchJson).toHaveBeenCalledWith(
        '/api/v1/workspaces/ws-123/runtime',
        expect.objectContaining({
          query: undefined,
          headers: { Accept: 'application/json' },
        }),
      )
    })

    expect(
      mockApiFetchJson.mock.calls.some(([path]) => path === '/w/ws-123/setup'),
    ).toBe(false)

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
  })

  it('redirects to login when the runtime endpoint returns 401', async () => {
    mockApiFetchJson.mockImplementation(async (path) => {
      if (path === '/api/capabilities') {
        return {
          response: { ok: true, status: 200 },
          data: { features: { files: true } },
        }
      }
      if (path === '/api/v1/workspaces/ws-123/runtime') {
        return {
          response: { ok: false, status: 401 },
          data: {},
        }
      }
      throw new Error(`unexpected path: ${path}`)
    })

    render(
      <WorkspaceSetupPage
        workspaceId="ws-123"
        workspaceName="Test Workspace"
        capabilities={null}
        capabilitiesPending={false}
      />,
    )

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        '/auth/login?redirect_uri=%2Fw%2Fws-123%2Fsetup',
      )
    })
  })
})
