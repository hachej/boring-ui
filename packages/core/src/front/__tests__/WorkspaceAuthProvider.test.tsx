// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSessionState = vi.hoisted(() => ({
  current: {
    data: {
      user: {
        id: 'user-1',
        email: 'user-1@test.dev',
        name: null,
        emailVerified: true,
        image: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
    isPending: false,
    error: null,
  } as any,
}))

vi.mock('../auth/AuthProvider', () => ({
  useSession: () => mockSessionState.current,
}))

import { withBeadId } from '../../server/__tests__/_setup'
import type { MemberRole, RuntimeConfig, Workspace } from '../../shared/types'
import { ConfigProvider } from '../ConfigProvider'
import {
  WORKSPACES_QUERY_KEY,
  WorkspaceAuthProvider,
  useCurrentWorkspace,
  useWorkspaceRole,
  workspaceQueryKey,
} from '../WorkspaceAuthProvider'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-un4j'

const WS_1: Workspace = {
  id: 'ws-001',
  appId: 'test-app',
  name: 'Default workspace',
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  isDefault: true,
}

const RUNTIME_CONFIG: RuntimeConfig = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  apiBase: '',
  features: {
    githubOauth: false,
    googleOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: true,
    emailVerification: true,
  },
}

const WS_2: Workspace = {
  id: 'ws-002',
  appId: 'test-app',
  name: 'Second WS',
  createdBy: 'user-1',
  createdAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  isDefault: false,
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
}

function Probe() {
  const workspace = useCurrentWorkspace()
  const role = useWorkspaceRole()
  return (
    <div>
      <span data-testid="ws-name">{workspace?.name ?? 'none'}</span>
      <span data-testid="ws-role">{role ?? 'none'}</span>
    </div>
  )
}

