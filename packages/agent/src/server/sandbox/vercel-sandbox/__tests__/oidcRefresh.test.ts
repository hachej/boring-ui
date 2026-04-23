import { describe, expect, test, vi } from 'vitest'

import {
  OidcRefreshFailedError,
  OidcTokenRefresher,
  extractHttpStatus,
  isOidcAuthError,
} from '../oidcRefresh'

describe('OidcTokenRefresher', () => {
  test('caches refreshed token while TTL is above minimum', async () => {
    let now = 10_000
    const refresh = vi.fn(async () => ({
      token: 'token-a',
      expiresAtMs: now + 120_000,
    }))
    const applyToken = vi.fn(async () => {})

    const refresher = new OidcTokenRefresher({
      refresh,
      applyToken,
      now: () => now,
      minTtlMs: 30_000,
      logger: { info: () => {}, warn: () => {} },
    })

    const first = await refresher.getValidToken()
    const second = await refresher.getValidToken()

    expect(first.token).toBe('token-a')
    expect(second.token).toBe('token-a')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(applyToken).toHaveBeenCalledTimes(1)
  })

  test('refreshes again when cached token nears expiry', async () => {
    let now = 1_000
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({
        token: 'token-first',
        expiresAtMs: now + 40_000,
      })
      .mockResolvedValueOnce({
        token: 'token-second',
        expiresAtMs: now + 100_000,
      })

    const refresher = new OidcTokenRefresher({
      refresh,
      now: () => now,
      minTtlMs: 30_000,
      logger: { info: () => {}, warn: () => {} },
    })

    const first = await refresher.getValidToken()
    now += 15_000
    const second = await refresher.getValidToken()

    expect(first.token).toBe('token-first')
    expect(second.token).toBe('token-second')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  test('forceRefresh bypasses cache', async () => {
    let now = 1_000
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({
        token: 'token-a',
        expiresAtMs: now + 120_000,
      })
      .mockResolvedValueOnce({
        token: 'token-b',
        expiresAtMs: now + 120_000,
      })

    const refresher = new OidcTokenRefresher({
      refresh,
      now: () => now,
      logger: { info: () => {}, warn: () => {} },
    })

    await refresher.getValidToken()
    const forced = await refresher.forceRefresh()

    expect(forced.token).toBe('token-b')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  test('refresh failure throws stable OIDC_REFRESH_FAILED code', async () => {
    const refresher = new OidcTokenRefresher({
      refresh: async () => {
        throw new Error('refresh endpoint down')
      },
      now: () => 1_000,
      logger: { info: () => {}, warn: () => {} },
    })

    await expect(refresher.getValidToken()).rejects.toMatchObject({
      errorCode: 'OIDC_REFRESH_FAILED',
    })
  })

  test('invalid payload (empty token) fails with OIDC_REFRESH_FAILED', async () => {
    const refresher = new OidcTokenRefresher({
      refresh: async () => ({
        token: '   ',
        expiresAtMs: 100_000,
      }),
      now: () => 1_000,
      logger: { info: () => {}, warn: () => {} },
    })

    await expect(refresher.getValidToken()).rejects.toBeInstanceOf(
      OidcRefreshFailedError,
    )
  })
})

describe('OIDC auth status helpers', () => {
  test('extractHttpStatus supports direct and nested response status', () => {
    expect(extractHttpStatus({ status: 401 })).toBe(401)
    expect(extractHttpStatus({ response: { status: 403 } })).toBe(403)
    expect(extractHttpStatus({ response: { status: '403' } })).toBeNull()
  })

  test('isOidcAuthError matches 401/403 only', () => {
    expect(isOidcAuthError({ status: 401 })).toBe(true)
    expect(isOidcAuthError({ response: { status: 403 } })).toBe(true)
    expect(isOidcAuthError({ status: 500 })).toBe(false)
    expect(isOidcAuthError(new Error('boom'))).toBe(false)
  })
})
