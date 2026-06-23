// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const mockChangePassword = vi.fn()
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
    verifyEmail: vi.fn(),
    sendVerificationEmail: vi.fn(),
    changePassword: mockChangePassword,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({ id: 'magic-link' }),
}))

import { withTaskId } from '../../server/__tests__/_setup'
import { AuthProvider } from '../auth/AuthProvider'
import { UserIdentityProvider } from '../auth/UserIdentityProvider'
import { UserSettingsPage } from '../auth/UserSettingsPage'
import { useMswHandler } from './_setup'

const TASK_ID = 'boring-ui-v2-wqza'

const MOCK_USER = {
  id: 'user-1',
  email: 'test@test.dev',
  name: 'Test User',
  emailVerified: true,
  image: null,
  createdAt: '2025-06-15T00:00:00.000Z',
  updatedAt: '2025-06-15T00:00:00.000Z',
}

function mockMeEndpoint() {
  useMswHandler(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.endsWith('/api/v1/me') && method === 'GET') {
      return new Response(
        JSON.stringify({
          user: MOCK_USER,
          settings: { displayName: 'Test User', email: 'test@test.dev', settings: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return undefined
  })
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <UserIdentityProvider>{children}</UserIdentityProvider>
    </AuthProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({
    data: {
      user: MOCK_USER,
      expiresAt: '2099-01-01T00:00:00Z',
    },
    isPending: false,
    error: null,
  })
  mockSignOut.mockResolvedValue(undefined)
  mockChangePassword.mockResolvedValue({ data: {}, error: null })
  mockMeEndpoint()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('UserSettingsPage', () => {
  it(
    'displays user profile info',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText('test@test.dev')).toBeTruthy(),
      )
      expect(screen.getByText('Test User')).toBeTruthy()
      expect(screen.getByText(/june.*2025/i)).toBeTruthy()
      assertionPassed('displays-profile')
    }),
  )

  it(
    'links the top-left brand to home',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })
      await waitFor(() => expect(screen.getByText('test@test.dev')).toBeTruthy())
      const homeLink = screen.getByRole('link', { name: /home/i })
      expect(homeLink.getAttribute('href')).toBe('/')
      assertionPassed('brand-links-home')
    }),
  )

  it(
    'renders host-provided extra sections with their own nav entry (stays feature-agnostic)',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(
        <UserSettingsPage
          extraSections={[
            { id: 'billing', navLabel: 'Billing', navDescription: 'Credits and top-up', content: <div id="billing">Billing section body</div> },
          ]}
        />,
        { wrapper: Wrapper },
      )

      await waitFor(() => expect(screen.getByText('Billing section body')).toBeTruthy())
      const nav = screen.getByRole('link', { name: /Billing/i })
      expect(nav.getAttribute('href')).toBe('#billing')
      assertionPassed('extra-section-rendered')
    }),
  )

  it(
    'omits extra-section nav entries when none are provided',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })
      await waitFor(() => expect(screen.getByText('test@test.dev')).toBeTruthy())
      expect(screen.queryByRole('link', { name: /Billing/i })).toBeNull()
      assertionPassed('no-extra-sections')
    }),
  )

  it(
    'renders change password form fields',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )
      expect(screen.getByLabelText(/^new password$/i)).toBeTruthy()
      expect(screen.getByLabelText(/^confirm new password$/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /change password/i })).toBeTruthy()
      assertionPassed('password-form-fields')
    }),
  )

  it(
    'validates mismatched passwords client-side',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/current password/i), 'oldpass123')
      await user.type(screen.getByLabelText(/^new password$/i), 'newpass123')
      await user.type(screen.getByLabelText(/confirm new password/i), 'different')
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await waitFor(() =>
        expect(screen.getByText(/passwords do not match/i)).toBeTruthy(),
      )
      expect(mockChangePassword).not.toHaveBeenCalled()
      assertionPassed('mismatch-validation')
    }),
  )

  it(
    'validates short new password client-side',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/current password/i), 'oldpass')
      await user.type(screen.getByLabelText(/^new password$/i), 'short')
      await user.type(screen.getByLabelText(/confirm new password/i), 'short')
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await waitFor(() =>
        expect(screen.getByText(/at least 8 characters/i)).toBeTruthy(),
      )
      expect(mockChangePassword).not.toHaveBeenCalled()
      assertionPassed('short-password-validation')
    }),
  )

  it(
    'calls changePassword on valid submission',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/current password/i), 'oldpass123')
      await user.type(screen.getByLabelText(/^new password$/i), 'newpassword')
      await user.type(screen.getByLabelText(/confirm new password/i), 'newpassword')
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await waitFor(() =>
        expect(mockChangePassword).toHaveBeenCalledWith({
          currentPassword: 'oldpass123',
          newPassword: 'newpassword',
          revokeOtherSessions: true,
        }),
      )
      assertionPassed('change-password-call')
    }),
  )

  it(
    'shows success message after password change',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/current password/i), 'oldpass123')
      await user.type(screen.getByLabelText(/^new password$/i), 'newpassword')
      await user.type(screen.getByLabelText(/confirm new password/i), 'newpassword')
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await waitFor(() =>
        expect(screen.getByText(/password changed successfully/i)).toBeTruthy(),
      )
      assertionPassed('password-success')
    }),
  )

  it(
    'shows error on password change failure',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockChangePassword.mockResolvedValue({
        data: null,
        error: { status: 400, message: 'Current password is incorrect' },
      })

      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByLabelText(/current password/i)).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText(/current password/i), 'wrong')
      await user.type(screen.getByLabelText(/^new password$/i), 'newpassword')
      await user.type(screen.getByLabelText(/confirm new password/i), 'newpassword')
      await user.click(screen.getByRole('button', { name: /change password/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Current password is incorrect'),
      )
      assertionPassed('password-error')
    }),
  )

  it(
    'renders delete account button in danger zone',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByText(/danger zone/i)).toBeTruthy(),
      )
      expect(screen.getByRole('button', { name: /delete account/i })).toBeTruthy()
      assertionPassed('danger-zone-rendered')
    }),
  )

  it(
    'opens delete confirmation dialog and requires typing DELETE',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete account/i })).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /delete account/i }))

      await waitFor(() =>
        expect(screen.getByText(/this action cannot be undone/i)).toBeTruthy(),
      )

      const confirmBtn = screen.getByRole('button', { name: /delete my account/i })
      expect(confirmBtn).toBeDisabled()

      await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE')

      expect(confirmBtn).not.toBeDisabled()
      assertionPassed('delete-dialog-confirm')
    }),
  )

  it(
    'calls DELETE /api/v1/me with email confirmation on delete',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      let deleteCalled = false
      let deleteBody: string | null = null

      useMswHandler(async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.endsWith('/api/v1/me') && method === 'DELETE') {
          deleteCalled = true
          deleteBody = init?.body as string
          return new Response(JSON.stringify({ deleted: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/api/v1/me') && method === 'GET') {
          return new Response(
            JSON.stringify({
              user: MOCK_USER,
              settings: { displayName: 'Test User', email: 'test@test.dev', settings: {} },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete account/i })).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /delete account/i }))

      await waitFor(() =>
        expect(screen.getByPlaceholderText('DELETE')).toBeTruthy(),
      )

      await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE')
      await user.click(screen.getByRole('button', { name: /delete my account/i }))

      await waitFor(() => expect(deleteCalled).toBe(true))
      expect(JSON.parse(deleteBody!)).toEqual({ confirm: 'test@test.dev' })
      expect(mockSignOut).toHaveBeenCalled()
      assertionPassed('delete-api-call')
    }),
  )

  it(
    'shows sole-owner error on 409 delete response',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      useMswHandler(async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.endsWith('/api/v1/me') && method === 'DELETE') {
          return new Response(
            JSON.stringify({
              code: 'last_owner',
              message: 'You are the sole owner of 2 workspace(s)',
              soleOwnerWorkspaceCount: 2,
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          )
        }
        if (url.endsWith('/api/v1/me') && method === 'GET') {
          return new Response(
            JSON.stringify({
              user: MOCK_USER,
              settings: { displayName: 'Test User', email: 'test@test.dev', settings: {} },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return undefined
      })

      render(<UserSettingsPage />, { wrapper: Wrapper })

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete account/i })).toBeTruthy(),
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /delete account/i }))

      await waitFor(() =>
        expect(screen.getByPlaceholderText('DELETE')).toBeTruthy(),
      )

      await user.type(screen.getByPlaceholderText('DELETE'), 'DELETE')
      await user.click(screen.getByRole('button', { name: /delete my account/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeTruthy(),
      )
      expect(screen.getByRole('alert').textContent).toContain('sole owner')
      expect(mockSignOut).not.toHaveBeenCalled()
      assertionPassed('sole-owner-error')
    }),
  )

  it(
    'shows loading state when no user data yet',
    withTaskId(TASK_ID, async ({ assertionPassed }) => {
      mockUseSession.mockReturnValue({
        data: null,
        isPending: true,
        error: null,
      })

      render(<UserSettingsPage />, { wrapper: Wrapper })

      expect(screen.getByText(/loading your account/i)).toBeTruthy()
      assertionPassed('loading-state')
    }),
  )
})
