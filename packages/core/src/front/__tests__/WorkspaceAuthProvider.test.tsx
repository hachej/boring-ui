// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import type { MemberRole, Workspace } from '../../shared/types'
import {
  WorkspaceAuthProvider,
  useCurrentWorkspace,
  useWorkspaceRole,
} from '../WorkspaceAuthProvider'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-0o1k'

const WS_1: Workspace = {
  id: 'ws-001',
  appId: 'test-app',
  name: 'My Workspace',
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  isDefault: true,
  machineId: null,
  volumeId: null,
  flyRegion: null,
}

const WS_2: Workspace = {
  id: 'ws-002',
  appId: 'test-app',
  name: 'Second WS',
  createdBy: 'user-1',
  createdAt: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
  isDefault: false,
  machineId: null,
  volumeId: null,
  flyRegion: null,
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
) {
  return render(
    <QueryClientProvider client={queryClient}>
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceAuthProvider', () => {
  it(
    'resolves workspace by route param :id',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockWorkspaceDetail(WS_1, 'owner')

      renderWithRouter(`/workspace/${WS_1.id}`, qc)

      await waitFor(() =>
        expect(screen.getByTestId('ws-name').textContent).toBe('My Workspace'),
      )
      expect(screen.getByTestId('ws-role').textContent).toBe('owner')
      assertionPassed('workspace-by-id')
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
        expect(screen.getByTestId('ws-name').textContent).toBe('My Workspace'),
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
})
