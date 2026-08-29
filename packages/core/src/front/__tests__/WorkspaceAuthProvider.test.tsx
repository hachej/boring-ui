// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
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

import { withTaskId } from '../../server/__tests__/_setup'
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

const TASK_ID = 'boring-ui-v2-un4j'

const WS_1: Workspace = {
  id: 'ws-001',
  appId: 'test-app',
  workspaceTypeId: 'default',
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
  workspaceTypeId: 'default',
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

/** Mirrors CoreFront.tsx's real composition: WorkspaceAuthProvider is mounted ONCE, above
 * `<Routes>`, wrapping the whole router — not per-route inside a `<Route element>` (that's
 * why the component parses `location.pathname` itself via `workspaceIdFromPath` rather than
 * relying solely on `useParams`, which only populates inside a matched `<Route>` element).
 * Consequently route navigation, and — since AuthProvider's `client` is a stable `useMemo`
 * keyed only on `baseURL` and `client.useSession()` is better-auth's reactive store hook —
 * a real sign-out/sign-in, never remounts this tree; it only re-renders in place. This
 * harness exposes `navigate` so a test can drive that same in-place transition. */
function NavCapture({ onReady }: { onReady: (navigate: (path: string) => void) => void }) {
  const navigate = useNavigate()
  useEffect(() => {
    onReady(navigate)
  }, [navigate, onReady])
  return null
}

function renderTopLevelProvider(initialPath: string, queryClient: QueryClient) {
  let navigateFn: (path: string) => void = () => {}
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkspaceAuthProvider>
          <NavCapture onReady={(nav) => { navigateFn = nav }} />
          <Probe />
        </WorkspaceAuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, navigate: (path: string) => navigateFn(path) }
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

const USER_1_ID = 'user-1'
const USER_2_ID = 'user-2'

function lastWorkspaceStorageKey(userId: string): string {
  return `boring-core:last-workspace:${userId}`
}

function sessionFor(userId: string) {
  return {
    data: {
      user: {
        id: userId,
        email: `${userId}@test.dev`,
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
}

beforeEach(() => {
  window.localStorage.clear()
  mockSessionState.current = sessionFor(USER_1_ID)
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
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

  it(
    'restores the last-selected workspace on / after visiting it via route, surviving sign-out/in',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      // Visit the non-default workspace explicitly — this records it as "last selected".
      const first = renderWithRouter(`/workspace/${WS_2.id}`, qc)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)
      first.unmount()
      qc.clear()

      // Simulate sign-out/in: query cache clears (as AuthProvider.signOut does), but
      // localStorage persists. Landing on `/` afresh should restore WS_2, not the default.
      const qc2 = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      renderWithRouter('/', qc2)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('editor')
      assertionPassed('workspace-restored-last-selected')
      qc2.clear()
    }),
  )

  it(
    'falls back to the default workspace when the remembered id is stale (no longer a member)',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      window.localStorage.setItem(
        lastWorkspaceStorageKey(USER_1_ID),
        'ws-deleted-or-not-a-member',
      )
      mockWorkspacesList([WS_2, WS_1])
      mockWorkspaceDetail(WS_1, 'owner')

      renderWithRouter('/', qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-stale-last-selected-falls-back-to-default')
      qc.clear()
    }),
  )

  it(
    'does not steer a second user to the first user\'s remembered workspace on a shared browser, even when both are members of it',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      // User A (user-1) visits the shared, non-default workspace WS_2 — recorded as
      // user-1's last-selected workspace.
      const qcA = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      const rendered = renderWithRouter(`/workspace/${WS_2.id}`, qcA)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_2_ID))).toBeNull()
      rendered.unmount()
      qcA.clear()

      // User B (user-2) — a shared browser, same localStorage — signs in. B is also a
      // member of WS_2, but has never selected it. B must land on their own default
      // (WS_1), not on A's remembered WS_2.
      mockSessionState.current = sessionFor(USER_2_ID)
      const qcB = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'viewer')
      mockWorkspaceDetail(WS_2, 'viewer')

      renderWithRouter('/', qcB)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('viewer')
      assertionPassed('workspace-second-user-not-steered-by-first-user-shared-membership')
      qcB.clear()
    }),
  )

  it(
    'does not steer a second user (not a member of the first user\'s workspace) to a forbidden workspace',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      // User A (user-1) visits WS_2 — recorded as user-1's last-selected workspace.
      const qcA = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      const rendered = renderWithRouter(`/workspace/${WS_2.id}`, qcA)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)
      rendered.unmount()
      qcA.clear()

      // User B signs in on the same browser but is NOT a member of WS_2 at all — their
      // workspace list only contains WS_1. B must land on WS_1, never on WS_2.
      mockSessionState.current = sessionFor(USER_2_ID)
      const qcB = createQueryClient()
      mockWorkspacesList([WS_1])
      mockWorkspaceDetail(WS_1, 'owner')

      renderWithRouter('/', qcB)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-second-user-not-a-member-falls-back-to-own-default')
      qcB.clear()
    }),
  )

  it(
    'in-place identity change (same mounted tree, no unmount): B lands on B\'s default, never leaked from A, when B is also a member of A\'s remembered workspace',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      const { navigate } = renderTopLevelProvider(`/workspace/${WS_2.id}`, qc)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)

      // In-place transition A -> B on the SAME mounted WorkspaceAuthProvider instance: no
      // unmount anywhere in this test. Mutate the mocked session (standing in for
      // better-auth's reactive session store flipping in place) and register B's mocked
      // membership/detail responses (last-registered handler wins — see useMswHandler's
      // LIFO scan in ./_setup.ts), then clear the SAME QueryClient instance (exactly what
      // AuthProvider.signOut() does — it never creates a new client) and navigate within
      // the same tree from /workspace/ws-002 to / to force a re-render that observes the
      // new session.
      mockSessionState.current = sessionFor(USER_2_ID)
      qc.clear()
      mockWorkspacesList([WS_1, WS_2]) // B is also a member of the shared workspace WS_2
      mockWorkspaceDetail(WS_1, 'viewer')
      mockWorkspaceDetail(WS_2, 'viewer')

      act(() => navigate('/'))

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('viewer')
      // A's own preference is untouched by B's transition.
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)
      // A's remembered workspace id never leaked into B's key.
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_2_ID))).not.toBe(WS_2.id)
      assertionPassed('workspace-inplace-identity-change-member-variant')
      qc.clear()
    }),
  )

  it(
    'in-place identity change (same mounted tree, no unmount): B lands on B\'s default, never leaked from A, when B is NOT a member of A\'s remembered workspace',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspacesList([WS_1, WS_2])
      mockWorkspaceDetail(WS_1, 'owner')
      mockWorkspaceDetail(WS_2, 'editor')

      const { navigate } = renderTopLevelProvider(`/workspace/${WS_2.id}`, qc)
      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Second WS'),
      )
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)

      // Same in-place transition as above, but B's membership list does not include WS_2
      // at all — B is not a member of A's remembered workspace.
      mockSessionState.current = sessionFor(USER_2_ID)
      qc.clear()
      mockWorkspacesList([WS_1])
      mockWorkspaceDetail(WS_1, 'owner')

      act(() => navigate('/'))

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('Default workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_1_ID))).toBe(WS_2.id)
      expect(window.localStorage.getItem(lastWorkspaceStorageKey(USER_2_ID))).not.toBe(WS_2.id)
      assertionPassed('workspace-inplace-identity-change-non-member-variant')
      qc.clear()
    }),
  )
})
