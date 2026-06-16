// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUseSession = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: vi.fn(),
    signIn: { email: vi.fn(), social: vi.fn() },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { AuthProvider } from '../auth/AuthProvider'
import { AuthGate } from '../AuthGate'
import type { AuthGateLocation } from '../AuthGate'

function makeSession({ emailVerified = true }: { emailVerified?: boolean } = {}) {
  return {
    data: {
      user: {
        id: 'u1',
        email: 'test@test.dev',
        name: 'Test',
        emailVerified,
        image: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      session: { expiresAt: new Date('2026-02-01') },
    },
    isPending: false,
    error: null,
  }
}

function makeAuthenticatedSession() {
  return makeSession()
}

function makeNullSession() {
  return {
    data: null,
    isPending: false,
    error: { status: 401, message: 'Unauthorized' },
  }
}

interface HarnessProps {
  location: AuthGateLocation
  navigate: (to: string, options?: { replace?: boolean }) => void
  now: () => number
  graceMs?: number
  publicPaths?: string[]
  requireEmailVerification?: boolean
  children?: ReactNode
}

function Harness({
  location,
  navigate,
  now,
  graceMs,
  publicPaths,
  requireEmailVerification,
  children,
}: HarnessProps) {
  return (
    <AuthProvider baseURL="http://localhost:3000">
      <AuthGate
        location={location}
        navigate={navigate}
        now={now}
        graceMs={graceMs}
        publicPaths={publicPaths}
        requireEmailVerification={requireEmailVerification}
      >
        {children ?? <div>Protected Content</div>}
      </AuthGate>
    </AuthProvider>
  )
}

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('redirects unauthenticated users to signin after sustained null session', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeNullSession())

    render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
      />,
    )

    expect(navigate).not.toHaveBeenCalled()

    nowMs += 29_000
    vi.advanceTimersByTime(29_000)
    expect(navigate).not.toHaveBeenCalled()

    nowMs += 1_000
    vi.advanceTimersByTime(1_000)

    expect(navigate).toHaveBeenCalledWith('/auth/signin?redirect=%2Fdashboard', {
      replace: true,
    })
  })

  it('does not redirect authenticated users on protected routes', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())

    render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
      />,
    )

    nowMs += 60_000
    vi.advanceTimersByTime(60_000)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('keeps users on current UI during a brief transient null session blip', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())

    const { rerender } = render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
      />,
    )

    mockUseSession.mockReturnValue(makeNullSession())
    rerender(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
      />,
    )

    nowMs += 20_000
    vi.advanceTimersByTime(20_000)
    expect(navigate).not.toHaveBeenCalled()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())
    rerender(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
      />,
    )

    nowMs += 20_000
    vi.advanceTimersByTime(20_000)

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('navigates back to ?redirect after signin when session becomes available', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())

    render(
      <Harness
        location={{
          pathname: '/auth/signin',
          search: '?redirect=%2Fworkspace%2Fabc%3Ftab%3Dfiles',
        }}
        navigate={navigate}
        now={() => 0}
      />,
    )

    expect(navigate).toHaveBeenCalledWith('/workspace/abc?tab=files', { replace: true })
  })

  it('falls back to "/" when signin has no redirect query', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())

    render(
      <Harness
        location={{ pathname: '/auth/signin' }}
        navigate={navigate}
        now={() => 0}
      />,
    )

    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('treats workspace route patterns in publicPaths as public', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeNullSession())

    render(
      <Harness
        location={{ pathname: '/projects/abc' }}
        navigate={navigate}
        now={now}
        publicPaths={['/', '/projects/:workspaceSlug']}
      />,
    )

    nowMs += 60_000
    vi.advanceTimersByTime(60_000)

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('does not treat nested paths under a public workspace route as public by default', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeNullSession())

    render(
      <Harness
        location={{ pathname: '/projects/abc/settings' }}
        navigate={navigate}
        now={now}
        publicPaths={['/', '/projects/:workspaceSlug']}
      />,
    )

    nowMs += 60_000
    vi.advanceTimersByTime(60_000)

    expect(navigate).toHaveBeenCalledWith('/auth/signin?redirect=%2Fprojects%2Fabc%2Fsettings', {
      replace: true,
    })
  })

  it('redirects unverified users to verify-email page when requireEmailVerification is true', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeSession({ emailVerified: false }))

    render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).toHaveBeenCalledWith('/auth/verify-email', { replace: true })
    expect(screen.queryByText('Protected Content')).toBeNull()
  })

  it('allows unverified users on verify-email page when requireEmailVerification is true', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeSession({ emailVerified: false }))

    render(
      <Harness
        location={{ pathname: '/auth/verify-email' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('allows unverified users on auth pages when requireEmailVerification is true', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeSession({ emailVerified: false }))

    // Auth pages are allowed for unverified users
    render(
      <Harness
        location={{ pathname: '/auth/verify-email' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).not.toHaveBeenCalled()

    // Also allow signup page
    navigate.mockClear()
    const { rerender } = render(
      <Harness
        location={{ pathname: '/auth/signup' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).not.toHaveBeenCalled()

    // Also allow forgot-password page
    navigate.mockClear()
    rerender(
      <Harness
        location={{ pathname: '/auth/forgot-password' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).not.toHaveBeenCalled()
  })

  it('redirects unverified users away from non-allowlisted auth pages', () => {
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeSession({ emailVerified: false }))

    render(
      <Harness
        location={{ pathname: '/auth/new-future-page' }}
        navigate={navigate}
        now={() => 0}
        requireEmailVerification
      />,
    )

    expect(navigate).toHaveBeenCalledWith('/auth/verify-email', { replace: true })
  })

  it('does not redirect verified users when requireEmailVerification is true', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeAuthenticatedSession())

    render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
        requireEmailVerification
      />,
    )

    nowMs += 60_000
    vi.advanceTimersByTime(60_000)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })

  it('does not enforce email verification when requireEmailVerification is false', () => {
    let nowMs = 0
    const now = () => nowMs
    const navigate = vi.fn()

    mockUseSession.mockReturnValue(makeSession({ emailVerified: false }))

    render(
      <Harness
        location={{ pathname: '/dashboard' }}
        navigate={navigate}
        now={now}
        requireEmailVerification={false}
      />,
    )

    nowMs += 60_000
    vi.advanceTimersByTime(60_000)
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Protected Content')).toBeTruthy()
  })
})
