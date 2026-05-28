// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockFetch = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    forgetPassword: vi.fn(),
    resetPassword: vi.fn(),
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withBeadId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { ForgotPasswordPage } from '../auth/ForgotPasswordPage'

const BEAD_ID = 'boring-ui-v2-p8c9'

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
  mockSignOut.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('ForgotPasswordPage', () => {
  it(
    'preserves redirect when linking back to sign in',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/forgot-password?redirect=%2Fworkspace%2Fabc')

      render(<ForgotPasswordPage />, { wrapper: Wrapper })

      expect(screen.getByText(/back to sign in/i).closest('a')?.getAttribute('href')).toBe(
        '/auth/signin?redirect=%2Fworkspace%2Fabc',
      )
      assertionPassed('forgot-back-link-preserves-redirect')
    }),
  )

  it(
    'shows success state for any email (no enumeration)',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<ForgotPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'unknown@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await waitFor(() =>
        expect(screen.getAllByText(/check your inbox/i).length).toBeGreaterThan(0),
      )
      expect(mockFetch).toHaveBeenCalledWith('/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: 'unknown@example.com',
          redirectTo: '/auth/reset-password',
        }),
      })
      assertionPassed('forgot-no-enumeration')
    }),
  )

  it(
    'shows success even when server throws (no enumeration)',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockFetch.mockRejectedValue(new Error('Server error'))

      render(<ForgotPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await waitFor(() =>
        expect(screen.getAllByText(/check your inbox/i).length).toBeGreaterThan(0),
      )
      assertionPassed('forgot-server-error-still-success')
    }),
  )

  it(
    'validates email client-side',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<ForgotPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'bad-email')
      await user.click(screen.getByRole('button', { name: /send reset link/i }))

      await waitFor(() =>
        expect(screen.getByText(/valid email/i)).toBeTruthy(),
      )
      expect(mockFetch).not.toHaveBeenCalled()
      assertionPassed('forgot-client-validation')
    }),
  )
})