function renderWithRouter(
  initialPath: string,
  queryClient: QueryClient,
  options?: { withConfig?: boolean },
) {
  const routes = (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspace/:id"
          element={
            <WorkspaceAuthProvider>
              <Probe />
            </WorkspaceAuthProvider>
          }
        />
        <Route
          path="/"
          element={
            <WorkspaceAuthProvider>
              <Probe />
            </WorkspaceAuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  )

  const content = options?.withConfig
    ? <ConfigProvider retryBackoff={[]}>{routes}</ConfigProvider>
    : routes

  return render(
    <QueryClientProvider client={queryClient}>
      {content}
    </QueryClientProvider>,
  )
}

function mockWorkspaceDetail(ws: Workspace, role: MemberRole) {
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.endsWith(`/api/v1/workspaces/${ws.id}`)) return undefined
    return new Response(JSON.stringify({ workspace: ws, role }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function mockConfig(config: RuntimeConfig) {
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.endsWith('/api/v1/config')) return undefined
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function mockWorkspacesList(workspaces: Workspace[]) {
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.endsWith('/api/v1/workspaces')) return undefined
    return new Response(JSON.stringify({ workspaces }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function mockDeferredWorkspaceDetail(
  workspaceId: string,
  responsePromise: Promise<Response>,
) {
  useMswHandler(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    if (!url.endsWith(`/api/v1/workspaces/${workspaceId}`)) return undefined
    return await responsePromise
  })
}

beforeEach(() => {
  mockSessionState.current = {
    data: {
      user: {
        id: 'user-1',
        email: 'user-1@test.dev',
        name: null,
        emailVerified: true,
        image: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
    isPending: false,
    error: null,
  }
})

function setUnauthenticatedSession() {
  mockSessionState.current = { data: null, isPending: false, error: null }
}

function setPendingSession() {
  mockSessionState.current = { data: null, isPending: true, error: null }
}

function setUnverifiedSession() {
  mockSessionState.current = {
    ...mockSessionState.current,
    data: mockSessionState.current.data
      ? {
          ...mockSessionState.current.data,
          user: {
            ...mockSessionState.current.data.user,
            emailVerified: false,
          },
        }
      : null,
  }
}

function waitOneTick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceAuthProvider', () => {
  it(
    'does not fetch workspace list or detail when email verification is required and user is unverified',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let workspaceRequests = 0
      setUnverifiedSession()
      mockConfig(RUNTIME_CONFIG)

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.includes('/api/v1/workspaces')) {
          workspaceRequests += 1
          return new Response(JSON.stringify({ workspaces: [WS_1] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      renderWithRouter(`/workspace/${WS_1.id}`, qc, { withConfig: true })
      await waitFor(() => expect(screen.getByTestId('ws-name').textContent).toBe('none'))
      await waitOneTick()

      expect(workspaceRequests).toBe(0)
      assertionPassed('workspace-unverified-no-fetch')
    }),
  )

  it(
    'does not fetch workspace list or detail before auth resolves',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let workspaceRequests = 0
      setUnauthenticatedSession()

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.includes('/api/v1/workspaces')) {
          workspaceRequests += 1
          return new Response(JSON.stringify({ workspaces: [WS_1] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      renderWithRouter(`/workspace/${WS_1.id}`, qc)
      await waitOneTick()

      expect(screen.getByTestId('ws-name').textContent).toBe('none')
      expect(screen.getByTestId('ws-role').textContent).toBe('none')
      expect(workspaceRequests).toBe(0)
      assertionPassed('no-workspace-fetch-before-auth')
      qc.clear()
    }),
  )

  it(
    'does not fetch workspace list while session is pending',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let workspaceRequests = 0
      setPendingSession()

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.includes('/api/v1/workspaces')) {
          workspaceRequests += 1
          return new Response(JSON.stringify({ workspaces: [WS_1] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      renderWithRouter('/', qc)
      await waitOneTick()

      expect(screen.getByTestId('ws-name').textContent).toBe('none')
      expect(workspaceRequests).toBe(0)
      assertionPassed('no-workspace-fetch-while-session-pending')
      qc.clear()
    }),
  )

  it(
    'resolves workspace by route param :id',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([WS_1])
      mockWorkspaceDetail(WS_1, 'owner')

      renderWithRouter(`/workspace/${WS_1.id}`, qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-by-id')
      qc.clear()
    }),
  )

  it(
    'encodes route workspace id before fetching detail',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const specialWs: Workspace = { ...WS_1, id: 'team/a b' }
      let requestedUrl = ''

      mockWorkspacesList([specialWs])
      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        requestedUrl = url
        if (!url.endsWith(`/api/v1/workspaces/${encodeURIComponent(specialWs.id)}`))
          return undefined
        return new Response(JSON.stringify({ workspace: specialWs, role: 'owner' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      renderWithRouter(`/workspace/${encodeURIComponent(specialWs.id)}`, qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(requestedUrl).toContain('/api/v1/workspaces/team%2Fa%20b')
      assertionPassed('workspace-route-id-encoded')
      qc.clear()
    }),
  )

  it(
    'falls back to default workspace when no :id param',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([WS_2, WS_1])
      mockWorkspaceDetail(WS_1, 'editor')

      renderWithRouter('/', qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('editor')
      assertionPassed('workspace-fallback-default')
      qc.clear()
    }),
  )

  it(
    'falls back to first workspace when no default exists',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const noDefault = { ...WS_2, isDefault: false }
      mockWorkspacesList([noDefault])
      mockWorkspaceDetail(noDefault, 'viewer')

      renderWithRouter('/', qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('viewer')
      assertionPassed('workspace-fallback-first')
      qc.clear()
    }),
  )

  it(
    'returns null when user has no workspaces',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([])

      renderWithRouter('/', qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('none'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('none')
      assertionPassed('workspace-empty-list')
      qc.clear()
    }),
  )

  it(
    'returns null on fetch error',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockWorkspacesList([WS_1])

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (url.endsWith(`/api/v1/workspaces/${WS_1.id}`)) {
          return new Response(JSON.stringify({ message: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      renderWithRouter(`/workspace/${WS_1.id}`, qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('none'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('none')
      assertionPassed('workspace-fetch-error')
      qc.clear()
    }),
  )

  it(
    'returns cached workspace detail before refetching',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const renamed = { ...WS_1, name: 'Renamed Workspace' }
      let detailFetches = 0

      qc.setQueryData(WORKSPACES_QUERY_KEY, [WS_1])
      qc.setQueryData(workspaceQueryKey(WS_1.id), {
        workspace: WS_1,
        role: 'owner' satisfies MemberRole,
      })

      useMswHandler(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        if (!url.endsWith(`/api/v1/workspaces/${WS_1.id}`)) return undefined
        detailFetches += 1
        return new Response(JSON.stringify({ workspace: renamed, role: 'editor' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      renderWithRouter(`/workspace/${WS_1.id}`, qc)

      expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace')
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-cache-hit')

      await qc.invalidateQueries({ queryKey: workspaceQueryKey(WS_1.id) })

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Renamed Workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('editor')
      expect(detailFetches).toBeGreaterThan(0)
      assertionPassed('workspace-invalidation-refetch')
      qc.clear()
    }),
  )

  it(
    'surfaces null while workspace detail is loading',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let resolveResponse: (response: Response) => void = () => {}
      const responsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })

      mockWorkspacesList([WS_1])
      mockDeferredWorkspaceDetail(WS_1.id, responsePromise)

      renderWithRouter(`/workspace/${WS_1.id}`, qc)

      expect(screen.getByTestId('ws-name').textContent).toBe('none')
      expect(screen.getByTestId('ws-role').textContent).toBe('none')
      assertionPassed('workspace-loading-null')

      resolveResponse(new Response(JSON.stringify({ workspace: WS_1, role: 'owner' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-loading-resolves')
      qc.clear()
    }),
  )
})
