/**
 * Auth service — transport-independent authentication logic.
 * Mirrors Python's control_plane auth_session.py + auth_router_neon.py.
 */
import type { SessionPayload } from '../../shared/types.js'

export interface AuthServiceDeps {
  sessionSecret: string
  neonAuthBaseUrl?: string
  controlPlaneProvider: 'local' | 'neon'
}

export interface AuthService {
  createSessionCookie(
    userId: string,
    email: string,
    options?: { ttlSeconds?: number; appId?: string },
  ): Promise<string>
  parseSessionCookie(token: string): Promise<SessionPayload>
  cookieName(appId?: string): string
}

export function createAuthService(_deps: AuthServiceDeps): AuthService {
  throw new Error('Not implemented — see bd-rwy92.4 (Phase 1: Auth system port)')
}

// Session cookie constants
export const COOKIE_NAME = 'boring_session'
export const SESSION_ALGORITHM = 'HS256'
export const CLOCK_SKEW_LEEWAY_SECONDS = 30
