import { createLogger, type Logger } from '../../logging'

const DEFAULT_MIN_TTL_MS = 30_000
const OIDC_AUTH_ERROR_STATUSES = new Set([401, 403])

export interface OidcTokenPayload {
  token: string
  expiresAtMs: number
}

export interface OidcTokenRefresherOptions {
  refresh: () => Promise<OidcTokenPayload>
  applyToken?: (token: string) => Promise<void> | void
  now?: () => number
  minTtlMs?: number
  logger?: Pick<Logger, 'info' | 'warn'>
}

export class OidcRefreshFailedError extends Error {
  readonly errorCode = 'OIDC_REFRESH_FAILED' as const

  constructor(message = 'Vercel auth expired; restart with fresh VERCEL_OIDC_TOKEN', cause?: unknown) {
    super(message, { cause })
    this.name = 'OidcRefreshFailedError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validatePayload(payload: OidcTokenPayload, now: number): OidcTokenPayload {
  if (typeof payload.token !== 'string' || payload.token.trim().length === 0) {
    throw new Error('OIDC refresh returned an empty token')
  }
  if (!Number.isFinite(payload.expiresAtMs) || payload.expiresAtMs <= now) {
    throw new Error('OIDC refresh returned an expired token')
  }
  return {
    token: payload.token,
    expiresAtMs: payload.expiresAtMs,
  }
}

export class OidcTokenRefresher {
  private readonly refresh: () => Promise<OidcTokenPayload>
  private readonly applyToken: (token: string) => Promise<void> | void
  private readonly now: () => number
  private readonly minTtlMs: number
  private readonly logger: Pick<Logger, 'info' | 'warn'>
  private cached: OidcTokenPayload | null = null

  constructor(opts: OidcTokenRefresherOptions) {
    this.refresh = opts.refresh
    this.applyToken = opts.applyToken ?? (() => {})
    this.now = opts.now ?? Date.now
    this.minTtlMs = opts.minTtlMs ?? DEFAULT_MIN_TTL_MS
    this.logger = opts.logger ?? createLogger('[oidc]')
  }

  async getValidToken(): Promise<OidcTokenPayload> {
    const token = this.cached
    if (token && token.expiresAtMs - this.now() > this.minTtlMs) {
      return token
    }
    return await this.refreshToken()
  }

  async forceRefresh(): Promise<OidcTokenPayload> {
    return await this.refreshToken(true)
  }

  private async refreshToken(force = false): Promise<OidcTokenPayload> {
    if (!force) {
      const token = this.cached
      if (token && token.expiresAtMs - this.now() > this.minTtlMs) {
        return token
      }
    }

    try {
      const refreshed = validatePayload(await this.refresh(), this.now())
      await this.applyToken(refreshed.token)
      this.cached = refreshed
      this.logger.info('[oidc] refreshed token', {
        expiresAtMs: refreshed.expiresAtMs,
        nextRefreshAtMs: refreshed.expiresAtMs - this.minTtlMs,
      })
      return refreshed
    } catch (error) {
      this.logger.warn('[oidc] refresh failed', { reason: errorMessage(error) })
      throw new OidcRefreshFailedError(
        'Vercel auth expired; restart with fresh VERCEL_OIDC_TOKEN',
        error,
      )
    }
  }
}

export function extractHttpStatus(error: unknown): number | null {
  const directStatus = (error as { status?: unknown } | null)?.status
  if (typeof directStatus === 'number') {
    return directStatus
  }

  const response = (error as { response?: { status?: unknown } } | null)?.response
  return typeof response?.status === 'number' ? response.status : null
}

export function isOidcAuthError(error: unknown): boolean {
  const status = extractHttpStatus(error)
  return status !== null && OIDC_AUTH_ERROR_STATUSES.has(status)
}
