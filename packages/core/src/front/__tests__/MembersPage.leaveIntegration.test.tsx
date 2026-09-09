// @vitest-environment jsdom
//
// Integration regression for the self-leave -> "/" redirect, using the real
// WorkspaceAuthProvider (unmocked) instead of MembersPage.test.tsx's mocked
// provider. This is the only way to catch the race a thermo review flagged:
// invalidateQueries() alone does not clear the *current* cached workspaces
// list/detail before navigate('/') runs, so WorkspaceAuthProvider (which
// resolves "/" synchronously off whatever is already cached) can redirect
// straight back into the workspace the user just left.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withTaskId } from '../../server/__tests__/_setup'
import type { Workspace } from '../../shared/types'
import { MembersPage } from '../workspace/MembersPage'
import { useCurrentWorkspace, WorkspaceAuthProvider } from '../WorkspaceAuthProvider'
import { useMswHandler } from './_setup'

const TASK_ID = 'boring-ui-v2-lv1n'

const OWNER_ID = 'user-owner'
const EDITOR_ID = 'user-editor'

const WS_1: Workspace = {
  id: 'ws-001',
  appId: 'test-app',
  workspaceTypeId: 'default',
  name: 'Workspace One',
  createdBy: OWNER_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  isDefault: true,
}

const WS_2: Workspace = {
  id: 'ws-002',
  appId: 'test-app',
  workspaceTypeId: 'default',
  name: 'Workspace Two',
  createdBy: OWNER_ID,
  createdAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  isDefault: false,
}

const mockSessionState = {
  current: {
    data: { user: { id: EDITOR_ID, email: 'editor@test.dev' } },
    isPending: false,
    error: null,
  } as any,
}

vi.mock('../auth/AuthProvider', () => ({
  useSession: () => mockSessionState.current,
}))

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
})

afterEach(() => {
  mockSessionState.current = {
    data: { user: { id: EDITOR_ID, email: 'editor@test.dev' } },
    isPending: false,
    error: null,
  }
  vi.restoreAllMocks()
})

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

// Records every workspace name/id the Home probe observes, in render order,
// including transient renders that a plain `waitFor` on the final state
// would never surface.
const observedHomeWorkspaces: Array<string | null> = []

function HomeProbe() {
  const workspace = useCurrentWorkspace()
  useEffect(() => {
    observedHomeWorkspaces.push(workspace?.id ?? null)
  })
  return <div data-testid="home-route">{workspace?.name ?? 'resolving…'}</div>
}

