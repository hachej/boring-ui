/**
 * Session primitives — HS256 JWT session cookies.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 * Mirrors Python's auth_session.py.
 */
import type { SessionPayload } from '../../shared/types.js'

export const COOKIE_NAME = 'boring_session'

export function createSessionCookie(
  _userId: string,
  _email: string,
  _secret: string,
  _options?: { ttlSeconds?: number; appId?: string },
): string {
  throw new Error('Not implemented — see bd-rwy92.4')
}

export function parseSessionCookie(
  _token: string,
  _secret: string,
): SessionPayload {
  throw new Error('Not implemented — see bd-rwy92.4')
}

export function appCookieName(appId?: string): string {
  return appId ? `boring_session_${appId}` : COOKIE_NAME
}
