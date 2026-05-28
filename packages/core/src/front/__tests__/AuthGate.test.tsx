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

function makeAuthenticatedSession() {
  return {
    data: {
      user: {
        id: 'u1',
        email: 'test@test.dev',
        name: 'Test',
        emailVerified: true,
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
  children?: ReactNode
}

function Harness({
  location,
  navigate,
  now,
  graceMs,
  publicPaths,
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
})
