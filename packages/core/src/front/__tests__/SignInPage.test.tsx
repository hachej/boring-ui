// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockSignInEmail = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: mockSignInEmail, social: vi.fn() },
    signUp: { email: vi.fn() },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withBeadId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { SignInPage } from '../auth/SignInPage'

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
})

describe('SignInPage', () => {
  it(
    'submits email + password and calls signIn.email',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignInEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

      render(<SignInPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret123')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() =>
        expect(mockSignInEmail).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'secret123',
        }),
      )
      assertionPassed('signin-success')
    }),
  )

  it(
    'displays server error on bad credentials',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignInEmail.mockResolvedValue({
        error: { message: 'Invalid email or password' },
      })

      render(<SignInPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'wrong')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Invalid email or password'),
      )
      assertionPassed('signin-bad-creds')
    }),
  )

  it(
    'shows client-side validation for invalid email',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<SignInPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/email/i), 'not-an-email')
      await user.type(screen.getByLabelText(/password/i), 'secret')
      await user.click(screen.getByRole('button', { name: /sign in/i }))

      await waitFor(() =>
        expect(screen.getByText(/valid email/i)).toBeTruthy(),
      )
      expect(mockSignInEmail).not.toHaveBeenCalled()
      assertionPassed('signin-client-validation')
    }),
  )

  it(
    'does NOT render a GitHub sign-in button',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<SignInPage />, { wrapper: Wrapper })

      expect(screen.queryByText(/sign in with github/i)).toBeNull()
      expect(screen.queryByText(/github/i)).toBeNull()
      assertionPassed('signin-no-github')
    }),
  )

  it(
    'has links to forgot-password and sign-up',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      render(<SignInPage />, { wrapper: Wrapper })

      expect(screen.getByText(/forgot password/i).closest('a')?.getAttribute('href')).toBe(
        '/auth/forgot-password',
      )
      expect(screen.getByText(/sign up/i).closest('a')?.getAttribute('href')).toBe(
        '/auth/signup',
      )
      assertionPassed('signin-links')
    }),
  )
})
