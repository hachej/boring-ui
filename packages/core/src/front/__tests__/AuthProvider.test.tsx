// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUseSession = vi.fn()
const mockSignOut = vi.fn()
const mockSignIn = { email: vi.fn(), social: vi.fn() }

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: mockSignIn,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { AuthProvider, useSession, useSignIn, useSignOut } from '../auth/AuthProvider'

beforeEach(() => {
  vi.clearAllMocks()
  mockSignOut.mockResolvedValue(undefined)
})

function createWrapper(props?: {
  queryClient?: { clear(): void }
  navigate?: (path: string) => void
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider
        baseURL="http://localhost:3000"
        queryClient={props?.queryClient}
        navigate={props?.navigate}
      >
        {children}
      </AuthProvider>
    )
  }
}

describe('useSession', () => {
  it('returns pending state when session is loading', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
      error: null,
    })

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeNull()
    expect(result.current.isPending).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('returns normalized user when session exists', () => {
    mockUseSession.mockReturnValue({
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
        session: {
          expiresAt: new Date('2026-02-01'),
        },
      },
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isPending).toBe(false)
    expect(result.current.data).not.toBeNull()
    expect(result.current.data!.user.id).toBe('u1')
    expect(result.current.data!.user.email).toBe('test@test.dev')
    expect(result.current.data!.user.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.current.data!.user.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.current.data!.expiresAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('returns null data when no session', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: null,
    })

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    })

    expect(result.current.data).toBeNull()
    expect(result.current.isPending).toBe(false)
  })

  it('maps better-auth error to SessionState.error', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      error: { status: 401, message: 'Unauthorized' },
    })

    const { result } = renderHook(() => useSession(), {
      wrapper: createWrapper(),
    })

    expect(result.current.error).toEqual({
      status: 401,
      code: 'unauthorized',
      message: 'Unauthorized',
    })
  })
})

describe('useSignIn', () => {
  it('returns the signIn object from auth client', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })

    const { result } = renderHook(() => useSignIn(), {
      wrapper: createWrapper(),
    })

    expect(result.current).toBe(mockSignIn)
  })
})

describe('useSignOut / signOut', () => {
  it('calls authClient.signOut', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })

    const { result } = renderHook(() => useSignOut(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current()
    })

    expect(mockSignOut).toHaveBeenCalledOnce()
  })

  it('clears queryClient after signOut', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
    const queryClient = { clear: vi.fn() }

    const { result } = renderHook(() => useSignOut(), {
      wrapper: createWrapper({ queryClient }),
    })

    await act(async () => {
      await result.current()
    })

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(queryClient.clear).toHaveBeenCalledOnce()
  })

  it('navigates to /auth/signin after signOut', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
    const navigate = vi.fn()

    const { result } = renderHook(() => useSignOut(), {
      wrapper: createWrapper({ navigate }),
    })

    await act(async () => {
      await result.current()
    })

    expect(navigate).toHaveBeenCalledWith('/auth/signin')
  })

  it('calls signOut → clear → navigate in order', async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
    const order: string[] = []
    mockSignOut.mockImplementation(async () => { order.push('signOut') })
    const queryClient = { clear: vi.fn(() => { order.push('clear') }) }
    const navigate = vi.fn(() => { order.push('navigate') })

    const { result } = renderHook(() => useSignOut(), {
      wrapper: createWrapper({ queryClient, navigate }),
    })

    await act(async () => {
      await result.current()
    })

    expect(order).toEqual(['signOut', 'clear', 'navigate'])
  })
})

describe('AuthProvider', () => {
  it('throws when hooks used outside provider', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })

    expect(() => {
      renderHook(() => useSession())
    }).toThrow('useSession/signIn/signOut must be used within an AuthProvider')
  })
})
