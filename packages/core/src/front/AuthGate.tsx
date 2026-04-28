import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useSession } from './auth/AuthProvider.js'
import { routes } from './utils.js'

const DEFAULT_GRACE_MS = 30_000
const UNSAFE_REDIRECT_RE = /[\0\r\n<>"'`]/

export interface AuthGateLocation {
  pathname: string
  search?: string
  hash?: string
}

export interface AuthGateProps {
  children: ReactNode
  publicPaths?: string[]
  graceMs?: number
  location?: AuthGateLocation
  navigate?: (to: string, options?: { replace?: boolean }) => void
  now?: () => number
}

function normalizePath(pathname: string): string {
  if (!pathname) return '/'
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

function normalizeSearch(search?: string): string {
  if (!search) return ''
  return search.startsWith('?') ? search : `?${search}`
}

function normalizeHash(hash?: string): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash : `#${hash}`
}

function buildCurrentPath(location: AuthGateLocation): string {
  return `${normalizePath(location.pathname)}${normalizeSearch(location.search)}${normalizeHash(location.hash)}`
}

function normalizePublicPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1)
  return normalized
}

function isPublicPath(pathname: string, publicPaths: string[]): boolean {
  const normalizedPath = normalizePath(pathname)
  if (normalizedPath === '/auth' || normalizedPath.startsWith('/auth/')) return true

  return publicPaths.some((candidate) => (
    normalizedPath === candidate || normalizedPath.startsWith(`${candidate}/`)
  ))
}

function readSafeRedirect(search?: string): string | null {
  const redirect = new URLSearchParams(normalizeSearch(search)).get('redirect')
  if (!redirect) return null
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return null
  if (UNSAFE_REDIRECT_RE.test(redirect)) return null
  return redirect
}

function defaultLocation(): AuthGateLocation {
  if (typeof window === 'undefined') return { pathname: '/' }
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  }
}

function defaultNavigate(to: string, options?: { replace?: boolean }) {
  if (typeof window === 'undefined') return
  if (options?.replace) {
    window.location.replace(to)
    return
  }
  window.location.assign(to)
}

export function AuthGate({
  children,
  publicPaths = [],
  graceMs = DEFAULT_GRACE_MS,
  location,
  navigate,
  now,
}: AuthGateProps) {
  const session = useSession()
  const nullSinceRef = useRef<number | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const readNow = now ?? Date.now
  const currentLocation = location ?? defaultLocation()
  const goTo = navigate ?? defaultNavigate
  const normalizedPublicPaths = useMemo(
    () => publicPaths.map(normalizePublicPath),
    [publicPaths],
  )

  useEffect(() => {
    return () => {
      if (!redirectTimerRef.current) return
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = null
    }

    const pathname = normalizePath(currentLocation.pathname)
    const currentPath = buildCurrentPath(currentLocation)

    if (session.data) {
      nullSinceRef.current = null

      if (pathname === routes.signin) {
        const destination = readSafeRedirect(currentLocation.search) ?? '/'
        if (destination !== currentPath) {
          goTo(destination, { replace: true })
        }
      }
      return
    }

    if (session.isPending || isPublicPath(pathname, normalizedPublicPaths)) {
      nullSinceRef.current = null
      return
    }

    const nowMs = readNow()
    if (nullSinceRef.current === null) {
      nullSinceRef.current = nowMs
    }

    const elapsedMs = nowMs - nullSinceRef.current
    if (elapsedMs >= graceMs) {
      goTo(`${routes.signin}?redirect=${encodeURIComponent(currentPath)}`, { replace: true })
      return
    }

    const remainingMs = graceMs - elapsedMs
    redirectTimerRef.current = setTimeout(() => {
      goTo(`${routes.signin}?redirect=${encodeURIComponent(currentPath)}`, { replace: true })
    }, remainingMs)
    redirectTimerRef.current.unref?.()
  }, [currentLocation, goTo, graceMs, normalizedPublicPaths, readNow, session.data, session.isPending])

  return <>{children}</>
}
