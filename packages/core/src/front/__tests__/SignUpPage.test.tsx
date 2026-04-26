// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockSignUpEmail = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: mockSignUpEmail },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withBeadId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { SignUpPage } from '../auth/SignUpPage'

const BEAD_ID = 'boring-ui-v2-1pas'

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

describe('SignUpPage', () => {
  it(
    'submits name + email + password and calls signUp.email',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(mockSignUpEmail).toHaveBeenCalledWith(
          { email: 'test@example.com', password: 'secret12345', name: 'Test User' },
          undefined,
        ),
      )
      assertionPassed('signup-success')
    }),
  )

  it(
    'shows "check your email" success state after signup',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(screen.getByText(/check your email/i)).toBeTruthy(),
      )
      assertionPassed('signup-check-email-state')
    }),
  )

  it(
    'forwards invite_token as x-invite-token header',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      window.history.pushState({}, '', '/auth/signup?invite_token=test-token-abc')

      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Invited')
      await user.type(screen.getByLabelText(/email/i), 'invited@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(mockSignUpEmail).toHaveBeenCalledWith(
          { email: 'invited@example.com', password: 'secret12345', name: 'Invited' },
          { headers: { 'x-invite-token': 'test-token-abc' } },
        ),
      )
      assertionPassed('signup-invite-token-forwarded')
    }),
  )

  it(
    'displays server error inline',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignUpEmail.mockResolvedValue({
        error: { message: 'Email already registered' },
      })

      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Test')
      await user.type(screen.getByLabelText(/email/i), 'dup@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Email already registered'),
      )
      assertionPassed('signup-server-error')
    }),
  )

  it(
    'client-side validation rejects short password',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Test')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'short')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(screen.getByText(/at least 8 characters/i)).toBeTruthy(),
      )
      expect(mockSignUpEmail).not.toHaveBeenCalled()
      assertionPassed('signup-password-validation')
    }),
  )

  it(
    'does NOT render a GitHub sign-up button',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<SignUpPage />, { wrapper: Wrapper })

      expect(screen.queryByText(/github/i)).toBeNull()
      assertionPassed('signup-no-github')
    }),
  )
})
