const DEFAULT_MIN_TTL_MS = 30_000
const OIDC_AUTH_ERROR_STATUSES = new Set([401, 403])

interface Logger {
  info(message: string, metadata?: Record<string, unknown>): void
  warn(message: string, metadata?: Record<string, unknown>): void
}

function createDefaultLogger(prefix: string): Logger {
  return {
    info(message, metadata) {
      console.log(JSON.stringify({ level: 'info', prefix, msg: message, ...(metadata ?? {}), t: new Date().toISOString() }))
    },
    warn(message, metadata) {
      console.warn(JSON.stringify({ level: 'warn', prefix, msg: message, ...(metadata ?? {}), t: new Date().toISOString() }))
    },
  }
}

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
  private inFlightRefresh: Promise<OidcTokenPayload> | null = null

  constructor(opts: OidcTokenRefresherOptions) {
    this.refresh = opts.refresh
    this.applyToken = opts.applyToken ?? (() => {})
    this.now = opts.now ?? Date.now
    this.minTtlMs = opts.minTtlMs ?? DEFAULT_MIN_TTL_MS
    this.logger = opts.logger ?? createDefaultLogger('[oidc]')
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

    if (this.inFlightRefresh) {
      return await this.inFlightRefresh
    }

    this.inFlightRefresh = (async () => {
      try {
        const refreshed = validatePayload(await this.refresh(), this.now())
        await this.applyToken(refreshed.token)
        this.cached = refreshed
        this.logger.info('refreshed token', {
          expiresAtMs: refreshed.expiresAtMs,
          nextRefreshAtMs: refreshed.expiresAtMs - this.minTtlMs,
        })
        return refreshed
      } catch (error) {
        this.logger.warn('refresh failed', { reason: errorMessage(error) })
        throw new OidcRefreshFailedError(
          'Vercel auth expired; restart with fresh VERCEL_OIDC_TOKEN',
          error,
        )
      } finally {
        this.inFlightRefresh = null
      }
    })()

    return await this.inFlightRefresh
  }
}

function coerceHttpStatus(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    // Some HTTP clients surface numeric status codes as strings.
    const normalized = value.trim()
    if (!/^\d+$/.test(normalized)) {
      return null
    }
    const parsed = Number.parseInt(normalized, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function extractHttpStatus(error: unknown): number | null {
  const directStatus = coerceHttpStatus(
    (error as { status?: unknown } | null)?.status,
  )
  if (directStatus !== null) {
    return directStatus
  }

  const responseStatus = coerceHttpStatus(
    (error as { response?: { status?: unknown } } | null)?.response?.status,
  )
  return responseStatus
}

export function isOidcAuthError(error: unknown): boolean {
  const status = extractHttpStatus(error)
  return status !== null && OIDC_AUTH_ERROR_STATUSES.has(status)
}
