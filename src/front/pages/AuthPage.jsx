import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getConfig } from '../config'
import ThemeToggle from '../components/ThemeToggle'
import './auth.css'

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js'

function useSupabaseClient(supabaseUrl, supabaseAnonKey) {
  const [client, setClient] = useState(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || loadedRef.current) return
    loadedRef.current = true

    // Check if already loaded
    if (window.supabase?.createClient) {
      setClient(window.supabase.createClient(supabaseUrl, supabaseAnonKey))
      return
    }

    const script = document.createElement('script')
    script.src = SUPABASE_CDN
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      if (window.supabase?.createClient) {
        setClient(window.supabase.createClient(supabaseUrl, supabaseAnonKey))
      }
    }
    document.head.appendChild(script)
  }, [supabaseUrl, supabaseAnonKey])

  return client
}

function safeRedirectPath(raw) {
  const candidate = String(raw || '/').trim()
  try {
    const url = new URL(candidate, window.location.origin)
    if (url.origin !== window.location.origin) return '/'
  } catch {
    return '/'
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/'
  return candidate
}

// --- Neon Auth helpers ---

function parseNeonError(body) {
  // Better Auth error shapes:
  //   { message: "..." }
  //   { error: { message: "..." } }
  //   { code: "...", message: "..." }
  if (!body) return 'An unknown error occurred.'
  if (typeof body === 'string') return body
  if (body.message) return body.message
  if (body.error?.message) return body.error.message
  if (body.statusText) return body.statusText
  return JSON.stringify(body)
}

async function neonPasswordAuth(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg = resp.status === 429
      ? 'Too many attempts. Please wait and try again.'
      : parseNeonError(payload)
    return { error: msg, code: payload?.code || '' }
  }
  return payload
}

function isEmailNotVerifiedError(result) {
  const code = String(result?.code || '').toUpperCase()
  const message = String(result?.error || result?.message || '').toLowerCase()
  return code === 'EMAIL_NOT_VERIFIED' || message.includes('email not verified')
}

// --- Main component ---

