import { describe, expect, it } from "vitest"
import { InMemoryWorkspaceBridgeRuntimeRefreshTokenStore } from "../refreshTokenStore"

describe("InMemoryWorkspaceBridgeRuntimeRefreshTokenStore", () => {
  it("prunes expired rate-limit and revoked jti records", () => {
    const nowMs = Date.now()
    const store = new InMemoryWorkspaceBridgeRuntimeRefreshTokenStore()
    expect(store.recordUse({
      jti: "refresh-jti-1",
      nowMs,
      windowMs: 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 10_000,
    })).toEqual({ allowed: true })
    store.revoke("refresh-jti-2", nowMs + 10_000)

    expect(store.recordUse({
      jti: "refresh-jti-2",
      nowMs,
      windowMs: 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 10_000,
    })).toEqual({ allowed: false, reason: "revoked" })
    expect(store.gc(nowMs + 70_000)).toBe(2)
    expect(store.recordUse({
      jti: "refresh-jti-2",
      nowMs: nowMs + 70_000,
      windowMs: 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 130_000,
    })).toEqual({ allowed: true })
    expect(store.recordUse({
      jti: "refresh-jti-1",
      nowMs: nowMs + 70_000,
      windowMs: 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 130_000,
    })).toEqual({ allowed: true })
  })

  it("does not shorten custom rate-limit windows during GC", () => {
    const nowMs = Date.now()
    const store = new InMemoryWorkspaceBridgeRuntimeRefreshTokenStore()
    expect(store.recordUse({
      jti: "refresh-jti-long-window",
      nowMs,
      windowMs: 60 * 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 2 * 60 * 60_000,
    })).toEqual({ allowed: true })

    expect(store.gc(nowMs + 2 * 60_000)).toBe(0)
    expect(store.recordUse({
      jti: "refresh-jti-long-window",
      nowMs: nowMs + 2 * 60_000,
      windowMs: 60 * 60_000,
      maxUses: 1,
      expiresAtMs: nowMs + 2 * 60 * 60_000,
    })).toEqual({ allowed: false, reason: "rate-limited", retryAfterMs: 58 * 60_000 })
  })
})
