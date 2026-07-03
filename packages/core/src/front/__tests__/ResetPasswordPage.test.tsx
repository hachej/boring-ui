// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockResetPassword = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    forgetPassword: vi.fn(),
    resetPassword: mockResetPassword,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withTaskId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { ResetPasswordPage } from '../auth/ResetPasswordPage'

const TASK_ID = 'boring-ui-v2-p8c9'

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
  mockSignOut.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('ResetPasswordPage', () => {
  it(
    'shows expired UI when no token in URL',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/reset-password')

      render(<ResetPasswordPage />, { wrapper: Wrapper })

      expect(screen.getByText(/link expired/i)).toBeTruthy()
      expect(screen.getByText(/request new link/i).closest('a')?.getAttribute('href')).toBe(
        '/auth/forgot-password',
      )
      assertionPassed('reset-no-token-expired')
    }),
  )

  it(
    'rejects mismatched passwords client-side without fetch',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/reset-password?token=valid-token')

      render(<ResetPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/new password/i), 'newpassword123')
      await user.type(screen.getByLabelText(/confirm password/i), 'different')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await waitFor(() =>
        expect(screen.getByText(/passwords do not match/i)).toBeTruthy(),
      )
      expect(mockResetPassword).not.toHaveBeenCalled()
      assertionPassed('reset-mismatch-no-fetch')
    }),
  )

  it(
    'shows expired UI on 410 server response',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/reset-password?token=expired-token')
      mockResetPassword.mockResolvedValue({
        error: { status: 410, message: 'Token expired' },
      })

      render(<ResetPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/new password/i), 'newpassword123')
      await user.type(screen.getByLabelText(/confirm password/i), 'newpassword123')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await waitFor(() =>
        expect(screen.getByText(/link expired/i)).toBeTruthy(),
      )
      assertionPassed('reset-expired-token')
    }),
  )

  it(
    'shows inline error for weak password from server',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/reset-password?token=valid-token')
      mockResetPassword.mockResolvedValue({
        error: { status: 400, message: 'Password is too common' },
      })

      render(<ResetPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/new password/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Password is too common'),
      )
      assertionPassed('reset-weak-password-error')
    }),
  )

  it(
    'rejects password shorter than 8 chars client-side',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/reset-password?token=valid-token')

      render(<ResetPasswordPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/new password/i), 'short')
      await user.type(screen.getByLabelText(/confirm password/i), 'short')
      await user.click(screen.getByRole('button', { name: /reset password/i }))

      await waitFor(() =>
        expect(screen.getByText(/at least 8 characters/i)).toBeTruthy(),
      )
      expect(mockResetPassword).not.toHaveBeenCalled()
      assertionPassed('reset-short-password')
    }),
  )
})
