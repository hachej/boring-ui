import { describe, expect, test } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker'
import { OidcRefreshFailedError, isOidcAuthError } from '../oidcRefresh'

describe('CircuitBreaker', () => {
  test('opens after 5 consecutive failures', async () => {
    const breaker = new CircuitBreaker({
      sleep: async () => {},
    })
    const operation = async () => {
      throw new Error('upstream failed')
    }

    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.execute(operation)).rejects.toThrow('upstream failed')
    }

    expect(breaker.getState()).toBe('open')
  })

  test('open state fails fast without invoking operation', async () => {
    const breaker = new CircuitBreaker({
      sleep: async () => {},
    })
    const failing = async () => {
      throw new Error('failing')
    }

    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.execute(failing)).rejects.toThrow('failing')
    }
    expect(breaker.getState()).toBe('open')

    let called = 0
    await expect(
      breaker.execute(async () => {
        called += 1
        return 'ok'
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError)
    expect(called).toBe(0)
  })

  test('half-open trial success closes the circuit', async () => {
    let nowMs = 0
    const breaker = new CircuitBreaker({
      now: () => nowMs,
      sleep: async () => {},
      openDurationMs: 30_000,
    })
    const failing = async () => {
      throw new Error('failing')
    }

    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.execute(failing)).rejects.toThrow('failing')
    }
    expect(breaker.getState()).toBe('open')

    nowMs += 30_001

    let attempts = 0
    await expect(
      breaker.execute(async () => {
        attempts += 1
        return 'ok'
      }),
    ).resolves.toBe('ok')

    expect(attempts).toBe(1)
    expect(breaker.getState()).toBe('closed')
  })

  test('opens when failure rate is 50% over 20 requests', async () => {
    let nowMs = 0
    const breaker = new CircuitBreaker({
      now: () => nowMs,
      sleep: async () => {},
      minRequestCount: 20,
      failureRateThreshold: 0.5,
      consecutiveFailuresToOpen: 99,
    })

    for (let i = 0; i < 9; i += 1) {
      await expect(
        breaker.execute(async () => {
          throw new Error(`fail-${i}`)
        }),
      ).rejects.toThrow(`fail-${i}`)
      nowMs += 1
      await expect(breaker.execute(async () => `ok-${i}`)).resolves.toBe(`ok-${i}`)
      nowMs += 1
    }
    await expect(breaker.execute(async () => 'ok-9')).resolves.toBe('ok-9')
    nowMs += 1
    await expect(
      breaker.execute(async () => {
        throw new Error('fail-9')
      }),
    ).rejects.toThrow('fail-9')

    expect(breaker.getState()).toBe('open')
  })

  test('retries with exponential backoff 100/400/1600 then gives up', async () => {
    const sleeps: number[] = []
    const breaker = new CircuitBreaker({
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    let attempts = 0
    await expect(
      breaker.execute(async () => {
        attempts += 1
        throw new Error('still failing')
      }),
    ).rejects.toThrow('still failing')

    expect(attempts).toBe(4)
    expect(sleeps).toEqual([100, 400, 1_600])
  })

  test('401/403 triggers OIDC refresh once and retries operation', async () => {
    let attempts = 0
    let refreshCalls = 0
    const breaker = new CircuitBreaker({
      sleep: async () => {},
      isAuthError: isOidcAuthError,
      onAuthError: async () => {
        refreshCalls += 1
      },
    })

    const result = await breaker.execute(async () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('Unauthorized') as Error & { status: number }
        error.status = 401
        throw error
      }
      return 'ok-after-refresh'
    })

    expect(result).toBe('ok-after-refresh')
    expect(attempts).toBe(2)
    expect(refreshCalls).toBe(1)
  })

  test('failed OIDC refresh surfaces stable OIDC_REFRESH_FAILED code', async () => {
    const breaker = new CircuitBreaker({
      sleep: async () => {},
      isAuthError: isOidcAuthError,
      onAuthError: async () => {
        throw new OidcRefreshFailedError()
      },
    })

    await expect(
      breaker.execute(async () => {
        const error = new Error('Unauthorized') as Error & {
          response: { status: number }
        }
        error.response = { status: 403 }
        throw error
      }),
    ).rejects.toMatchObject({
      errorCode: 'OIDC_REFRESH_FAILED',
    })
  })

  test('half-open mode allows one retry after successful auth recovery', async () => {
    let nowMs = 0
    let attempts = 0
    let refreshCalls = 0
    const breaker = new CircuitBreaker({
      now: () => nowMs,
      sleep: async () => {},
      openDurationMs: 30_000,
      isAuthError: isOidcAuthError,
      onAuthError: async () => {
        refreshCalls += 1
      },
    })

    const failing = async () => {
      throw new Error('failing')
    }

    for (let i = 0; i < 5; i += 1) {
      await expect(breaker.execute(failing)).rejects.toThrow('failing')
    }
    expect(breaker.getState()).toBe('open')

    nowMs += 30_001

    const result = await breaker.execute(async () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('Unauthorized') as Error & { status: number }
        error.status = 401
        throw error
      }
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(refreshCalls).toBe(1)
    expect(attempts).toBe(2)
    expect(breaker.getState()).toBe('closed')
  })
})
