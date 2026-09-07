import { HttpError, ERROR_CODES } from '../shared/errors.js'
import type { ErrorCode } from '../shared/errors.js'

let apiBase = ''

export function setApiBase(base: string) {
  apiBase = base.replace(/\/$/, '')
}

export function getApiBase(): string {
  return apiBase
}

export function buildApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = getApiBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function getWsBase(): string {
  const base = getApiBase()
  if (base.startsWith('https://')) return base.replace('https://', 'wss://')
  if (base.startsWith('http://')) return base.replace('http://', 'ws://')
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'wss:'
    : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  return `${protocol}//${host}${base}`
}

export function buildWsUrl(path: string): string {
  const base = getWsBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function openWebSocket(
  path: string,
  protocols?: string | string[],
): WebSocket {
  return new WebSocket(buildWsUrl(path), protocols)
}

async function parseErrorEnvelope(
  response: Response,
): Promise<{ code: ErrorCode; message: string; requestId?: string }> {
  try {
    const body = (await response.json()) as {
      code?: string
      message?: string
      error?: string
      requestId?: string
    }
    const code = (body.code ?? 'internal_error') as ErrorCode
    const message = body.message ?? body.error ?? response.statusText
    return { code, message, requestId: body.requestId }
  } catch {
    return {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: response.statusText || `HTTP ${response.status}`,
    }
  }
}

export async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fullUrl = buildApiUrl(url)
  const response = await fetch(fullUrl, {
    ...init,
    credentials: 'include',
  }).catch((err: unknown) => {
    throw new HttpError({
      status: 0,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    })
  })

  if (!response.ok) {
    const envelope = await parseErrorEnvelope(response)
    throw new HttpError({
      status: response.status,
      code: envelope.code,
      message: envelope.message,
      requestId: envelope.requestId,
    })
  }

  return response
}

export async function apiFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(url, init)
  return response.json() as Promise<T>
}

export function getHttpErrorDetail(
  err: unknown,
): { code: string; message: string; status?: number } {
  if (err instanceof HttpError) {
    return { code: err.code, message: err.message, status: err.status }
  }
  if (err instanceof Error) {
    return { code: 'internal_error', message: err.message }
  }
  return { code: 'internal_error', message: String(err) }
}

export type RouteMap = {
  signin: '/auth/signin'
  signup: '/auth/signup'
  forgotPassword: '/auth/forgot-password'
  resetPassword: '/auth/reset-password'
  verifyEmail: '/auth/verify-email'
  authError: '/auth/error'
  callbackGithub: '/auth/callback/github'
  callbackGoogle: '/auth/callback/google'
  me: '/me'
  workspaceMembers: '/w/:id/members'
  workspaceInvites: '/w/:id/invites'
  workspaceSettings: '/w/:id/settings'
  companyAdmin: '/w/:id/admin'
  inviteAccept: '/invites/:token'
}

export const routes: RouteMap = {
  signin: '/auth/signin',
  signup: '/auth/signup',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  verifyEmail: '/auth/verify-email',
  authError: '/auth/error',
  callbackGithub: '/auth/callback/github',
  callbackGoogle: '/auth/callback/google',
  me: '/me',
  workspaceMembers: '/w/:id/members',
  workspaceInvites: '/w/:id/invites',
  workspaceSettings: '/w/:id/settings',
  companyAdmin: '/w/:id/admin',
  inviteAccept: '/invites/:token',
}

export function routeHref(
  name: keyof RouteMap,
  params?: Record<string, string>,
): string {
  let path: string = routes[name]
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value))
    }
  }
  return path
}

// Matches the *entire* redirect value against a single-segment `/invites/:token` path: no
// leading `//` (protocol-relative), no trailing segments, no `?`/`#` smuggled into the
// captured segment. Anything else (absolute URLs, extra path parts, query/hash) fails to
// match at all rather than being trimmed down to a plausible-looking prefix.
const INVITE_ACCEPT_PATH_RE = /^\/invites\/([^/?#]+)$/

// Invite tokens are generated server-side as either a v4 UUID (LocalWorkspaceStore's
// `randomUUID()`) or a 32-byte base64url string (PostgresWorkspaceStore's
// `randomBytes(32).toString('base64url')`, 43 chars, unpadded). Only these two exact shapes
// are accepted — anything else (including a decoded separator like `%2F`, which can only
// ever decode to a `/`) is rejected rather than forwarded as a "close enough" token.
//
// The UUID branch is pinned to what `randomUUID()` can actually emit: version nibble `4`
// (13th hex digit) and RFC 4122 variant nibble `8`/`9`/`a`/`b` (17th hex digit). A
// syntactically UUID-shaped string with any other version/variant nibble (e.g. a v1 UUID)
// is not a value `randomUUID()` can produce, so it is rejected rather than accepted as
// "close enough".
const INVITE_TOKEN_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Za-z0-9_-]{43})$/

/**
 * The invite-accept redirect (`?redirect=/invites/:token`) carries the invite token in the
 * path, not as an `invite_token` query param. Signup needs the raw token to send the
 * `x-invite-token` header, so this recovers it when only `redirect` was forwarded.
 *
 * Strict by construction: the redirect must be the complete, single-segment invite-accept
 * path (no extra segments, no query/hash smuggled in), the segment is percent-decoded
 * exactly once (a throw on malformed escapes yields `null`, never the raw/undecoded text),
 * and the decoded result must match the invite token's actual character class. Anything
 * that doesn't fully qualify returns `null` — never a fabricated or truncated token.
 */
export function extractInviteTokenFromRedirect(redirect: string | null): string | null {
  if (!redirect) return null
  const match = INVITE_ACCEPT_PATH_RE.exec(redirect)
  if (!match) return null

  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    return null
  }

  return INVITE_TOKEN_RE.test(decoded) ? decoded : null
}

/**
 * Builds an href to another auth route that forwards `redirect` and `invite_token` from the
 * current query string, so invite context survives switching between sign-in and sign-up.
 */
export function withForwardedAuthParams(path: string, search: string): string {
  const params = new URLSearchParams(search)
  const redirect = params.get('redirect')
  const inviteToken = params.get('invite_token') ?? extractInviteTokenFromRedirect(redirect)

  const forwarded = new URLSearchParams()
  if (redirect) forwarded.set('redirect', redirect)
  if (inviteToken) forwarded.set('invite_token', inviteToken)

  const qs = forwarded.toString()
  return qs ? `${path}?${qs}` : path
}
