import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AuthPage, { AuthCallbackPage } from '../pages/AuthPage'

vi.mock('../config', () => ({
  getConfig: () => ({
    branding: { name: 'Test App' },
  }),
}))

vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

const DEFAULT_AUTH_CONFIG = {
  provider: 'local',
  callbackUrl: '/auth/callback',
  redirectUri: '/',
  initialMode: 'sign_in',
  appName: 'Test App',
  appDescription: 'A test workspace',
}

const ORIGINAL_LOCATION = window.location

const setWindowLocation = (overrides = {}) => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      ...ORIGINAL_LOCATION,
      origin: 'http://localhost',
      href: 'http://localhost/auth/login',
      pathname: '/auth/login',
      search: '',
      hash: '',
      assign: vi.fn(),
      replace: vi.fn(),
      ...overrides,
    },
  })
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = vi.fn()
    setWindowLocation()
  })

  it('renders sign-in form by default', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, redirectUri: '' }} />)

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('Use your email and password to continue.')).toBeInTheDocument()
    expect(screen.getByLabelText('Work email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('renders sign-up form when initialMode is sign_up', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, initialMode: 'sign_up' }} />)

    expect(screen.getByText('Create your account')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Create a password (8+ characters)')).toBeInTheDocument()
  })

  it('switches between sign-in and sign-up tabs', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, redirectUri: '' }} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(screen.getByText('Create your account')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Sign in' }))
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('renders app name, description, and theme toggle', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, appName: 'My Workspace', appDescription: 'Custom description' }} />)

    expect(screen.getByText('My Workspace')).toBeInTheDocument()
    expect(screen.getByText('Custom description')).toBeInTheDocument()
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('submits local auth through the existing login route', async () => {
    setWindowLocation({
      search: '?redirect_uri=%2Fw%2Fdemo',
      href: 'http://localhost/auth/login?redirect_uri=%2Fw%2Fdemo',
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, redirectUri: '' }} />)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        '/auth/login?user_id=local-owner-example-com&email=owner%40example.com&redirect_uri=%2Fw%2Fdemo',
      )
    })
  })

  it('shows validation error for local auth with empty credentials', async () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter email and password.')).toBeInTheDocument()
    })
  })

  it('has correct aria and autocomplete attributes', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

    const signInTab = screen.getByRole('tab', { name: 'Sign in' })
    const signUpTab = screen.getByRole('tab', { name: 'Create account' })

    expect(signInTab).toHaveAttribute('aria-selected', 'true')
    expect(signUpTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('uses new-password autocomplete in sign-up mode', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, initialMode: 'sign_up' }} />)

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })

  it('posts Neon sign-in to the backend auth endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, redirect_uri: '/dashboard' }),
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon' }} />)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          redirect_uri: '/',
        }),
      })
    })
    expect(global.fetch).not.toHaveBeenCalledWith('/auth/token-exchange', expect.anything())
  })

  it('posts Neon sign-up to the backend auth endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        requires_email_verification: true,
        message: 'Check your email to verify your account.',
        redirect_uri: '/',
      }),
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon', initialMode: 'sign_up' }} />)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'password123',
          name: 'new',
          redirect_uri: '/',
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Check your email to verify your account.')).toBeInTheDocument()
      expect(screen.getByText('Welcome back')).toBeInTheDocument()
    })
  })

  it('offers resend verification when Neon sign-in returns EMAIL_NOT_VERIFIED', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Email not verified',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          message: 'Verification email sent. Check your inbox.',
          redirect_uri: '/',
        }),
      })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon' }} />)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Email not verified. Check your inbox or resend the verification email.')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith('/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          redirect_uri: '/',
        }),
      })
    })
  })

  it('requests a Neon password reset email from sign-in', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        message: 'Password reset email sent. Check your inbox.',
        redirect_uri: '/w/demo',
      }),
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon', redirectUri: '/w/demo' }} />)

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'reset@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'reset@example.com',
          redirect_uri: '/w/demo',
        }),
      })
    })
  })

  it('renders reset-password mode from the reset route', () => {
    setWindowLocation({
      pathname: '/auth/reset-password',
      search: '?token=reset-token&redirect_uri=%2Fw%2Fdemo',
      href: 'http://localhost/auth/reset-password?token=reset-token&redirect_uri=%2Fw%2Fdemo',
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon', initialMode: 'reset_password', redirectUri: '/w/demo' }} />)

    expect(screen.getByText('Set a new password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Work email')).not.toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
  })

  it('submits a Neon password reset with the token from the reset link', async () => {
    setWindowLocation({
      pathname: '/auth/reset-password',
      search: '?token=reset-token&redirect_uri=%2Fw%2Fdemo',
      href: 'http://localhost/auth/reset-password?token=reset-token&redirect_uri=%2Fw%2Fdemo',
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        message: 'Password updated. Sign in with your new password.',
        redirect_uri: '/w/demo',
      }),
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon', initialMode: 'reset_password', redirectUri: '/w/demo' }} />)

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'reset-token',
          new_password: 'new-password-123',
          redirect_uri: '/w/demo',
        }),
      })
    })
  })

  it('validates Neon reset-password confirmation mismatch', async () => {
    setWindowLocation({
      pathname: '/auth/reset-password',
      search: '?token=reset-token',
      href: 'http://localhost/auth/reset-password?token=reset-token',
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, provider: 'neon', initialMode: 'reset_password' }} />)

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'mismatch-password' } })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('AuthPage — safeRedirectPath', () => {
  it('renders without crashing with malicious redirect_uri', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, redirectUri: 'https://evil.com/steal' }} />)
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('renders without crashing with protocol-relative redirect', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, redirectUri: '//evil.com' }} />)
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })
})

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setWindowLocation({
      pathname: '/auth/callback',
      href: 'http://localhost/auth/callback',
    })
  })

  it('shows error when no token is present', async () => {
    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(screen.getByText('Sign-in failed')).toBeInTheDocument()
      expect(screen.getByText('Missing callback token.')).toBeInTheDocument()
    })
  })

  it('shows go-to-login link on error', async () => {
    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(screen.getByText('Go to login')).toBeInTheDocument()
    })
  })

  it('exchanges access_token from the URL hash', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '#access_token=test-jwt-token&token_type=bearer',
        search: '',
        href: 'http://localhost/auth/callback#access_token=test-jwt-token&token_type=bearer',
        origin: 'http://localhost',
        replace: vi.fn(),
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ redirect_uri: '/dashboard' }),
    })

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: 'test-jwt-token', redirect_uri: '/' }),
      })
    })
  })

  it('navigates to workspace setup when workspace_id is returned and redirect is /', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '#access_token=test-jwt-token&token_type=bearer',
        search: '',
        href: 'http://localhost/auth/callback#access_token=test-jwt-token&token_type=bearer',
        origin: 'http://localhost',
        replace: vi.fn(),
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, redirect_uri: '/', workspace_id: 'ws-abc-123' }),
    })

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/w/ws-abc-123/setup')
    })
  })

  it('uses redirect_uri over workspace_id when redirect is not root', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '#access_token=test-jwt-token&token_type=bearer',
        search: '?redirect_uri=/w/existing/editor',
        href: 'http://localhost/auth/callback?redirect_uri=/w/existing/editor#access_token=test-jwt-token&token_type=bearer',
        origin: 'http://localhost',
        replace: vi.fn(),
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, redirect_uri: '/w/existing/editor', workspace_id: 'ws-abc-123' }),
    })

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/w/existing/editor')
    })
  })

  it('falls back to / when no workspace_id is returned', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        hash: '#access_token=test-jwt-token&token_type=bearer',
        search: '',
        href: 'http://localhost/auth/callback#access_token=test-jwt-token&token_type=bearer',
        origin: 'http://localhost',
        replace: vi.fn(),
      },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, redirect_uri: '/' }),
    })

    render(<AuthCallbackPage />)

    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/')
    })
  })
})
