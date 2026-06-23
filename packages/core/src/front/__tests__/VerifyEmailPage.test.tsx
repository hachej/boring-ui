// @vitest-environment jsdom
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockVerifyEmail = vi.fn()
const mockSendVerificationEmail = vi.fn()
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
    verifyEmail: mockVerifyEmail,
    sendVerificationEmail: mockSendVerificationEmail,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withTaskId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { VerifyEmailPage } from '../auth/VerifyEmailPage'

const TASK_ID = 'boring-ui-v2-b2hj'

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
  mockSignOut.mockResolvedValue(undefined)
  mockVerifyEmail.mockResolvedValue({ data: { status: true }, error: null })
  mockSendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
  document.cookie = 'boring_invite_failed=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('VerifyEmailPage', () => {
  it(
    'shows invalid link UI when no token in URL',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/verify-email')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      expect(screen.getByText(/invalid verification link/i)).toBeTruthy()
      expect(screen.getByText(/no verification token found/i)).toBeTruthy()
      expect(mockVerifyEmail).not.toHaveBeenCalled()
      assertionPassed('no-token-invalid-ui')
    }),
  )

  it(
    'shows check-your-email UI for signed-in users redirected without a token',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', email: 'test@test.dev', emailVerified: false }, expiresAt: '' },
        isPending: false,
        error: null,
      })
      window.history.pushState({}, '', '/auth/verify-email')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      expect(screen.getByText(/check your email/i)).toBeTruthy()
      expect(screen.getByText(/we sent a verification link/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /resend verification email/i })).not.toBeDisabled()
      expect(mockVerifyEmail).not.toHaveBeenCalled()
      assertionPassed('no-token-signed-in-check-email-ui')
    }),
  )

  it(
    'shows verifying state then verified on success',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      let resolveVerify!: (v: unknown) => void
      mockVerifyEmail.mockReturnValue(
        new Promise((resolve) => {
          resolveVerify = resolve
        }),
      )
      window.history.pushState({}, '', '/auth/verify-email?token=valid-token')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      expect(screen.getByText(/verifying your email/i)).toBeTruthy()
      assertionPassed('shows-verifying')

      await act(async () => {
        resolveVerify({ data: { status: true, user: {} }, error: null })
      })

      await waitFor(() =>
        expect(screen.getByText(/email verified/i)).toBeTruthy(),
      )
      expect(screen.getByRole('link', { name: /continue/i })).toBeTruthy()
      assertionPassed('shows-verified')
    }),
  )

  it(
    'shows expired UI on 410 response',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockVerifyEmail.mockResolvedValue({
        data: null,
        error: { status: 410, message: 'Token expired' },
      })
      window.history.pushState({}, '', '/auth/verify-email?token=expired-token')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/link expired/i)).toBeTruthy(),
      )
      expect(screen.getByRole('button', { name: /resend verification email/i })).toBeTruthy()
      assertionPassed('expired-token-ui')
    }),
  )

  it(
    'shows invalid UI on generic error',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockVerifyEmail.mockResolvedValue({
        data: null,
        error: { status: 400, message: 'Invalid token' },
      })
      window.history.pushState({}, '', '/auth/verify-email?token=bad-token')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/invalid verification link/i)).toBeTruthy(),
      )
      assertionPassed('invalid-token-ui')
    }),
  )

  it(
    'shows invalid UI on thrown error',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockVerifyEmail.mockRejectedValue(new Error('Network error'))
      window.history.pushState({}, '', '/auth/verify-email?token=network-fail')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/invalid verification link/i)).toBeTruthy(),
      )
      assertionPassed('thrown-error-invalid-ui')
    }),
  )

  it(
    'resend button calls sendVerificationEmail with session email',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', email: 'test@test.dev', emailVerified: false }, expiresAt: '' },
        isPending: false,
        error: null,
      })
      mockVerifyEmail.mockResolvedValue({
        data: null,
        error: { status: 410, message: 'Expired' },
      })
      window.history.pushState({}, '', '/auth/verify-email?token=expired')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/link expired/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /resend verification email/i }))

      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        email: 'test@test.dev',
        callbackURL: '/auth/verify-email',
      })
      assertionPassed('resend-with-session-email')
    }),
  )

  it(
    'resend button requires email input when no session',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockVerifyEmail.mockResolvedValue({
        data: null,
        error: { status: 410, message: 'Expired' },
      })
      window.history.pushState({}, '', '/auth/verify-email?token=expired')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/link expired/i)).toBeTruthy(),
      )

      const resendBtn = screen.getByRole('button', { name: /resend verification email/i })
      expect(resendBtn).toBeDisabled()

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'other@test.dev')
      expect(resendBtn).not.toBeDisabled()

      await user.click(resendBtn)

      expect(mockSendVerificationEmail).toHaveBeenCalledWith({
        email: 'other@test.dev',
        callbackURL: '/auth/verify-email',
      })
      assertionPassed('resend-with-typed-email')
    }),
  )

  it(
    'resend cooldown disables button for 60s with visible countdown',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })

      mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', email: 'test@test.dev', emailVerified: false }, expiresAt: '' },
        isPending: false,
        error: null,
      })
      mockVerifyEmail.mockResolvedValue({
        data: null,
        error: { status: 410, message: 'Expired' },
      })
      window.history.pushState({}, '', '/auth/verify-email?token=expired')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/link expired/i)).toBeTruthy(),
      )

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(screen.getByRole('button', { name: /resend verification email/i }))

      const btn = screen.getByRole('button', { name: /resend in 60s/i })
      expect(btn).toBeDisabled()

      // Advance ~58s — button should still show a countdown
      for (let i = 0; i < 58; i++) {
        await act(async () => { vi.advanceTimersByTime(1000) })
      }

      const midBtn = screen.getByRole('button', { name: /resend in \d+s/i })
      expect(midBtn).toBeDisabled()

      // Advance past 60s total
      for (let i = 0; i < 5; i++) {
        await act(async () => { vi.advanceTimersByTime(1000) })
      }

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /resend verification email/i })).not.toBeDisabled(),
      )

      vi.useRealTimers()
      assertionPassed('cooldown-60s')
    }),
  )

  it(
    'reads boring_invite_failed cookie and renders alert',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      document.cookie = 'boring_invite_failed=Your invite link was invalid; you are signed in.'
      mockVerifyEmail.mockResolvedValue({ data: { status: true }, error: null })
      window.history.pushState({}, '', '/auth/verify-email?token=valid')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/email verified/i)).toBeTruthy(),
      )

      expect(
        screen.getByText(/your invite link was invalid/i),
      ).toBeTruthy()

      expect(document.cookie).not.toContain('boring_invite_failed')
      assertionPassed('invite-failed-cookie-alert')
    }),
  )

  it(
    'deletes boring_invite_failed cookie after reading',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      document.cookie = 'boring_invite_failed=test-message'
      window.history.pushState({}, '', '/auth/verify-email')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      expect(screen.getByText('test-message')).toBeTruthy()
      expect(document.cookie).not.toContain('boring_invite_failed')
      assertionPassed('cookie-deleted')
    }),
  )

  it(
    'signs out before returning to sign in from error states',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', email: 'test@test.dev', emailVerified: false }, expiresAt: '' },
        isPending: false,
        error: null,
      })
      window.history.pushState({}, '', '/auth/verify-email')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /back to sign in/i }))

      expect(mockSignOut).toHaveBeenCalledOnce()
      expect(window.location.pathname).toBe('/auth/signin')
      assertionPassed('back-to-signin-signs-out')
    }),
  )

  it(
    'calls verifyEmail with token from URL',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/verify-email?token=my-token-123')

      render(<VerifyEmailPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(mockVerifyEmail).toHaveBeenCalledWith({ query: { token: 'my-token-123' } }),
      )
      assertionPassed('verify-called-with-token')
    }),
  )
})
