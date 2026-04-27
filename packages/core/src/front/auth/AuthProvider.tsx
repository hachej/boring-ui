import { createContext, useContext, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { getAuthClient } from './authClient.js'
import type { AuthClient } from './authClient.js'
import { routes } from '../utils.js'
import type { SessionState, User } from '../../shared/types.js'

export interface AuthProviderProps {
  children: ReactNode
  baseURL?: string
  queryClient?: { clear(): void }
  navigate?: (path: string) => void
}

interface AuthContextValue {
  client: AuthClient
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function toISOString(value: string | Date | undefined | null): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  return value
}

function normalizeUser(raw: Record<string, unknown>): User {
  return {
    id: raw.id as string,
    email: raw.email as string,
    name: (raw.name as string | null) ?? null,
    emailVerified: Boolean(raw.emailVerified),
    image: (raw.image as string | null) ?? null,
    createdAt: toISOString(raw.createdAt as string | Date),
    updatedAt: toISOString(raw.updatedAt as string | Date),
  }
}

export function AuthProvider({
  children,
  baseURL,
  queryClient,
  navigate,
}: AuthProviderProps) {
  const client = useMemo(() => getAuthClient(baseURL), [baseURL])

  const signOut = useCallback(async () => {
    await client.signOut()
    queryClient?.clear()
    navigate?.(routes.signin)
  }, [client, queryClient, navigate])

  const value = useMemo<AuthContextValue>(
    () => ({ client, signOut }),
    [client, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useSession/signIn/signOut must be used within an AuthProvider')
  return ctx
}

export function useSession(): SessionState {
  const { client } = useAuthContext()
  const session = client.useSession()

  const raw = session.data as Record<string, unknown> | null
  const rawUser = raw?.user as Record<string, unknown> | undefined
  const rawSession = raw?.session as Record<string, unknown> | undefined

  // better-auth's useSession returns `data: { user, session }` for an
  // active session, `data: null` for unauthenticated, but some transport
  // shapes return `data: { data: null, error: null }` (an envelope) which
  // is truthy without a `.user` field. Treat any data without a user as
  // "unauthenticated" rather than crashing on normalizeUser(undefined).
  return {
    data: rawUser
      ? {
          user: normalizeUser(rawUser),
          expiresAt: toISOString(rawSession?.expiresAt as string | Date),
        }
      : null,
    isPending: session.isPending,
    error: session.error
      ? { status: session.error.status ?? 0, code: 'unauthorized' as const, message: session.error.message ?? 'Session error' }
      : null,
  }
}

export function useSignIn() {
  const { client } = useAuthContext()
  return client.signIn
}

export function useSignUp() {
  const { client } = useAuthContext()
  return client.signUp
}

export function useForgetPassword() {
  const { client } = useAuthContext()
  // better-auth maps /request-password-reset → forgetPassword via path-to-object proxy
  return (client as any).forgetPassword as (opts: {
    email: string
    redirectTo: string
  }) => Promise<{ data: unknown; error: unknown }>
}

export function useResetPassword() {
  const { client } = useAuthContext()
  return client.resetPassword
}

export function useVerifyEmail() {
  const { client } = useAuthContext()
  return (client as any).verifyEmail as (opts: {
    query: { token: string }
  }) => Promise<{ data: unknown; error: { status: number; message: string } | null }>
}

export function useSendVerificationEmail() {
  const { client } = useAuthContext()
  return (client as any).sendVerificationEmail as (opts: {
    email: string
    callbackURL?: string
  }) => Promise<{ data: unknown; error: unknown }>
}

export function useChangePassword() {
  const { client } = useAuthContext()
  return (client as any).changePassword as (opts: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<{ data: unknown; error: { status: number; message: string } | null }>
}

export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuthContext()
  return signOut
}
