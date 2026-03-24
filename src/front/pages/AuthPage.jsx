import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getConfig } from '../config'
import { routeHref, routes } from '../utils/routes'
import ThemeToggle from '../components/ThemeToggle'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import './auth.css'

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

function parseNeonError(body) {
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

function buildLocalLoginUrl(emailValue, redirectUri) {
  const normalizedEmail = String(emailValue || '').trim().toLowerCase()
  const fallbackUserId = normalizedEmail
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'local-user'
  const url = new URL('/auth/login', window.location.origin)
  url.searchParams.set('user_id', `local-${fallbackUserId}`)
  url.searchParams.set('email', normalizedEmail)
  url.searchParams.set('redirect_uri', redirectUri)
  return `${url.pathname}${url.search}`
}

export default function AuthPage({ authConfig }) {
  const config = getConfig()
  const branding = config?.branding || {}
  const appName = authConfig?.appName || branding.name || 'Boring UI'
  const appDescription = authConfig?.appDescription || ''

  const provider = authConfig?.provider === 'neon' ? 'neon' : 'local'
  const isNeon = provider === 'neon'
  const isLocal = provider === 'local'
  const urlSearchParams = new URLSearchParams(window.location.search)

  const redirectUri = safeRedirectPath(authConfig?.redirectUri || urlSearchParams.get('redirect_uri'))
  const resetToken = String(urlSearchParams.get('token') || '').trim()
  const resetLinkError = String(urlSearchParams.get('error') || '').trim()
  const initialMode = authConfig?.initialMode === 'sign_up'
    ? 'sign_up'
    : authConfig?.initialMode === 'reset_password'
      ? 'reset_password'
      : 'sign_in'

  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verificationRecoveryEmail, setVerificationRecoveryEmail] = useState('')
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  useEffect(() => {
    const pageTitle = mode === 'sign_up'
      ? 'Create account'
      : mode === 'reset_password'
        ? 'Reset password'
        : 'Sign in'
    document.title = `${pageTitle} — ${appName}`
    if (mode === 'reset_password') {
      passwordRef.current?.focus()
      return
    }
    emailRef.current?.focus()
  }, [appName, mode])

  const showStatus = useCallback((message, error = false) => {
    setStatus(message)
    setIsError(error)
  }, [])

  const clearVerificationRecovery = useCallback(() => {
    setVerificationRecoveryEmail('')
  }, [])

  const clearFormStatus = useCallback(() => {
    showStatus('')
  }, [showStatus])

  const switchMode = useCallback((nextMode) => {
    setMode(nextMode)
    clearVerificationRecovery()
    clearFormStatus()
    setPassword('')
    setConfirmPassword('')
  }, [clearFormStatus, clearVerificationRecovery])

  useEffect(() => {
    if (mode !== 'reset_password') return
    if (!resetToken) {
      showStatus('Password reset link is missing or invalid. Request a new one.', true)
      return
    }
    if (!resetLinkError) return
    const normalizedError = resetLinkError.replace(/[_-]+/g, ' ').toLowerCase()
    if (normalizedError.includes('expired') || normalizedError.includes('invalid')) {
      showStatus('This password reset link is invalid or has expired. Request a new one.', true)
      return
    }
    showStatus(`Unable to use this reset link: ${resetLinkError}`, true)
  }, [mode, resetLinkError, resetToken, showStatus])

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

  const handleRequestPasswordReset = async () => {
    if (busy) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      showStatus('Enter your email to receive a reset link.', true)
      return
    }

    setBusy(true)
    showStatus('Sending password reset email...')
    try {
      const result = await neonPasswordAuth('/auth/request-password-reset', {
        email: trimmed,
        redirect_uri: redirectUri,
      })
      if (result.error) {
        showStatus(result.error, true)
        return
      }
      showStatus(result.message || 'Password reset email sent. Check your inbox.')
    } finally {
      setBusy(false)
    }
  }

  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!resetToken) {
      showStatus('Password reset link is missing or invalid. Request a new one.', true)
      return
    }
    if (!password || !confirmPassword) {
      showStatus('Enter and confirm your new password.', true)
      return
    }
    if (password !== confirmPassword) {
      showStatus('Passwords do not match.', true)
      return
    }

    setBusy(true)
    showStatus('Updating password...')
    try {
      const result = await neonPasswordAuth('/auth/reset-password', {
        token: resetToken,
        new_password: password,
        redirect_uri: redirectUri,
      })
      if (result.error) {
        showStatus(result.error, true)
        return
      }
      setPassword('')
      setConfirmPassword('')
      setMode('sign_in')
      showStatus(result.message || 'Password updated. Sign in with your new password.')
    } finally {
      setBusy(false)
    }
  }

  const handleLocalSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !password) {
      showStatus('Enter email and password.', true)
      return
    }
    window.location.assign(buildLocalLoginUrl(trimmed, redirectUri))
  }

  const handleSubmit = mode === 'reset_password'
    ? handleResetPasswordSubmit
    : isNeon
      ? handleNeonSubmit
      : handleLocalSubmit

  const isSignUp = mode === 'sign_up'
  const isResetPassword = mode === 'reset_password'
  const formReady = isNeon || isLocal || isResetPassword
  const canResendVerification = isNeon
    && mode === 'sign_in'
    && !!verificationRecoveryEmail
    && verificationRecoveryEmail === email.trim().toLowerCase()
  const title = isResetPassword
    ? 'Set a new password'
    : isSignUp
      ? 'Create your account'
      : 'Welcome back'
  const subtitle = isResetPassword
    ? 'Choose a new password for your account.'
    : isSignUp
      ? 'Get started in minutes.'
      : 'Use your email and password to continue.'
  const submitLabel = isResetPassword
    ? 'Update password'
    : isSignUp
      ? 'Create account'
      : 'Continue'

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
            {isResetPassword ? (
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => switchMode('sign_in')}
                disabled={busy}
              >
                Back to sign in
              </button>
            ) : (
              <Tabs
                value={isSignUp ? 'sign_up' : 'sign_in'}
                onValueChange={(nextValue) => switchMode(nextValue)}
              >
                <TabsList className="auth-tabs" aria-label="Authentication mode">
                  <TabsTrigger
                    value="sign_in"
                    className="auth-tab"
                    onClick={() => switchMode('sign_in')}
                    disabled={busy}
                  >
                    Sign in
                  </TabsTrigger>
                  <TabsTrigger
                    value="sign_up"
                    className="auth-tab"
                    onClick={() => switchMode('sign_up')}
                    disabled={busy}
                  >
                    Create account
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <ThemeToggle />
          </div>

          <h2 className="auth-title">{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>

          <form onSubmit={handleSubmit} autoComplete="on" noValidate>
            {!isResetPassword && (
              <>
                <Label className="auth-label" htmlFor="auth-email">Work email</Label>
                <Input
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
              </>
            )}

            <Label className="auth-label" htmlFor="auth-password">
              {isResetPassword ? 'New password' : 'Password'}
            </Label>
            <Input
              ref={passwordRef}
              id="auth-password"
              className="auth-input"
              type="password"
              autoComplete={isSignUp || isResetPassword ? 'new-password' : 'current-password'}
              placeholder={isResetPassword || isSignUp ? 'Create a password (8+ characters)' : 'Enter your password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
              }}
              disabled={busy}
              required
            />

            {isResetPassword && (
              <>
                <Label className="auth-label" htmlFor="auth-confirm-password">Confirm new password</Label>
                <Input
                  id="auth-confirm-password"
                  className="auth-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                  }}
                  disabled={busy}
                  required
                />
              </>
            )}

            <button className="auth-submit" type="submit" disabled={busy || !formReady}>
              {busy && <Loader2 size={16} className="auth-spinner" />}
              {submitLabel}
            </button>
          </form>

          {status && (
            <p className={`auth-status ${isError ? 'auth-status-error' : ''}`} aria-live="polite">
              {status}
            </p>
          )}

          {isLocal && !isResetPassword && (
            <div className="auth-alt-actions">
              <p className="auth-muted">Local dev auth creates a session directly from the email you enter.</p>
            </div>
          )}

          {isNeon && mode === 'sign_in' && (
            <div className="auth-alt-actions">
              <p className="auth-muted">Lost access to your password?</p>
              <button
                type="button"
                className="auth-link-btn"
                onClick={handleRequestPasswordReset}
                disabled={busy}
              >
                Forgot password?
              </button>
            </div>
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
      // Prefer direct workspace navigation when the backend returns a
      // workspace_id from eager provisioning — avoids the redirect bounce
      // through `/` that can cause duplicate-workspace races.
      let target = payload.redirect_uri || redirectUri || '/'
      if (payload.workspace_id && (target === '/' || target === '')) {
        target = routeHref(routes.controlPlane.workspaces.setup(payload.workspace_id))
        console.debug('[AuthCallback] navigating to eager-provisioned workspace %s', payload.workspace_id)
      }
      window.location.replace(target)
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
