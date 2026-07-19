// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withTaskId } from '../../server/__tests__/_setup'
import type { WorkspaceInvite, Workspace, MemberRole } from '../../shared/types'
import { InvitesPage } from '../workspace/InvitesPage'
import { useMswHandler } from './_setup'

const TASK_ID = 'boring-ui-v2-npkl'
const WS_ID = 'ws-001'

const WORKSPACE: Workspace = {
  id: WS_ID,
  appId: 'test-app',
  workspaceTypeId: 'default',
  name: 'Test Workspace',
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  isDefault: true,
}

function makeInvite(overrides: Partial<WorkspaceInvite> = {}): WorkspaceInvite {
  return {
    id: 'inv-001',
    workspaceId: WS_ID,
    email: 'alice@test.dev',
    tokenHash: 'sha256:test',
    role: 'editor' as MemberRole,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    failedAttempts: 0,
    lockedUntil: null,
    ...overrides,
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  })
}

// Mock WorkspaceAuthProvider context
const mockWorkspace = { current: WORKSPACE as Workspace | null }
const mockRole = { current: 'owner' as MemberRole | null }

vi.mock('../WorkspaceAuthProvider.js', () => ({
  useCurrentWorkspace: () => mockWorkspace.current,
  useWorkspaceRole: () => mockRole.current,
}))

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/w/${WS_ID}/invites`]}>
        <Routes>
          <Route path="/w/:id/invites" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  mockWorkspace.current = WORKSPACE
  mockRole.current = 'owner'
  vi.restoreAllMocks()
})

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

describe('InvitesPage', () => {
  it(
    'renders existing invites',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const pending = makeInvite({ id: 'inv-p', email: 'pending@test.dev' })
      const accepted = makeInvite({
        id: 'inv-a',
        email: 'accepted@test.dev',
        acceptedAt: '2026-01-02T00:00:00.000Z',
      })
      const expired = makeInvite({
        id: 'inv-e',
        email: 'expired@test.dev',
        expiresAt: '2024-01-01T00:00:00.000Z',
      })

      useMswHandler(async (input) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`)) {
          return new Response(
            JSON.stringify({ invites: [pending, accepted, expired] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invites-list')).toBeTruthy())

      expect(screen.getByText('pending@test.dev')).toBeTruthy()
      expect(screen.getByText('accepted@test.dev')).toBeTruthy()
      expect(screen.getByText('expired@test.dev')).toBeTruthy()

      expect(screen.getByTestId('status-pending')).toBeTruthy()
      expect(screen.getByTestId('status-accepted')).toBeTruthy()
      expect(screen.getByTestId('status-expired')).toBeTruthy()

      assertionPassed('renders-existing-invites')
      qc.clear()
    }),
  )

  it(
    'creates invite with Idempotency-Key and invalidates query',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const capturedHeaders: Record<string, string>[] = []
      let postCount = 0

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`)) {
          if (init?.method === 'POST') {
            postCount++
            const headers: Record<string, string> = {}
            if (init.headers) {
              const h = init.headers as Record<string, string>
              for (const key of Object.keys(h)) {
                headers[key.toLowerCase()] = h[key]
              }
            }
            capturedHeaders.push(headers)
            const created = makeInvite({ email: 'new@test.dev' })
            return new Response(JSON.stringify({ invite: created }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            })
          }
          return new Response(JSON.stringify({ invites: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invite-form')).toBeTruthy())

      const emailInput = screen.getByLabelText('Email address')
      fireEvent.change(emailInput, { target: { value: 'new@test.dev' } })

      const submitBtn = screen.getByRole('button', { name: /send invite/i })
      fireEvent.click(submitBtn)

      await waitFor(() => expect(postCount).toBe(1))
      expect(capturedHeaders[0]['idempotency-key']).toBeTruthy()
      expect(capturedHeaders[0]['idempotency-key'].length).toBeGreaterThan(0)

      await waitFor(() =>
        expect(screen.getByText('Invite sent to new@test.dev')).toBeTruthy(),
      )
      assertionPassed('create-invite-with-idempotency-key')
      qc.clear()
    }),
  )

  it(
    'generates different Idempotency-Key per submission',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const capturedKeys: string[] = []

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`)) {
          if (init?.method === 'POST') {
            const h = init.headers as Record<string, string>
            capturedKeys.push(h['Idempotency-Key'] ?? h['idempotency-key'] ?? '')
            const created = makeInvite({ email: 'new@test.dev' })
            return new Response(JSON.stringify({ invite: created }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            })
          }
          return new Response(JSON.stringify({ invites: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invite-form')).toBeTruthy())

      // First submission
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'first@test.dev' },
      })
      fireEvent.click(screen.getByRole('button', { name: /send invite/i }))
      await waitFor(() => expect(capturedKeys.length).toBe(1))

      // Second submission
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'second@test.dev' },
      })
      fireEvent.click(screen.getByRole('button', { name: /send invite/i }))
      await waitFor(() => expect(capturedKeys.length).toBe(2))

      expect(capturedKeys[0]).not.toBe(capturedKeys[1])
      assertionPassed('different-idempotency-keys')
      qc.clear()
    }),
  )

  it(
    'revokes invite and invalidates query',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let deleteInviteId: string | null = null
      const pending = makeInvite({ id: 'inv-revoke', email: 'revoke@test.dev' })

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`) && (!init?.method || init.method === 'GET')) {
          return new Response(JSON.stringify({ invites: [pending] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        const deleteMatch = url.match(/\/invites\/(inv-[^/]+)$/)
        if (deleteMatch && init?.method === 'DELETE') {
          deleteInviteId = deleteMatch[1]
          return new Response(JSON.stringify({ revoked: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invites-list')).toBeTruthy())

      const revokeBtn = screen.getByTestId('revoke-inv-revoke')
      fireEvent.click(revokeBtn)

      await waitFor(() => expect(deleteInviteId).toBe('inv-revoke'))
      assertionPassed('revoke-invite')
      qc.clear()
    }),
  )

  it(
    'encodes workspace and invite ids in invite API URLs',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const specialWorkspaceId = 'team/a b'
      const specialInviteId = 'inv/a b'
      const encodedWorkspaceId = encodeURIComponent(specialWorkspaceId)
      const encodedInviteId = encodeURIComponent(specialInviteId)
      const pending = makeInvite({
        id: specialInviteId,
        workspaceId: specialWorkspaceId,
        email: 'special@test.dev',
      })
      let listUrl = ''
      let postUrl = ''
      let deleteUrl = ''
      mockWorkspace.current = { ...WORKSPACE, id: specialWorkspaceId }

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}/invites`)) {
          if (init?.method === 'POST') {
            postUrl = url
            return new Response(JSON.stringify({ invite: makeInvite({ email: 'new@test.dev' }) }), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            })
          }
          listUrl = url
          return new Response(JSON.stringify({ invites: [pending] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (
          url.endsWith(`/api/v1/workspaces/${encodedWorkspaceId}/invites/${encodedInviteId}`) &&
          init?.method === 'DELETE'
        ) {
          deleteUrl = url
          return new Response(JSON.stringify({ revoked: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invites-list')).toBeTruthy())
      expect(listUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}/invites`)

      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'new@test.dev' },
      })
      fireEvent.click(screen.getByRole('button', { name: /send invite/i }))
      await waitFor(() => expect(postUrl).toContain(`/api/v1/workspaces/${encodedWorkspaceId}/invites`))

      fireEvent.click(screen.getByTestId(`revoke-${specialInviteId}`))
      await waitFor(() =>
        expect(deleteUrl).toContain(
          `/api/v1/workspaces/${encodedWorkspaceId}/invites/${encodedInviteId}`,
        ),
      )

      assertionPassed('invite-page-encoded-ids')
      qc.clear()
    }),
  )

  it(
    'shows inline form error on duplicate email (422)',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`)) {
          if (init?.method === 'POST') {
            return new Response(
              JSON.stringify({
                code: 'validation_failed',
                message: 'An invite for this email already exists',
              }),
              { status: 422, headers: { 'content-type': 'application/json' } },
            )
          }
          return new Response(JSON.stringify({ invites: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invite-form')).toBeTruthy())

      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'dupe@test.dev' },
      })
      fireEvent.click(screen.getByRole('button', { name: /send invite/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain(
          'An invite for this email already exists',
        ),
      )
      assertionPassed('duplicate-email-error')
      qc.clear()
    }),
  )

  it(
    'shows correct status badges for expired and accepted invites',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      const expired = makeInvite({
        id: 'inv-exp',
        email: 'exp@test.dev',
        expiresAt: '2024-01-01T00:00:00.000Z',
      })
      const accepted = makeInvite({
        id: 'inv-acc',
        email: 'acc@test.dev',
        acceptedAt: '2026-01-05T00:00:00.000Z',
      })

      useMswHandler(async (input) => {
        const url = extractUrl(input)
        if (url.endsWith(`/api/v1/workspaces/${WS_ID}/invites`)) {
          return new Response(
            JSON.stringify({ invites: [expired, accepted] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('invites-list')).toBeTruthy())

      expect(screen.getByTestId('status-expired')).toBeTruthy()
      expect(screen.getByTestId('status-accepted')).toBeTruthy()

      // Expired/accepted invites should NOT have revoke buttons
      expect(screen.queryByTestId('revoke-inv-exp')).toBeNull()
      expect(screen.queryByTestId('revoke-inv-acc')).toBeNull()

      assertionPassed('status-badges')
      qc.clear()
    }),
  )

  it(
    'non-owner cannot see this page',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockRole.current = 'editor'

      render(
        <Wrapper qc={qc}>
          <InvitesPage />
        </Wrapper>,
      )

      expect(screen.getByText('Access denied')).toBeTruthy()
      expect(screen.queryByTestId('invite-form')).toBeNull()

      assertionPassed('non-owner-denied')
      qc.clear()
    }),
  )
})