function Wrapper({ initialPath }: { initialPath: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/workspace/:id/members"
          element={
            <WorkspaceAuthProvider>
              <MembersPage />
            </WorkspaceAuthProvider>
          }
        />
        <Route
          path="/"
          element={
            <WorkspaceAuthProvider>
              <HomeProbe />
            </WorkspaceAuthProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('MembersPage leave -> "/" redirect (integration, real WorkspaceAuthProvider)', () => {
  it(
    'self-leave never redirects back into the just-left workspace, and resolves the next one',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
      })
      observedHomeWorkspaces.length = 0

      // Server-side ground truth: EDITOR_ID starts as a member of both
      // workspaces; leaving ws-001 removes it from subsequent /workspaces
      // and /workspaces/ws-001 responses, exactly like a real backend.
      let leftWorkspace = false
      let deleteCalled = false

      // The *first* GET /workspaces (initial page load) resolves normally.
      // Every subsequent call -- i.e. the invalidateQueries()-triggered
      // refetch that fires from the leave mutation's onSuccess -- is held
      // open on a deferred promise the test controls explicitly. This is
      // what makes the test meaningful: with a real backend, that refetch's
      // network round trip does not complete synchronously/instantly, so a
      // fix that relies on it to correct the cache (rather than updating
      // the cache atomically before navigating) would race a real redirect.
      // A same-tick-resolving mock fetch would hide exactly that race.
      let workspacesCallCount = 0
      const deferredWorkspacesRefetch: { release: (() => void) | null } = { release: null }

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)

        if (url.endsWith('/api/v1/workspaces')) {
          workspacesCallCount += 1
          if (workspacesCallCount > 1) {
            await new Promise<void>((resolve) => {
              deferredWorkspacesRefetch.release = resolve
            })
          }
          const workspaces = leftWorkspace ? [WS_2] : [WS_1, WS_2]
          return new Response(JSON.stringify({ workspaces }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/api/v1/workspaces/ws-001')) {
          if (leftWorkspace) {
            return new Response(
              JSON.stringify({ code: 'forbidden', message: 'Not a member of this workspace' }),
              { status: 403, headers: { 'content-type': 'application/json' } },
            )
          }
          return new Response(JSON.stringify({ workspace: WS_1, role: 'editor' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/api/v1/workspaces/ws-002')) {
          return new Response(JSON.stringify({ workspace: WS_2, role: 'editor' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/api/v1/workspaces/ws-001/members')) {
          return new Response(
            JSON.stringify({
              members: [
                { workspaceId: WS_1.id, role: 'owner', createdAt: WS_1.createdAt, userId: OWNER_ID, user: { id: OWNER_ID, email: 'owner@test.dev', name: 'Owner', image: null } },
                { workspaceId: WS_1.id, role: 'editor', createdAt: WS_1.createdAt, userId: EDITOR_ID, user: { id: EDITOR_ID, email: 'editor@test.dev', name: 'Editor', image: null } },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith(`/api/v1/workspaces/ws-001/members/${EDITOR_ID}`) && init?.method === 'DELETE') {
          deleteCalled = true
          leftWorkspace = true
          return new Response(JSON.stringify({ removed: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <QueryClientProvider client={qc}>
          <Wrapper initialPath="/workspace/ws-001/members" />
        </QueryClientProvider>,
      )

      await waitFor(() => expect(screen.getByTestId('members-list')).toBeTruthy())

      const leaveBtn = screen.getByTestId(`remove-${EDITOR_ID}`)
      expect(leaveBtn.textContent).toBe('Leave')
      fireEvent.click(leaveBtn)

      await waitFor(() => expect(screen.getByTestId('confirm-remove')).toBeTruthy())
      fireEvent.click(screen.getByTestId('confirm-remove'))

      await waitFor(() => expect(deleteCalled).toBe(true))
      // Wait for the invalidate-triggered second GET /workspaces to actually
      // be in flight (and parked on the deferred promise) before asserting
      // anything -- this proves the assertions below run *before* that
      // network round trip has any chance to resolve.
      await waitFor(() => expect(workspacesCallCount).toBeGreaterThan(1))
      await waitFor(() => expect(deferredWorkspacesRefetch.release).not.toBeNull())

      // Directly proves atomicity of the fix: by the time the mutation's
      // onSuccess callback has run, the cached workspaces list must already
      // exclude ws-001 -- synchronously, with no network round trip needed
      // -- so "/" can never observe a stale list containing it.
      const cachedWorkspaces = qc.getQueryData<Workspace[]>(['workspaces'])
      expect(cachedWorkspaces?.some((w) => w.id === WS_1.id)).toBe(false)

      // The redirect target must already be correct *before* the deferred
      // refetch resolves -- i.e. it does not depend on that network round
      // trip to avoid landing back on the just-left workspace.
      await waitFor(() =>
        expect(screen.getByTestId('home-route').textContent).toBe('Workspace Two'),
      )
      expect(observedHomeWorkspaces).not.toContain(WS_1.id)

      // Now let the deferred refetch resolve and confirm the outcome is
      // stable (no flip, in either direction).
      deferredWorkspacesRefetch.release?.()
      await waitFor(() =>
        expect(screen.getByTestId('home-route').textContent).toBe('Workspace Two'),
      )
      expect(observedHomeWorkspaces).not.toContain(WS_1.id)
      expect(observedHomeWorkspaces[observedHomeWorkspaces.length - 1]).toBe(WS_2.id)

      assertionPassed('self-leave-no-redirect-back-resolves-next-workspace')
      qc.clear()
    }),
  )
})
