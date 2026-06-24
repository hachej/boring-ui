// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUseSession = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: vi.fn(),
    signIn: { email: vi.fn() },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

const mockApiFetchJson = vi.fn()
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>()
  return {
    ...actual,
    apiFetchJson: (...args: unknown[]) => mockApiFetchJson(...args),
  }
})

import { ConfigProvider } from '../ConfigProvider'
import { AuthProvider } from '../auth/AuthProvider'
import { UserIdentityProvider, useUser } from '../auth/UserIdentityProvider'

beforeEach(() => {
  vi.clearAllMocks()
})

function createWrapper(opts?: { withConfig?: boolean }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const content = (
      <AuthProvider baseURL="http://localhost:3000">
        <UserIdentityProvider>{children}</UserIdentityProvider>
      </AuthProvider>
    )

    return opts?.withConfig
      ? <ConfigProvider retryBackoff={[]}>{content}</ConfigProvider>
      : content
  }
}

describe('UserIdentityProvider', () => {
  it('returns null when no session', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useUser(), {
      wrapper: createWrapper(),
    })

    expect(result.current).toBeNull()
  })

  it('does not fetch /api/v1/me when email verification is required and session is unverified', async () => {
    mockApiFetchJson.mockImplementation(async (url: string) => {
      if (url === '/api/v1/config') {
        return {
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
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'u1', email: 'test@test.dev', name: 'Test User', emailVerified: false },
        session: { expiresAt: new Date('2026-02-01') },
      },
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useUser(), {
      wrapper: createWrapper({ withConfig: true }),
    })

    await waitFor(() => {
      expect(mockApiFetchJson).toHaveBeenCalledWith('/api/v1/config')
    })

    expect(mockApiFetchJson).not.toHaveBeenCalledWith('/api/v1/me')
    expect(result.current).toBeNull()
  })

  it('fetches /api/v1/me when session exists', async () => {
    const meResponse = {
      user: {
        id: 'u1',
        email: 'test@test.dev',
        name: 'Test User',
        emailVerified: true,
        image: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      settings: {
        displayName: 'Test User',
        email: 'test@test.dev',
        settings: { theme: 'dark' },
      },
    }
    mockApiFetchJson.mockResolvedValue(meResponse)

    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'u1', email: 'test@test.dev', name: 'Test User' },
        session: { expiresAt: new Date('2026-02-01') },
      },
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useUser(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    expect(mockApiFetchJson).toHaveBeenCalledWith('/api/v1/me')
    expect(result.current!.user.id).toBe('u1')
    expect(result.current!.user.email).toBe('test@test.dev')
    expect(result.current!.settings.displayName).toBe('Test User')
    expect(result.current!.settings.settings).toEqual({ theme: 'dark' })
  })

  it('resets to null when session disappears', async () => {
    const meResponse = {
      user: { id: 'u1', email: 'test@test.dev', name: 'Test', emailVerified: true, image: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      settings: { displayName: '', email: '', settings: {} },
    }
    mockApiFetchJson.mockResolvedValue(meResponse)

    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'u1', email: 'test@test.dev', name: 'Test' },
        session: { expiresAt: new Date('2026-02-01') },
      },
      isPending: false,
      error: null,
    })

    const { result, rerender } = renderHook(() => useUser(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    })

    rerender()

    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })

  it('returns null if /api/v1/me fetch fails', async () => {
    mockApiFetchJson.mockRejectedValue(new Error('Network error'))

    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'u2', email: 'fail@test.dev', name: 'Fail' },
        session: { expiresAt: new Date('2026-02-01') },
      },
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useUser(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(mockApiFetchJson).toHaveBeenCalled()
    })

    expect(result.current).toBeNull()
  })
})
