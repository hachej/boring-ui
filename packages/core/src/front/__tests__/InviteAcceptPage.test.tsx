// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import { InviteAcceptPage } from '../auth/InviteAcceptPage'
import { useMswHandler } from './_setup'

const BEAD_ID = 'boring-ui-v2-zgbi'
const TOKEN = 'test-invite-token-abc123'
const WS_ID = 'ws-001'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  })
}

const mockSession = {
  current: {
    data: { user: { id: 'user-1', email: 'bob@test.dev' }, expiresAt: '2027-01-01T00:00:00.000Z' },
    isPending: false,
    error: null,
  } as { data: any; isPending: boolean; error: any },
}

vi.mock('../auth/AuthProvider.js', () => ({
  useSession: () => mockSession.current,
}))

const navigatedTo: string[] = []
const mockNavigate = vi.fn((to: string) => navigatedTo.push(to))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/invites/${TOKEN}`]}>
        <Routes>
          <Route path="/invites/:token" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

afterEach(() => {
  mockSession.current = {
    data: { user: { id: 'user-1', email: 'bob@test.dev' }, expiresAt: '2027-01-01T00:00:00.000Z' },
    isPending: false,
    error: null,
  }
  navigatedTo.length = 0
  mockNavigate.mockClear()
  vi.restoreAllMocks()
})

describe('InviteAcceptPage', () => {
  it(
    'redirects to signin when signed out',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      mockSession.current = { data: null, isPending: false, error: null }

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      expect(screen.getByText('Sign in to accept this invite')).toBeTruthy()
      const signinBtn = screen.getByTestId('signin-redirect')
      fireEvent.click(signinBtn)

      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/auth/signin?redirect='),
      )
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(`/invites/${TOKEN}`)),
      )

      assertionPassed('signed-out-redirect')
      qc.clear()
    }),
  )

  it(
    'renders preview with workspace name and role on resolve success',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              workspaceName: 'Acme Corp',
              role: 'editor',
              expiresAt: '2026-05-05T00:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeTruthy())
      expect(screen.getByText(/editor/)).toBeTruthy()
      expect(screen.getByTestId('accept-btn')).toBeTruthy()
      expect(screen.getByTestId('decline-btn')).toBeTruthy()

      assertionPassed('resolve-success-preview')
      qc.clear()
    }),
  )

  it(
    'renders "no longer valid" on resolve 404',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ code: 'invite_not_found', message: 'Invite not found' }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('resolve-error')).toBeTruthy())
      expect(screen.getByTestId('resolve-error').textContent).toContain('no longer valid')

      assertionPassed('resolve-404')
      qc.clear()
    }),
  )

  it(
    'renders "expired" on resolve 410',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ code: 'invite_expired', message: 'Invite expired' }),
            { status: 410, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('resolve-error')).toBeTruthy())
      expect(screen.getByTestId('resolve-error').textContent).toContain('expired')

      assertionPassed('resolve-410')
      qc.clear()
    }),
  )

  it(
    'renders "locked" on resolve 423',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ code: 'invite_locked', message: 'Invite token is locked' }),
            { status: 423, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('resolve-error')).toBeTruthy())
      expect(screen.getByTestId('resolve-error').textContent).toContain('locked')
      expect(screen.getByTestId('resolve-error').textContent).toContain('too many failed attempts')

      assertionPassed('resolve-423')
      qc.clear()
    }),
  )

  it(
    'accept happy path: calls accept, navigates to workspace',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let acceptCalled = false

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              workspaceName: 'Acme Corp',
              role: 'editor',
              expiresAt: '2026-05-05T00:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith('/api/v1/invites/accept') && init?.method === 'POST') {
          acceptCalled = true
          return new Response(
            JSON.stringify({
              workspace: { id: WS_ID, name: 'Acme Corp' },
              member: { workspaceId: WS_ID, userId: 'user-1', role: 'editor' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('accept-btn')).toBeTruthy())
      fireEvent.click(screen.getByTestId('accept-btn'))

      await waitFor(() => expect(acceptCalled).toBe(true))
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(`/w/${WS_ID}`),
      )

      assertionPassed('accept-happy-path')
      qc.clear()
    }),
  )

  it(
    'accept wrong email: renders "for a different email"',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              workspaceName: 'Acme Corp',
              role: 'editor',
              expiresAt: '2026-05-05T00:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith('/api/v1/invites/accept') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              code: 'invite_email_mismatch',
              message: 'Email does not match invite',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('accept-btn')).toBeTruthy())
      fireEvent.click(screen.getByTestId('accept-btn'))

      await waitFor(() => expect(screen.getByTestId('accept-error')).toBeTruthy())
      expect(screen.getByTestId('accept-error').textContent).toContain(
        'different email',
      )

      assertionPassed('accept-wrong-email')
      qc.clear()
    }),
  )

  it(
    'decline navigates away without API call',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      const qc = createQueryClient()
      let acceptCalled = false

      useMswHandler(async (input, init) => {
        const url = extractUrl(input)
        if (url.endsWith('/api/v1/invites/resolve') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              workspaceName: 'Acme Corp',
              role: 'editor',
              expiresAt: '2026-05-05T00:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith('/api/v1/invites/accept')) {
          acceptCalled = true
        }
        return undefined
      })

      render(
        <Wrapper qc={qc}>
          <InviteAcceptPage />
        </Wrapper>,
      )

      await waitFor(() => expect(screen.getByTestId('decline-btn')).toBeTruthy())
      fireEvent.click(screen.getByTestId('decline-btn'))

      expect(mockNavigate).toHaveBeenCalledWith('/')
      expect(acceptCalled).toBe(false)

      assertionPassed('decline-no-api-call')
      qc.clear()
    }),
  )
})
