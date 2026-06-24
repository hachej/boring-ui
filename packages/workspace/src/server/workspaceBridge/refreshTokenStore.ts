export interface WorkspaceBridgeRuntimeRefreshTokenUseOptions {
  jti: string
  nowMs?: number
  windowMs: number
  maxUses: number
  /** Expiry time for the refresh token that owns this jti. Used for bounded in-memory GC. */
  expiresAtMs?: number
}

export type WorkspaceBridgeRuntimeRefreshTokenUseResult =
  | { allowed: true }
  | { allowed: false; reason: "revoked" }
  | { allowed: false; reason: "rate-limited"; retryAfterMs: number }

export interface WorkspaceBridgeRuntimeRefreshTokenStore {
  revoke(jti: string, expiresAtMs?: number): void | Promise<void>
  recordUse(options: WorkspaceBridgeRuntimeRefreshTokenUseOptions): WorkspaceBridgeRuntimeRefreshTokenUseResult | Promise<WorkspaceBridgeRuntimeRefreshTokenUseResult>
}

interface RateLimitRecord {
  windowStartMs: number
  windowMs: number
  count: number
  expiresAtMs?: number
}

export class InMemoryWorkspaceBridgeRuntimeRefreshTokenStore implements WorkspaceBridgeRuntimeRefreshTokenStore {
  private readonly revoked = new Map<string, number | undefined>()
  private readonly rateLimits = new Map<string, RateLimitRecord>()
  private lastGcMs = 0

  revoke(jti: string, expiresAtMs?: number): void {
    this.gc()
    this.revoked.set(jti, expiresAtMs)
    this.rateLimits.delete(jti)
  }

  recordUse(options: WorkspaceBridgeRuntimeRefreshTokenUseOptions): WorkspaceBridgeRuntimeRefreshTokenUseResult {
    const nowMs = options.nowMs ?? Date.now()
    this.gc(nowMs)
    if (this.revoked.has(options.jti)) return { allowed: false, reason: "revoked" }
    if (options.maxUses <= 0) return { allowed: false, reason: "rate-limited", retryAfterMs: options.windowMs }

    const existing = this.rateLimits.get(options.jti)
    if (!existing || nowMs - existing.windowStartMs >= existing.windowMs || isExpired(existing.expiresAtMs, nowMs)) {
      this.rateLimits.set(options.jti, {
        windowStartMs: nowMs,
        windowMs: options.windowMs,
        count: 1,
        expiresAtMs: options.expiresAtMs,
      })
      return { allowed: true }
    }
    if (existing.count >= options.maxUses) {
      return { allowed: false, reason: "rate-limited", retryAfterMs: Math.max(0, existing.windowStartMs + existing.windowMs - nowMs) }
    }
    existing.count += 1
    existing.windowMs = options.windowMs
    existing.expiresAtMs = options.expiresAtMs ?? existing.expiresAtMs
    return { allowed: true }
  }

  gc(nowMs = Date.now()): number {
    if (nowMs - this.lastGcMs < 60_000) return 0
    this.lastGcMs = nowMs
    let removed = 0
    for (const [jti, record] of this.rateLimits) {
      if (isExpired(record.expiresAtMs, nowMs) || nowMs - record.windowStartMs >= record.windowMs) {
        this.rateLimits.delete(jti)
        removed += 1
      }
    }
    for (const [jti, expiresAtMs] of this.revoked) {
      if (isExpired(expiresAtMs, nowMs)) {
        this.revoked.delete(jti)
        removed += 1
      }
    }
    return removed
  }
}

function isExpired(expiresAtMs: number | undefined, nowMs: number): boolean {
  return expiresAtMs !== undefined && expiresAtMs <= nowMs
}
