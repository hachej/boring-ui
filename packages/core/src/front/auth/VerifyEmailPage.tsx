import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label } from '@boring/ui'
import { useSession, useSendVerificationEmail, useVerifyEmail } from './AuthProvider.js'
import { routes } from '../utils.js'

type VerifyStatus = 'verifying' | 'verified' | 'expired' | 'invalid' | 'no-token'

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

export function VerifyEmailPage() {
  const session = useSession()
  const verifyEmail = useVerifyEmail()
  const sendVerificationEmail = useSendVerificationEmail()

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token')
    : null

  const [status, setStatus] = useState<VerifyStatus>(token ? 'verifying' : 'no-token')
  const [inviteWarning, setInviteWarning] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const verifiedRef = useRef(false)

  const sessionEmail = session.data?.user?.email ?? null

  useEffect(() => {
    const cookie = getCookie('boring_invite_failed')
    if (cookie) {
      setInviteWarning(cookie || "Your invite link was invalid; you’re signed in.")
      deleteCookie('boring_invite_failed')
    }
  }, [])

  useEffect(() => {
    if (!token || verifiedRef.current) return
    verifiedRef.current = true
    ;(async () => {
      try {
        const result = await verifyEmail({ query: { token } })
        if (result.error) {
          const s = result.error.status
          const msg = (result.error.message ?? '').toLowerCase()
          if (s === 410 || msg.includes('expired')) {
            setStatus('expired')
          } else {
            setStatus('invalid')
          }
        } else {
          setStatus('verified')
        }
      } catch {
        setStatus('invalid')
      }
    })()
  }, [token, verifyEmail])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(id)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleResend = useCallback(async () => {
    const email = sessionEmail ?? resendEmail.trim()
    if (!email || cooldown > 0) return
    try {
      await sendVerificationEmail({ email, callbackURL: routes.verifyEmail })
    } catch {
      // Show success regardless to avoid account enumeration
    }
    setResendSent(true)
    setCooldown(60)
  }, [sessionEmail, resendEmail, cooldown, sendVerificationEmail])

  const resendButton = (
    <Button
      variant="outline"
      className="w-full"
      disabled={cooldown > 0 || (!sessionEmail && !resendEmail.trim())}
      onClick={handleResend}
    >
      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
    </Button>
  )

  const resendSection = (
    <div className="space-y-3">
      {!sessionEmail && (
        <div className="space-y-2">
          <Label htmlFor="resend-email">Email</Label>
          <Input
            id="resend-email"
            type="email"
            placeholder="you@example.com"
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
          />
        </div>
      )}
      {resendButton}
      {resendSent && (
        <p className="text-sm text-muted-foreground text-center">
          If an account exists with that email, we sent a new verification link.
        </p>
      )}
    </div>
  )

  if (status === 'verifying') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Verifying your email</CardTitle>
            <CardDescription>Please wait…</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (status === 'verified') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          {inviteWarning && (
            <div role="status" className="px-6 pt-4">
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {inviteWarning}
              </div>
            </div>
          )}
          <CardHeader>
            <CardTitle>Email verified</CardTitle>
            <CardDescription>
              Your email has been verified. You can now continue.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <a href="/" className="w-full">
              <Button className="w-full">Continue</Button>
            </a>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          {inviteWarning && (
            <div role="status" className="px-6 pt-4">
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {inviteWarning}
              </div>
            </div>
          )}
          <CardHeader>
            <CardTitle>Link expired</CardTitle>
            <CardDescription>
              This verification link is no longer valid. Request a new one below.
            </CardDescription>
          </CardHeader>
          <CardContent>{resendSection}</CardContent>
          <CardFooter>
            <a href={routes.signin} className="text-sm text-muted-foreground hover:underline">
              Back to sign in
            </a>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // 'invalid' or 'no-token'
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        {inviteWarning && (
          <div role="status" className="px-6 pt-4">
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {inviteWarning}
            </div>
          </div>
        )}
        <CardHeader>
          <CardTitle>Invalid verification link</CardTitle>
          <CardDescription>
            {status === 'no-token'
              ? 'No verification token found. Check the link in your email.'
              : 'This verification link is invalid. Request a new one below.'}
          </CardDescription>
        </CardHeader>
        <CardContent>{resendSection}</CardContent>
        <CardFooter>
          <a href={routes.signin} className="text-sm text-muted-foreground hover:underline">
            Back to sign in
          </a>
        </CardFooter>
      </Card>
    </div>
  )
}
