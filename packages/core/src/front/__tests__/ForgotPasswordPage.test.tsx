// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockForgetPassword = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    forgetPassword: mockForgetPassword,
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
  mockForgetPassword.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ForgotPasswordPage', () => {
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
      expect(mockForgetPassword).toHaveBeenCalledWith({
        email: 'unknown@example.com',
        redirectTo: '/auth/reset-password',
      })
      assertionPassed('forgot-no-enumeration')
    }),
  )

  it(
    'shows success even when server throws (no enumeration)',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockForgetPassword.mockRejectedValue(new Error('Server error'))

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
      expect(mockForgetPassword).not.toHaveBeenCalled()
      assertionPassed('forgot-client-validation')
    }),
  )
})
