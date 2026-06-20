import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@hachej/boring-ui-kit'
import { useSession } from './AuthProvider.js'
import { apiFetchJson, routes } from '../utils.js'
import type { User } from '../../shared/types.js'

interface MePayload {
  user: Omit<User, 'email'> & { email: string | null; isAnonymousLead?: boolean }
}

const HIDDEN_PATHS = new Set<string>([
  routes.signin,
  routes.signup,
  routes.forgotPassword,
  routes.resetPassword,
  routes.verifyEmail,
  routes.authError,
])

function buildClaimHref(pathname: string, search: string, hash: string): string {
  const callbackURL = `${pathname}${search}${hash}` || '/'
  const params = new URLSearchParams({
    claim: '1',
    callbackURL,
  })
  return `${routes.signup}?${params.toString()}`
}

export function OutreachClaimBanner() {
  const session = useSession()
  const location = useLocation()
  const [isAnonymousLead, setIsAnonymousLead] = useState(false)

  useEffect(() => {
    if (!session.data?.user) {
      setIsAnonymousLead(false)
      return
    }

    let cancelled = false
    apiFetchJson<MePayload>('/api/v1/me')
      .then((payload) => {
        if (cancelled) return
        setIsAnonymousLead(payload.user.isAnonymousLead === true)
      })
      .catch(() => {
        if (cancelled) return
        setIsAnonymousLead(false)
      })

    return () => { cancelled = true }
  }, [session.data?.user?.id])

  const claimHref = useMemo(
    () => buildClaimHref(location.pathname, location.search, location.hash),
    [location.hash, location.pathname, location.search],
  )

  if (!isAnonymousLead || HIDDEN_PATHS.has(location.pathname)) return null

  return (
    <div
      role="region"
      aria-label="Temporary account"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong className="font-semibold">Temporary account.</strong>{' '}
          Create an account to keep this workspace, credits, and history.
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link to={claimHref}>Save account</Link>
        </Button>
      </div>
    </div>
  )
}
