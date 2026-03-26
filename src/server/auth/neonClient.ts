/**
 * Neon Auth client helpers for the hosted TS auth flow.
 */
import * as jose from 'jose'
import type { ServerConfig } from '../config.js'

const DEFAULT_TIMEOUT_MS = 30_000
const CLOCK_TOLERANCE_SECONDS = 30
const JWT_ALGORITHMS = ['EdDSA', 'ES256', 'RS256'] as const

const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()

export interface NeonPasswordAuthResult {
  response: Response
  body: unknown
  accessToken: string
}

export interface NeonAuthClient {
  signIn(email: string, password: string): Promise<{ token: string }>
  signUp(email: string, password: string, name?: string): Promise<{ userId: string }>
  verifyToken(token: string): Promise<{ userId: string; email: string }>
}

export interface VerifiedNeonToken {
  userId: string
  email: string
  exp: number
}

function normalizeBaseUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '')
}

export function neonOriginFromBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  return `${url.protocol}//${url.host}`
}

function requireNeonBaseUrl(config: Pick<ServerConfig, 'neonAuthBaseUrl'>): string {
  const baseUrl = normalizeBaseUrl(config.neonAuthBaseUrl || '')
  if (!baseUrl) {
    throw new Error('NEON_AUTH_BASE_URL is not configured')
  }
  return baseUrl
}

function buildJwksUrl(config: Pick<ServerConfig, 'neonAuthBaseUrl' | 'neonAuthJwksUrl'>): string {
  const explicit = String(config.neonAuthJwksUrl || '').trim()
  if (explicit) return explicit
  const baseUrl = requireNeonBaseUrl(config)
  return `${baseUrl}/.well-known/jwks.json`
}

function getCachedJwks(jwksUrl: string) {
  let jwks = jwksCache.get(jwksUrl)
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(jwksUrl))
    jwksCache.set(jwksUrl, jwks)
  }
  return jwks
}

async function parseJsonLike(response: Pick<Response, 'text'>): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function getSetCookieValues(headers: Headers): string[] {
  const cookieHeaders = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
  if (Array.isArray(cookieHeaders) && cookieHeaders.length > 0) {
    return cookieHeaders
  }
  const raw = headers.get('set-cookie')
  return raw ? [raw] : []
}

function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((value) => value.split(';', 1)[0]?.trim() || '')
    .filter(Boolean)
    .join('; ')
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
  const body = await parseJsonLike(response)
  return { response, body }
}

function extractAccessToken(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const token = (body as Record<string, unknown>).token
  return typeof token === 'string' ? token.trim() : ''
}

export async function fetchNeonSessionToken(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  cookieHeader: string,
): Promise<string> {
  if (!cookieHeader) return ''
  const baseUrl = requireNeonBaseUrl(config)
  const { response, body } = await fetchJson(`${baseUrl}/token`, {
    method: 'GET',
    headers: {
      Cookie: cookieHeader,
    },
  })
  if (!response.ok || !body || typeof body !== 'object') return ''
  const token = (body as Record<string, unknown>).token
  return typeof token === 'string' ? token.trim() : ''
}

export async function signInWithPassword(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  email: string,
  password: string,
): Promise<NeonPasswordAuthResult> {
  const baseUrl = requireNeonBaseUrl(config)
  const { response, body } = await fetchJson(`${baseUrl}/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: neonOriginFromBaseUrl(baseUrl),
    },
    body: JSON.stringify({ email, password }),
  })

  let accessToken = extractAccessToken(body)
  if (!accessToken) {
    const cookieHeader = toCookieHeader(getSetCookieValues(response.headers))
    if (cookieHeader) {
      accessToken = await fetchNeonSessionToken(config, cookieHeader)
    }
  }

  return { response, body, accessToken }
}

export async function signUpWithPassword(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  email: string,
  password: string,
  name: string,
): Promise<{ response: Response; body: unknown }> {
  const baseUrl = requireNeonBaseUrl(config)
  return fetchJson(`${baseUrl}/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: neonOriginFromBaseUrl(baseUrl),
    },
    body: JSON.stringify({ email, password, name }),
  })
}

export async function sendVerificationEmail(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  email: string,
  callbackUrl: string,
  origin: string,
): Promise<{ response: Response; body: unknown }> {
  const baseUrl = requireNeonBaseUrl(config)
  const payload: Record<string, string> = { email }
  if (callbackUrl) payload.callbackURL = callbackUrl
  return fetchJson(`${baseUrl}/send-verification-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(payload),
  })
}

export async function requestPasswordResetEmail(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  email: string,
  redirectTo: string,
): Promise<{ response: Response; body: unknown }> {
  const baseUrl = requireNeonBaseUrl(config)
  return fetchJson(`${baseUrl}/request-password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: neonOriginFromBaseUrl(baseUrl),
    },
    body: JSON.stringify({ email, redirectTo }),
  })
}

export async function resetPassword(
  config: Pick<ServerConfig, 'neonAuthBaseUrl'>,
  token: string,
  newPassword: string,
): Promise<{ response: Response; body: unknown }> {
  const baseUrl = requireNeonBaseUrl(config)
  return fetchJson(`${baseUrl}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: neonOriginFromBaseUrl(baseUrl),
    },
    body: JSON.stringify({ token, newPassword }),
  })
}

export async function verifyNeonAccessToken(
  token: string,
  config: Pick<ServerConfig, 'neonAuthBaseUrl' | 'neonAuthJwksUrl'>,
): Promise<VerifiedNeonToken | null> {
  const trimmedToken = String(token || '').trim()
  if (!trimmedToken) return null

  const baseUrl = requireNeonBaseUrl(config)
  const audience = neonOriginFromBaseUrl(baseUrl)
  const jwksUrl = buildJwksUrl(config)

  try {
    const { payload } = await jose.jwtVerify(trimmedToken, getCachedJwks(jwksUrl), {
      audience,
      algorithms: [...JWT_ALGORITHMS],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'exp'],
    })

    const userId = typeof payload.sub === 'string' ? payload.sub.trim() : ''
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    const exp = typeof payload.exp === 'number' ? payload.exp : 0

    if (!userId || !email || !exp) return null
    return { userId, email, exp }
  } catch {
    return null
  }
}

export function createNeonAuthClient(baseUrl: string): NeonAuthClient {
  const config = {
    neonAuthBaseUrl: baseUrl,
    neonAuthJwksUrl: undefined,
  } as Pick<ServerConfig, 'neonAuthBaseUrl' | 'neonAuthJwksUrl'>

  return {
    async signIn(email: string, password: string) {
      const result = await signInWithPassword(config, email, password)
      return { token: result.accessToken }
    },
    async signUp(email: string, password: string, name = '') {
      const { body } = await signUpWithPassword(config, email, password, name || email.split('@')[0] || 'user')
      const userId = (
        body
        && typeof body === 'object'
        && (body as Record<string, unknown>).user
        && typeof (body as Record<string, unknown>).user === 'object'
      )
        ? String(((body as Record<string, unknown>).user as Record<string, unknown>).id || '')
        : ''
      return { userId }
    },
    async verifyToken(token: string) {
      const verified = await verifyNeonAccessToken(token, config)
      if (!verified) {
        throw new Error('Unable to verify Neon access token')
      }
      return {
        userId: verified.userId,
        email: verified.email,
      }
    },
  }
}
