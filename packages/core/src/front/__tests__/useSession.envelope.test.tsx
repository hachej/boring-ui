// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockUseSession = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: vi.fn(),
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { AuthProvider, useSession } from '../auth/AuthProvider'

function Probe({ onResult }: { onResult: (data: ReturnType<typeof useSession>['data']) => void }) {
  const session = useSession()
  onResult(session.data)
  return null
}

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSession resilience to envelope shapes', () => {
  // Regression: better-auth's useSession hook can transiently emit a
  // truthy envelope (`{ data: null, error: null }` etc.) that has no
  // `.user` field. The previous implementation branched on the outer
  // envelope being truthy and crashed inside `normalizeUser(undefined)`
  // — which surfaced as "Cannot read properties of undefined (reading
  // 'id')" + a full-screen AppErrorBoundary on every cold load of the
  // workspace-playground.

  it('returns data: null when better-auth has no active session (data: null)', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    })
    const captured: unknown[] = []
    render(
      <Wrapper>
        <Probe onResult={(d) => captured.push(d)} />
      </Wrapper>,
    )
    expect(captured.at(-1)).toBeNull()
  })

  it('returns data: null when the response is an envelope without user', () => {
    // The shape that crashed: data is truthy but has no .user.
    mockUseSession.mockReturnValue({
      data: { data: null, error: null },
      isPending: false,
      error: null,
    })
    const captured: unknown[] = []
    expect(() =>
      render(
        <Wrapper>
          <Probe onResult={(d) => captured.push(d)} />
        </Wrapper>,
      ),
    ).not.toThrow()
    expect(captured.at(-1)).toBeNull()
  })

  it('returns data: null while the session is pending', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
      error: null,
    })
    const captured: unknown[] = []
    render(
      <Wrapper>
        <Probe onResult={(d) => captured.push(d)} />
      </Wrapper>,
    )
    expect(captured.at(-1)).toBeNull()
  })

  it('returns the normalized user when better-auth resolves with a session', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'u-1',
          email: 'a@b.test',
          name: 'A',
          emailVerified: true,
          image: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        session: { expiresAt: '2027-01-01T00:00:00.000Z' },
      },
      isPending: false,
      error: null,
    })
    const captured: Array<{ user: { id: string; email: string } } | null> = []
    render(
      <Wrapper>
        <Probe onResult={(d) => captured.push(d as never)} />
      </Wrapper>,
    )
    expect(captured.at(-1)?.user.id).toBe('u-1')
    expect(captured.at(-1)?.user.email).toBe('a@b.test')
  })
})
