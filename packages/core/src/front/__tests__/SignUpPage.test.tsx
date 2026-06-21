// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const { mockUseOptionalConfig } = vi.hoisted(() => ({
  mockUseOptionalConfig: vi.fn(),
}))

const mockSignInSocial = vi.fn()
const mockSignUpEmail = vi.fn()
const mockUseSession = vi.fn()
const mockSignOut = vi.fn()

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mockUseSession,
    signOut: mockSignOut,
    signIn: { email: vi.fn(), social: mockSignInSocial },
    signUp: { email: mockSignUpEmail },
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
import { SignUpPage } from '../auth/SignUpPage'

const BEAD_ID = 'boring-ui-v2-1pas'
const GOOGLE_BEAD_ID = 'boring-ui-v2-reorg-mip7'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  )
}

function CurrentPath() {
  const location = useLocation()
  return <div data-testid="current-path">{location.pathname}</div>
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
    'redirects to email verification flow after signup when email verification is enabled',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: false, emailVerification: true } })
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

      render(
        <>
          <SignUpPage />
          <CurrentPath />
        </>,
        { wrapper: Wrapper },
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Test User')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(screen.getByTestId('current-path').textContent).toBe('/auth/verify-email'),
      )
      assertionPassed('signup-redirects-verify-email')
    }),
  )

  it(
    'uses claim copy and redirects back to the outreach workspace after account creation',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      window.history.pushState({}, '', '/auth/signup?claim=1&callbackURL=%2Fworkspace%2Fw1%3Ftab%3Dchat')

      render(
        <>
          <SignUpPage />
          <CurrentPath />
        </>,
        { wrapper: Wrapper },
      )

      expect(screen.getByText(/^sign up to keep your workspace$/i)).toBeTruthy()
      expect(screen.getByText(/^sign up to keep your workspace, credits, and history\.$/i)).toBeTruthy()

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/name/i), 'Claimed User')
      await user.type(screen.getByLabelText(/email/i), 'claimed@example.com')
      await user.type(screen.getByLabelText(/password/i), 'secret12345')
      await user.click(screen.getByRole('button', { name: /sign up/i }))

      await waitFor(() =>
        expect(screen.getByTestId('current-path').textContent).toBe('/workspace/w1'),
      )
      assertionPassed('signup-claim-redirect')
    }),
  )

  it(
    'shows Google sign-up on the normal signup flow when enabled',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: true } })

      render(<SignUpPage />, { wrapper: Wrapper })

      expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy()
      assertionPassed('signup-google-visible')
    }),
  )

  it(
    'passes the signup route as the Google OAuth error callback URL',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: true } })
      mockSignInSocial.mockResolvedValue({ data: null, error: null })

      render(<SignUpPage />, { wrapper: Wrapper })

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /continue with google/i }))

      await waitFor(() =>
        expect(mockSignInSocial).toHaveBeenCalledWith({
          provider: 'google',
          callbackURL: '/',
          errorCallbackURL: '/auth/signup',
        }),
      )
      assertionPassed('signup-google-error-callback')
    }),
  )

  it(
    'forwards invite_token as x-invite-token header and hides Google sign-up',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      mockUseOptionalConfig.mockReturnValue({ features: { googleOauth: true } })
      mockSignUpEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
      window.history.pushState({}, '', '/auth/signup?invite_token=test-token-abc')

      render(<SignUpPage />, { wrapper: Wrapper })

      expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()

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
    'hides Google sign-up when google OAuth is disabled',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      render(<SignUpPage />, { wrapper: Wrapper })

      expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull()
      assertionPassed('signup-google-hidden')
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

  it(
    'shows a helpful error when Google redirects back with an OAuth error',
    withBeadId(GOOGLE_BEAD_ID, async ({ assertionPassed }) => {
      window.history.pushState({}, '', '/auth/signup?error=access_denied&error_description=cancelled')

      render(<SignUpPage />, { wrapper: Wrapper })

      expect(screen.getByRole('button', { name: /^sign up$/i })).toBeTruthy()
      expect(screen.getByLabelText(/email/i)).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toMatch(/could not complete google sign up/i)
      assertionPassed('signup-oauth-error-query')
    }),
  )
})
