// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const { mockUseOptionalConfig } = vi.hoisted(() => ({
  mockUseOptionalConfig: vi.fn(),
}))

const mockSignInEmail = vi.fn()
const mockSignInSocial = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: mockSignInEmail, social: mockSignInSocial },
    signUp: { email: vi.fn() },
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

vi.mock('../ConfigProvider.js', () => ({
  useOptionalConfig: mockUseOptionalConfig,
}))

import { withBeadId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { SignInPage } from '../auth/SignInPage'

const BEAD_ID = 'boring-ui-v2-1pas'
const GOOGLE_BEAD_ID = 'boring-ui-v2-reorg-mip7'

function Wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })
  mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: false } })
  mockSignOut.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
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
    'shows Google sign-in only when enabled and clicks through social sign-in',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: true } })
      mockSignInSocial.mockResolvedValue({ data: null, error: null })

      render(<SignInPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /continue with google/i }))

      await waitFor(() =>
        expect(mockSignInSocial).toHaveBeenCalledWith({
          provider: 'google',
          callbackURL: '/',
          errorCallbackURL: '/auth/signin',
        }),
      )
      assertionPassed('signin-google-social')
    }),
  )

  it(
    'shows an inline error when Google sign-in initiation fails before redirect',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: true } })
      mockSignInSocial.mockResolvedValue({
        data: null,
        error: { message: 'Could not reach Google' },
      })

      render(<SignInPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /continue with google/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Could not reach Google'),
      )
      assertionPassed('signin-google-init-error')
    }),
  )

  it(
    'hides Google sign-in when google OAuth is disabled',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      render(<SignInPage />, { wrapper: Wrapper })

      expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()
      assertionPassed('signin-google-hidden')
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

  it(
    'shows a helpful error when Google redirects back with an OAuth error',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/signin?error=access_denied&error_description=cancelled')

      render(<SignInPage />, { wrapper: Wrapper })

      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy()
      expect(screen.getByLabelText(/email/i)).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toMatch(/could not complete google sign in/i)
      assertionPassed('signin-oauth-error-query')
    }),
  )
})
