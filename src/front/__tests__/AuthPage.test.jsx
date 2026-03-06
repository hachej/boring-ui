import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AuthPage, { AuthCallbackPage } from '../pages/AuthPage'

// Mock config
vi.mock('../config', () => ({
  getConfig: () => ({
    branding: { name: 'Test App' },
  }),
}))

// Mock ThemeToggle
vi.mock('../components/ThemeToggle', () => ({
  default: () => <button data-testid="theme-toggle">Toggle</button>,
}))

// Mock apiFetchJson (imported but not directly used in render path)
vi.mock('../utils/transport', () => ({
  apiFetchJson: vi.fn(),
}))

const DEFAULT_AUTH_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  callbackUrl: '/auth/callback',
  redirectUri: '/',
  initialMode: 'sign_in',
  appName: 'Test App',
  appDescription: 'A test workspace',
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset supabase global
    delete window.supabase
  })

  it('renders sign-in form by default', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

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
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

    expect(screen.getByText('Welcome back')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Create account' }))
    expect(screen.getByText('Create your account')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Sign in' }))
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('renders app name in the rail', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, appName: 'My Workspace' }} />)
    expect(screen.getByText('My Workspace')).toBeInTheDocument()
  })

  it('renders app description in the rail', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, appDescription: 'Custom description' }} />)
    expect(screen.getByText('Custom description')).toBeInTheDocument()
  })

  it('renders the theme toggle', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('disables submit when no supabase client', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)
    const submitBtn = screen.getByRole('button', { name: /continue/i })
    expect(submitBtn).toBeDisabled()
  })

  it('shows validation error when submitting empty form', async () => {
    // Provide a mock supabase client so the button is enabled
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOtp: vi.fn() },
      }),
    }

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter email and password.')).toBeInTheDocument()
    })
  })

  it('calls signInWithPassword on sign-in submit', async () => {
    const mockSignIn = vi.fn().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    })
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: mockSignIn, signUp: vi.fn(), signInWithOtp: vi.fn() },
      }),
    }

    // Mock token-exchange fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ redirect_uri: '/' }),
    })

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      })
    })
  })

  it('shows error on sign-in failure', async () => {
    const mockSignIn = vi.fn().mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: mockSignIn, signUp: vi.fn(), signInWithOtp: vi.fn() },
      }),
    }

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeInTheDocument()
    })
  })

  it('calls signUp on sign-up submit', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: '123' } },
      error: null,
    })
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: vi.fn(), signUp: mockSignUp, signInWithOtp: vi.fn() },
      }),
    }

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, initialMode: 'sign_up', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create account/i })).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        options: expect.objectContaining({ emailRedirectTo: expect.any(String) }),
      })
    })
  })

  it('shows rate limit message on 429 error (magic link)', async () => {
    const mockOtp = vi.fn().mockResolvedValue({
      error: { status: 429, message: 'Too many requests' },
    })
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOtp: mockOtp },
      }),
    }

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByText('Use magic link instead')).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.click(screen.getByText('Use magic link instead'))

    await waitFor(() => {
      expect(screen.getByText(/wait about 60 seconds/i)).toBeInTheDocument()
    })
  })

  it('sends magic link via signInWithOtp', async () => {
    const mockOtp = vi.fn().mockResolvedValue({ error: null })
    window.supabase = {
      createClient: () => ({
        auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signInWithOtp: mockOtp },
      }),
    }

    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'key' }} />)

    await waitFor(() => {
      expect(screen.getByText('Use magic link instead')).not.toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'test@example.com' } })
    fireEvent.click(screen.getByText('Use magic link instead'))

    await waitFor(() => {
      expect(mockOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        options: expect.objectContaining({ emailRedirectTo: expect.any(String) }),
      })
    })
  })

  it('has correct aria attributes on tabs', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

    const signInTab = screen.getByRole('tab', { name: 'Sign in' })
    const signUpTab = screen.getByRole('tab', { name: 'Create account' })

    expect(signInTab).toHaveAttribute('aria-selected', 'true')
    expect(signUpTab).toHaveAttribute('aria-selected', 'false')
  })

  it('uses correct autocomplete attributes', () => {
    render(<AuthPage authConfig={DEFAULT_AUTH_CONFIG} />)

    expect(screen.getByLabelText('Work email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('uses new-password autocomplete in sign-up mode', () => {
    render(<AuthPage authConfig={{ ...DEFAULT_AUTH_CONFIG, initialMode: 'sign_up' }} />)

    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
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
  })

  it('shows error when no token in hash', async () => {
    // No hash params, no query params — useEffect runs immediately and finds no token
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

  it('exchanges access_token from hash', async () => {
    // Set hash with access_token
    const originalHash = window.location.hash
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

    // Restore
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: originalHash },
    })
  })
})
