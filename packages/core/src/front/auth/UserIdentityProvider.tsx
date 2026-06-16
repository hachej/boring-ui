import { createContext, useContext, useEffect, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { canUseProtectedApi, isRuntimeEmailVerificationEnabled } from '../../shared/authPolicy.js'
import { useSession } from './AuthProvider.js'
import { useOptionalConfig } from '../ConfigProvider.js'
import { apiFetchJson } from '../utils.js'
import type { User } from '../../shared/types.js'

interface UserSettings {
  displayName: string
  email: string
  settings: Record<string, unknown>
}

export interface UserIdentity {
  user: User
  settings: UserSettings
}

const UserContext = createContext<UserIdentity | null>(null)

const STALE_MS = 60_000

export interface UserIdentityProviderProps {
  children: ReactNode
}

export function UserIdentityProvider({ children }: UserIdentityProviderProps) {
  const { data: session } = useSession()
  const config = useOptionalConfig()
  const canFetchIdentity = canUseProtectedApi(
    session?.user,
    isRuntimeEmailVerificationEnabled(config),
  )
  const [identity, setIdentity] = useState<UserIdentity | null>(null)
  const fetchedForRef = useRef<string | null>(null)
  const lastFetchRef = useRef(0)

  useEffect(() => {
    if (!session?.user || !canFetchIdentity) {
      setIdentity(null)
      fetchedForRef.current = null
      return
    }

    const userId = session.user.id
    const now = Date.now()
    if (fetchedForRef.current === userId && now - lastFetchRef.current < STALE_MS) {
      return
    }

    let cancelled = false

    apiFetchJson<{ user: User; settings: UserSettings }>('/api/v1/me')
      .then((data) => {
        if (cancelled) return
        setIdentity({ user: data.user, settings: data.settings })
        fetchedForRef.current = userId
        lastFetchRef.current = Date.now()
      })
      .catch(() => {
        if (cancelled) return
        setIdentity(null)
      })

    return () => { cancelled = true }
  }, [canFetchIdentity, session?.user?.id])

  return <UserContext.Provider value={identity}>{children}</UserContext.Provider>
}

export function useUser(): UserIdentity | null {
  return useContext(UserContext)
}