export default function AuthPage({ authConfig }) {
  const config = getConfig()
  const branding = config?.branding || {}
  const appName = authConfig?.appName || branding.name || 'Boring UI'
  const appDescription = authConfig?.appDescription || ''

  const provider = authConfig?.provider || 'supabase'
  const isNeon = provider === 'neon'

  const supabaseUrl = authConfig?.supabaseUrl || ''
  const supabaseAnonKey = authConfig?.supabaseAnonKey || ''
  const callbackUrl = authConfig?.callbackUrl || `${window.location.origin}/auth/callback`
  const redirectUri = safeRedirectPath(authConfig?.redirectUri || new URLSearchParams(window.location.search).get('redirect_uri'))
  const initialMode = authConfig?.initialMode === 'sign_up' ? 'sign_up' : 'sign_in'

  // Only load Supabase SDK when using supabase provider
  const client = useSupabaseClient(
    isNeon ? '' : supabaseUrl,
    isNeon ? '' : supabaseAnonKey,
  )

  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verificationRecoveryEmail, setVerificationRecoveryEmail] = useState('')
  const emailRef = useRef(null)

  useEffect(() => {
    document.title = `Sign in — ${appName}`
    emailRef.current?.focus()
  }, [appName])

  const showStatus = useCallback((message, error = false) => {
    setStatus(message)
    setIsError(error)
  }, [])

  const clearVerificationRecovery = useCallback(() => {
    setVerificationRecoveryEmail('')
  }, [])

  const isRateLimited = (error) => {
    if (!error) return false
    if (Number(error.status || 0) === 429) return true
    const raw = [error.code, error.error_code, error.message].filter(Boolean).join(' ').toLowerCase()
    return raw.includes('over_email_send_rate_limit') || raw.includes('email rate limit') || raw.includes('too many requests')
  }

  const buildCallbackUrl = () => {
    const url = new URL(callbackUrl, window.location.origin)
    url.searchParams.set('redirect_uri', redirectUri)
    return url.toString()
  }

  // --- Neon submit handler ---
  const handleNeonSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    const trimmed = email.trim()
    if (!trimmed || !password) { showStatus('Enter email and password.', true); return }

    setBusy(true)
    const isSignUp = mode === 'sign_up'

    try {
      if (isSignUp) {
        clearVerificationRecovery()
        showStatus('Creating account...')
        const result = await neonPasswordAuth('/auth/sign-up', {
          email: trimmed,
          password,
          name: trimmed.split('@')[0],
          redirect_uri: redirectUri,
        })
        if (result.error) {
          showStatus(result.error, true)
          return
        }
        if (!result.ok) {
          showStatus(result.message || 'Unable to complete session setup.', true)
          return
        }
        setPassword('')
        setMode('sign_in')
        showStatus(result.message || 'Check your email to verify your account.')
      } else {
        showStatus('Signing in...')
        const result = await neonPasswordAuth('/auth/sign-in', {
          email: trimmed,
          password,
          redirect_uri: redirectUri,
        })
        if (result.error) {
          if (isEmailNotVerifiedError(result)) {
            setVerificationRecoveryEmail(trimmed.toLowerCase())
            showStatus('Email not verified. Check your inbox or resend the verification email.', true)
            return
          }
          clearVerificationRecovery()
          showStatus(result.error, true)
          return
        }
        clearVerificationRecovery()
        if (!result.ok) {
          showStatus(result.message || 'Unable to complete session setup.', true)
          return
        }
        window.location.assign(result.redirect_uri || '/')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleResendVerification = async () => {
    if (busy) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      showStatus('Enter your email to resend the verification link.', true)
      return
    }

    setBusy(true)
    showStatus('Sending verification email...')
    try {
      const result = await neonPasswordAuth('/auth/resend-verification', {
        email: trimmed,
        redirect_uri: redirectUri,
      })
      if (result.error) {
        showStatus(result.error, true)
        return
      }
      setVerificationRecoveryEmail(trimmed)
      showStatus(result.message || 'Verification email sent. Check your inbox.')
    } finally {
      setBusy(false)
    }
  }

  // --- Supabase magic link handler ---
  const handleMagicLink = async () => {
    if (busy || !client) return
    const trimmed = email.trim()
    if (!trimmed) { showStatus('Enter your email.', true); return }

    setBusy(true)
    showStatus('Sending magic link...')
    try {
      const result = await client.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: buildCallbackUrl() },
      })
      if (result.error) {
        showStatus(isRateLimited(result.error)
          ? 'Too many email attempts. Please wait about 60 seconds.'
          : (result.error.message || 'Unable to send magic link.'), true)
        return
      }
      showStatus(mode === 'sign_up'
        ? 'Check your email to confirm your account.'
        : 'Check your email for the sign-in link.')
    } finally {
      setBusy(false)
    }
  }

  // --- Supabase submit handler ---
  const handleSupabaseSubmit = async (e) => {
    e.preventDefault()
    if (busy || !client) return
    const trimmed = email.trim()
    if (!trimmed || !password) { showStatus('Enter email and password.', true); return }

    setBusy(true)
    if (mode === 'sign_up') {
      showStatus('Creating account...')
      try {
        const result = await client.auth.signUp({
          email: trimmed,
          password,
          options: { emailRedirectTo: buildCallbackUrl() },
        })
        if (result.error) {
          showStatus(isRateLimited(result.error)
            ? 'Too many email attempts. Please wait about 60 seconds.'
            : (result.error.message || 'Unable to create account.'), true)
          return
        }
        setPassword('')
        setMode('sign_in')
        showStatus('Account created. Confirm from your email, then sign in.')
      } finally {
        setBusy(false)
      }
      return
    }

    showStatus('Signing in...')
    try {
      const signIn = await client.auth.signInWithPassword({ email: trimmed, password })
      if (signIn.error) {
        showStatus(signIn.error.message || 'Unable to sign in.', true)
        return
      }
      const accessToken = signIn.data?.session?.access_token
      if (!accessToken) { showStatus('No access token returned.', true); return }

      const resp = await fetch('/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken, redirect_uri: redirectUri }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        showStatus(payload.message || 'Unable to complete session setup.', true)
        return
      }
      window.location.assign(payload.redirect_uri || '/')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = isNeon ? handleNeonSubmit : handleSupabaseSubmit

  // For Neon, the form is ready immediately (no SDK to load).
  // For Supabase, we need the client to be loaded.
  const formReady = isNeon ? true : !!client
  const isSignUp = mode === 'sign_up'
  const canResendVerification = isNeon
    && !isSignUp
    && !!verificationRecoveryEmail
    && verificationRecoveryEmail === email.trim().toLowerCase()

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <aside className="auth-rail" aria-label="Product highlights">
          <h1 className="auth-rail-title">{appName}</h1>
          <p className="auth-rail-description">
            {appDescription || 'A modern workspace for data teams. Write queries, explore schemas, and collaborate with AI — all in one place.'}
          </p>
          <pre className="auth-rail-code" aria-hidden="true">{`const session = await auth.login(email)\nworkspace.open(session.id)`}</pre>
        </aside>

        <main className="auth-card">
          <div className="auth-card-header">
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={`auth-tab ${!isSignUp ? 'active' : ''}`}
                role="tab"
                aria-selected={!isSignUp}
                onClick={() => { setMode('sign_in'); clearVerificationRecovery(); showStatus('') }}
                disabled={busy}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-tab ${isSignUp ? 'active' : ''}`}
                role="tab"
                aria-selected={isSignUp}
                onClick={() => { setMode('sign_up'); clearVerificationRecovery(); showStatus('') }}
                disabled={busy}
              >
                Create account
              </button>
            </div>
            <ThemeToggle />
          </div>

          <h2 className="auth-title">{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth-subtitle">
            {isSignUp
              ? 'Get started in minutes.'
              : 'Use your email and password to continue.'}
          </p>

          <form onSubmit={handleSubmit} autoComplete="on" noValidate>
            <label className="auth-label" htmlFor="auth-email">Work email</label>
            <input
              ref={emailRef}
              id="auth-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                const nextValue = e.target.value
                setEmail(nextValue)
                if (verificationRecoveryEmail && nextValue.trim().toLowerCase() !== verificationRecoveryEmail) {
                  clearVerificationRecovery()
                }
              }}
              disabled={busy}
              required
            />

            <label className="auth-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="auth-input"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={isSignUp ? 'Create a password (8+ characters)' : 'Enter your password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              disabled={busy}
              required
            />

            <button className="auth-submit" type="submit" disabled={busy || !formReady}>
              {busy && <Loader2 size={16} className="auth-spinner" />}
              {isSignUp ? 'Create account' : 'Continue'}
            </button>
          </form>

          {/* Magic link option only available for Supabase provider */}
          {!isNeon && (
            <div className="auth-alt-actions">
              <p className="auth-muted">Prefer a one-time link?</p>
              <button
                type="button"
                className="auth-link-btn"
                onClick={handleMagicLink}
                disabled={busy || !client}
              >
                {isSignUp ? 'Email me a signup link' : 'Use magic link instead'}
              </button>
            </div>
          )}

          {status && (
            <p className={`auth-status ${isError ? 'auth-status-error' : ''}`} aria-live="polite">
              {status}
            </p>
          )}

          {canResendVerification && (
            <div className="auth-alt-actions">
              <p className="auth-muted">Your account exists, but the email is still waiting for verification.</p>
              <button
                type="button"
                className="auth-link-btn"
                onClick={handleResendVerification}
                disabled={busy}
              >
                Resend verification email
              </button>
            </div>
          )}

          {/* Loading indicator for Supabase SDK */}
          {!isNeon && !client && supabaseUrl && (
            <p className="auth-status">
              <Loader2 size={14} className="auth-spinner" />
              Loading authentication...
            </p>
          )}
        </main>
      </div>
    </div>
  )
}

export function AuthCallbackPage() {
  const [status, setStatus] = useState('Processing authentication response.')
  const [error, setError] = useState('')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const query = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const redirectUri = query.get('redirect_uri') || '/'

      // If code/token params in query, let the backend handle via redirect
      if (query.get('code') || ((query.get('token_hash') || query.get('token')) && query.get('type'))) {
        const url = new URL(window.location.href)
        url.hash = ''
        window.location.replace(url.toString())
        return
      }

      const accessToken = hash.get('access_token')
      if (!accessToken) {
        const err = hash.get('error_description') || query.get('error_description') || 'Missing callback token.'
        setError(err)
        setStatus('Authentication callback is incomplete.')
        return
      }

      setStatus('Exchanging session token...')
      const resp = await fetch('/auth/token-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken, redirect_uri: redirectUri }),
      })
      const payload = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(payload.message || 'Token exchange failed.')
        setStatus('Sign-in could not be completed.')
        return
      }
      window.location.replace(payload.redirect_uri || redirectUri || '/')
    }

    run().catch((err) => {
      setError(err?.message || 'Unexpected callback error.')
      setStatus('Sign-in could not be completed.')
    })
  }, [])

  return (
    <div className="auth-page">
      <div className="auth-callback-card">
        {!error && <Loader2 size={32} className="auth-callback-spinner" />}
        <h1 className="auth-callback-title">{error ? 'Sign-in failed' : 'Completing sign-in...'}</h1>
        <p className="auth-callback-message">{status}</p>
        {error && (
          <p className="auth-status auth-status-error">{error}</p>
        )}
        {error && (
          <a href={`/auth/login?redirect_uri=${encodeURIComponent(new URLSearchParams(window.location.search).get('redirect_uri') || '/')}`} className="auth-link-btn">
            Go to login
          </a>
        )}
      </div>
    </div>
  )
}
