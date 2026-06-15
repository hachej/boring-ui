import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  routes,
  useSignIn,
  useSignUp,
} from '../../../front/index.js'

export function AuthCard({
  returnTo,
  onClose,
}: {
  returnTo: string
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const signIn = useSignIn()
  const signUp = useSignUp()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = mode === 'signin'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email })
      if (result.error) {
        setError(result.error.message ?? `${mode === 'signin' ? 'Sign in' : 'Sign up'} failed`)
        return
      }
      onClose?.()
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode === 'signin' ? 'Sign in' : 'Sign up'} failed`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-3 shadow-2xl">
      {onClose ? (
        <div className="mb-3 flex justify-end">
          <button type="button" className="rounded-full px-2 py-1 text-sm text-muted-foreground hover:bg-muted" onClick={onClose} aria-label="Close sign in">×</button>
        </div>
      ) : null}
        <div className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm">
          <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'signin' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signin')}>Sign in</button>
          <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => setMode('signup')}>Sign up</button>
        </div>
        <form className="mt-3 space-y-2" onSubmit={submit}>
          {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive" role="alert">{error}</div> : null}
          {mode === 'signup' ? (
            <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" placeholder="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          ) : null}
          <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
          <input className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
          {mode === 'signin' ? (
            <div className="flex justify-end">
              <a href={routes.forgotPassword} className="text-xs text-muted-foreground hover:underline">Forgot password?</a>
            </div>
          ) : null}
          <button type="submit" className="w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'signin' ? 'Continue with email' : 'Create account'}
          </button>
        </form>

    </div>
  )
}
