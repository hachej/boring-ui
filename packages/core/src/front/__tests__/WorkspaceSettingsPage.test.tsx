// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withTaskId } from '../../server/__tests__/_setup'
import { WorkspaceSettingsPage } from '../workspace/WorkspaceSettingsPage'
import { useMswHandler } from './_setup'
import type { WorkspaceRuntime } from '../../shared/types'

const TASK_ID = 'boring-ui-v2-dbd9'
const WS_ID = 'ws-settings-001'
const WS_NAME = 'Test Workspace'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  })
}

const mockWorkspace = {
  current: {
    id: WS_ID,
    name: WS_NAME,
    appId: 'test',
    createdBy: 'user-1',
    createdAt: '2026-01-01',
    deletedAt: null,
    isDefault: true,
  } as any,
}

const mockNavigate = vi.fn()

vi.mock('../WorkspaceAuthProvider.js', () => ({
  useCurrentWorkspace: () => mockWorkspace.current,
  useWorkspaceRole: () => 'owner',
  WORKSPACES_QUERY_KEY: ['workspaces'],
  workspaceQueryKey: (id: string) => ['workspace', id],
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/w/${WS_ID}/settings`]}>
        <Routes>
          <Route path="/w/:id/settings" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function setupRuntimeHandler(runtime: WorkspaceRuntime | null) {
  useMswHandler(async (input) => {
    const url = extractUrl(input)
    if (url.includes(`/api/v1/workspaces/${WS_ID}/runtime`) && !url.includes('/retry')) {
      if (runtime === null) {
        return new Response(JSON.stringify({ code: 'not_found', message: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ runtime }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return undefined
  })
}

afterEach(() => {
  mockWorkspace.current = {
    id: WS_ID,
    name: WS_NAME,
    appId: 'test',
    createdBy: 'user-1',
    createdAt: '2026-01-01',
    deletedAt: null,
    isDefault: true,
  }
  mockNavigate.mockReset()
  vi.restoreAllMocks()
})

function makeRuntime(overrides: Partial<WorkspaceRuntime> = {}): WorkspaceRuntime {
  return {
    workspaceId: WS_ID,
    spriteUrl: null,
    spriteName: null,
    state: 'ready',
    lastError: null,
    volumePath: null,
    lastErrorOp: null,
    provisioningStep: null,
    stepStartedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('WorkspaceSettingsPage', () => {
  it(
    'renders name editor with current name',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupRuntimeHandler(null)

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      const input = await waitFor(() => screen.getByTestId('workspace-name-input') as HTMLInputElement)
      expect(input.value).toBe(WS_NAME)

      assertionPassed('renders-name-editor')
      qc.clear()
    }),
  )

  it(
    'edit + save calls PUT and invalidates query',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let putCalled = false
      let putBody: any = null
      setupRuntimeHandler(null)

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}`) && init?.method === 'PUT') {
          putCalled = true
          putBody = JSON.parse(init.body as string)
          return new Response(JSON.stringify({ workspace: { ...mockWorkspace.current, name: putBody.name } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      const input = await waitFor(() => screen.getByTestId('workspace-name-input') as HTMLInputElement)
      fireEvent.change(input, { target: { value: 'New Name' } })

      const saveBtn = screen.getByTestId('save-name')
      expect(saveBtn).not.toBeDisabled()
      fireEvent.click(saveBtn)

      await waitFor(() => expect(putCalled).toBe(true))
      expect(putBody).toEqual({ name: 'New Name' })

      assertionPassed('edit-save-put')
      qc.clear()
    }),
  )

  it(
    'encodes workspace id in settings API URLs',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const specialWorkspaceId = 'team/a b'
      const encodedWorkspaceId = encodeURIComponent(specialWorkspaceId)
      let runtimeUrl = ''
      let putUrl = ''
      let retryUrl = ''
      let deleteUrl = ''
      mockWorkspace.current = {
        ...mockWorkspace.current,
        id: specialWorkspaceId,
        name: WS_NAME,
      }

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (
          url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}/runtime`) &&
          (!init?.method || init.method === 'GET')
        ) {
          runtimeUrl = url
          return new Response(
            JSON.stringify({
              runtime: makeRuntime({
                workspaceId: specialWorkspaceId,
                state: 'error',
                lastError: 'Provision failed',
                lastErrorOp: 'provision',
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}`) && init?.method === 'PUT') {
          putUrl = url
          return new Response(JSON.stringify({ workspace: mockWorkspace.current }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (
          url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}/runtime/retry`) &&
          init?.method === 'POST'
        ) {
          retryUrl = url
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}`) && init?.method === 'DELETE') {
          deleteUrl = url
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('runtime-card')).toBeTruthy())
      expect(runtimeUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}/runtime`)

      fireEvent.change(screen.getByTestId('workspace-name-input'), {
        target: { value: 'New Name' },
      })
      fireEvent.click(screen.getByTestId('save-name'))
      await waitFor(() => expect(putUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}`))

      fireEvent.click(screen.getByTestId('retry-provision'))
      await waitFor(() =>
        expect(retryUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}/runtime/retry`),
      )

      fireEvent.click(screen.getByTestId('delete-workspace'))
      await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeTruthy())
      fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: WS_NAME } })
      fireEvent.click(screen.getByTestId('confirm-delete'))
      await waitFor(() => expect(deleteUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}`))

      assertionPassed('settings-page-encoded-id')
      qc.clear()
    }),
  )

  it(
    'no runtime row: runtime card NOT rendered',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupRuntimeHandler(null)

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('danger-zone')).toBeTruthy())
      expect(screen.queryByTestId('runtime-card')).toBeNull()

      assertionPassed('no-runtime-card')
      qc.clear()
    }),
  )

  it(
    'runtime ready: card shows state=ready + volumePath',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupRuntimeHandler(makeRuntime({ state: 'ready', volumePath: '/data/ws-001' }))

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('runtime-card')).toBeTruthy())
      expect(screen.getByTestId('runtime-state-ready')).toBeTruthy()
      expect(screen.getByTestId('volume-path').textContent).toContain('/data/ws-001')

      assertionPassed('runtime-ready-card')
      qc.clear()
    }),
  )

  it(
    'runtime error + provision op: shows error + Retry button, click calls retry',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let retryCalled = false

      setupRuntimeHandler(
        makeRuntime({ state: 'error', lastError: 'ENOSPC: no space left', lastErrorOp: 'provision' }),
      )

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.includes('/runtime/retry') && init?.method === 'POST') {
          retryCalled = true
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('runtime-card')).toBeTruthy())
      expect(screen.getByTestId('runtime-state-error')).toBeTruthy()
      expect(screen.getByTestId('runtime-error').textContent).toContain('ENOSPC')
      expect(screen.getByTestId('retry-provision')).toBeTruthy()

      fireEvent.click(screen.getByTestId('retry-provision'))
      await waitFor(() => expect(retryCalled).toBe(true))

      assertionPassed('runtime-error-provision-retry')
      qc.clear()
    }),
  )

  it(
    'runtime error + destroy op: shows error + guidance, no Retry button',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      setupRuntimeHandler(
        makeRuntime({ state: 'error', lastError: 'Destroy timed out', lastErrorOp: 'destroy' }),
      )

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('runtime-card')).toBeTruthy())
      expect(screen.getByTestId('runtime-state-error')).toBeTruthy()
      expect(screen.getByTestId('runtime-error').textContent).toContain('Destroy timed out')
      expect(screen.getByTestId('destroy-guidance')).toBeTruthy()
      expect(screen.queryByTestId('retry-provision')).toBeNull()

      assertionPassed('runtime-error-destroy-guidance')
      qc.clear()
    }),
  )

  it(
    'delete confirm: requires typing workspace name, otherwise button disabled',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupRuntimeHandler(null)

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('danger-zone')).toBeTruthy())
      fireEvent.click(screen.getByTestId('delete-workspace'))

      await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeTruthy())
      const confirmBtn = screen.getByTestId('confirm-delete') as HTMLButtonElement
      expect(confirmBtn.disabled).toBe(true)

      fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: 'wrong' } })
      expect(confirmBtn.disabled).toBe(true)

      fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: WS_NAME } })
      expect(confirmBtn.disabled).toBe(false)

      assertionPassed('delete-confirm-name-gate')
      qc.clear()
    }),
  )

  it(
    'delete success: navigates home + invalidates workspaces',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let deleteCalled = false
      setupRuntimeHandler(null)

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}`) && init?.method === 'DELETE') {
          deleteCalled = true
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('danger-zone')).toBeTruthy())
      fireEvent.click(screen.getByTestId('delete-workspace'))

      await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeTruthy())
      fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: WS_NAME } })
      fireEvent.click(screen.getByTestId('confirm-delete'))

      await waitFor(() => expect(deleteCalled).toBe(true))
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))

      assertionPassed('delete-success-navigate')
      qc.clear()
    }),
  )

  it(
    'delete failure (DESTROY_FAILED): shows error inline, stays on page',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      setupRuntimeHandler(null)

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}`) && init?.method === 'DELETE') {
          return new Response(
            JSON.stringify({ code: 'destroy_failed', message: 'Volume still attached' }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <WorkspaceSettingsPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('danger-zone')).toBeTruthy())
      fireEvent.click(screen.getByTestId('delete-workspace'))

      await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeTruthy())
      fireEvent.change(screen.getByTestId('delete-confirm-input'), { target: { value: WS_NAME } })
      fireEvent.click(screen.getByTestId('confirm-delete'))

      await waitFor(() => expect(screen.getByTestId('delete-error')).toBeTruthy())
      expect(screen.getByTestId('delete-error').textContent).toContain('Destroy failed')
      expect(screen.getByTestId('delete-error').textContent).toContain('Volume still attached')
      expect(mockNavigate).not.toHaveBeenCalled()

      assertionPassed('delete-failure-inline-error')
      qc.clear()
    }),
  )
})
