import { describe, it, expect } from 'vitest'
import { readCreditsConfig, assessReservationHold, type FullAppCreditsConfig } from '../credits'

describe('readCreditsConfig + assessReservationHold', () => {
  it('a fully default (unconfigured) credits config boots — it warns, never throws', () => {
    // Regression: the default hold is the SERVED worst case; attach() must not
    // throw against the EFFECTIVE worst case (incl. built-in Opus), or an
    // unconfigured full-app crashes at startup.
    const config = readCreditsConfig({})
    expect(config.enabled).toBe(true)
    const verdict = assessReservationHold(config, {})
    expect(verdict.action).not.toBe('throw')
    // The served-rate default sits below the effective worst case → a recoverable-
    // debt warning, not a hard stop.
    expect(verdict.action).toBe('warn')
  })

  it('throws when an EXPLICIT reservation is below the served worst case', () => {
    const config = readCreditsConfig({ BORING_CREDITS_RESERVATION_EUR: '0.000001' }) // ~1 micro
    const verdict = assessReservationHold(config, { BORING_CREDITS_RESERVATION_EUR: '0.000001' })
    expect(verdict.action).toBe('throw')
    if (verdict.action === 'throw') expect(verdict.message).toMatch(/below the SERVED worst-case/)
  })

  it('accepts an explicit sub-served hold as a soft stop when ALLOW_UNSAFE=1 (non-prod)', () => {
    const env = { BORING_CREDITS_RESERVATION_EUR: '0.000001', BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION: '1' }
    const config = readCreditsConfig(env)
    const verdict = assessReservationHold(config, env)
    expect(verdict.action).toBe('warn')
    if (verdict.action === 'warn') expect(verdict.message).toMatch(/UNSAFE per-run reservation/)
  })

  it('forbids the ALLOW_UNSAFE soft-stop override in production', () => {
    const env = {
      BORING_CREDITS_RESERVATION_EUR: '0.000001',
      BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION: '1',
      NODE_ENV: 'production',
    }
    const config = readCreditsConfig(env)
    const verdict = assessReservationHold(config, env)
    expect(verdict.action).toBe('throw')
    if (verdict.action === 'throw') expect(verdict.message).toMatch(/not allowed in production/)
  })

  it('is OK (no warning) when the hold covers the effective worst case', () => {
    const env = { BORING_CREDITS_RESERVATION_EUR: '1000' } // far above any worst case
    const config = readCreditsConfig(env)
    const verdict = assessReservationHold(config, env)
    expect(verdict.action).toBe('ok')
  })

  it('treats disabled credits as OK regardless of hold', () => {
    const env = { BORING_CREDITS_ENABLED: '0', BORING_CREDITS_RESERVATION_EUR: '0.000001' }
    const config = readCreditsConfig(env)
    const verdict = assessReservationHold(config, env)
    expect(verdict.action).toBe('ok')
  })

  it('throws when the reservation TTL is not safely above the declared max run runtime', () => {
    // TTL must exceed MAX_RUN_SECONDS + 300s slack, else the stale sweep could
    // charge-on-expire a still-alive run (overcharge).
    expect(() => readCreditsConfig({ BORING_CREDITS_RESERVATION_TTL_SECONDS: '600', BORING_CREDITS_MAX_RUN_SECONDS: '1800' }))
      .toThrow(/must exceed BORING_CREDITS_MAX_RUN_SECONDS/)
  })

  it('accepts a TTL safely above the declared max run runtime', () => {
    const config = readCreditsConfig({ BORING_CREDITS_RESERVATION_TTL_SECONDS: '2400', BORING_CREDITS_MAX_RUN_SECONDS: '1800' })
    expect(config.reservationTtlSeconds).toBe(2400)
  })

  it('does not enforce the TTL invariant when credits are disabled', () => {
    expect(() => readCreditsConfig({ BORING_CREDITS_ENABLED: '0', BORING_CREDITS_RESERVATION_TTL_SECONDS: '600', BORING_CREDITS_MAX_RUN_SECONDS: '1800' }))
      .not.toThrow()
  })

  it('kill switch (ENABLED=0) bypasses ALL credit validation — stale/malformed core AND LS env must not crash startup', () => {
    // Malformed CORE money/rate env (rates, margin, reservation, TTL) AND LS env
    // (webhook secret without store id, garbage mode/variants) — none of it should
    // fail startup when credits are disabled.
    let config!: FullAppCreditsConfig
    expect(() => {
      config = readCreditsConfig({
        BORING_CREDITS_ENABLED: '0',
        BORING_CREDITS_RATES: 'totally::garbage::not-a-rate',
        BORING_CREDITS_MARGIN: '0.1', // < 1 would throw when enabled
        BORING_CREDITS_RESERVATION_EUR: 'NaN',
        BORING_CREDITS_RESERVATION_TTL_SECONDS: '10', // below max-run+slack: would throw when enabled
        BORING_CREDITS_LS_WEBHOOK_SECRET: 'whsec_stale',
        BORING_CREDITS_LS_TEST_MODE: 'garbage',
        BORING_CREDITS_LS_VARIANTS: 'not-a-valid-spec',
        NODE_ENV: 'production',
      })
    }).not.toThrow()
    expect(config.enabled).toBe(false)
    expect(config.lemonSqueezyWebhookSecret).toBeUndefined()
    expect(config.lemonSqueezyCheckout).toBeUndefined()
  })

  it('STILL enforces the same LS gates when credits are enabled (webhook secret needs a store id)', () => {
    expect(() => readCreditsConfig({ BORING_CREDITS_LS_WEBHOOK_SECRET: 'whsec_x' }))
      .toThrow(/BORING_CREDITS_LS_STORE_ID is required/)
  })

  it('rejects an expiring signup grant config at parse time downstream (config carries it through)', () => {
    // readCreditsConfig parses the value; CreditsService construction is what
    // rejects it. Here we just confirm the parsed config surfaces the days so the
    // downstream guard can reject it.
    const config = readCreditsConfig({ BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS: '30' })
    expect(config.signupGrantExpiresAfterDays).toBe(30)
  })

  it('consumption-only deploy (no webhook secret / API key) ignores stale LS env without crashing', () => {
    // Metering on, purchases off: a leftover malformed LS_VARIANTS / bad TEST_MODE
    // must not fail startup, and LS fields are inert.
    let config!: FullAppCreditsConfig
    expect(() => {
      config = readCreditsConfig({
        BORING_CREDITS_LS_VARIANTS: 'garbage-not-a-spec',
        BORING_CREDITS_LS_DEFAULT_PACK: 'nope',
        BORING_CREDITS_LS_TEST_MODE: 'maybe',
      })
    }).not.toThrow()
    expect(config.enabled).toBe(true)
    expect(config.lemonSqueezyWebhookSecret).toBeUndefined()
    expect(config.lemonSqueezyVariants).toEqual({})
    expect(config.lemonSqueezyCheckout).toBeUndefined()
  })

  it('default signup grant admits a first run out of the box (grant >= hold + floor)', () => {
    const config = readCreditsConfig({})
    expect(config.signupGrantMicros).toBeGreaterThanOrEqual(config.runReservationMicros + config.minBalanceMicros)
  })

  it('respects an explicit signup grant even if below the hold (operator choice)', () => {
    const config = readCreditsConfig({ BORING_CREDITS_SIGNUP_GRANT_EUR: '0.5' })
    expect(config.signupGrantMicros).toBe(500_000)
  })

  it('keeps the default grant at €2 when the served hold is small (configured cheap rates)', () => {
    const config = readCreditsConfig({ BORING_CREDITS_RATES: 'infomaniak=0.5:1.5', BORING_CREDITS_RESERVATION_EUR: '0.5' })
    expect(config.signupGrantMicros).toBe(2_000_000)
  })

  it('parses a well-formed BORING_CREDITS_RATES entry', () => {
    const config = readCreditsConfig({ BORING_CREDITS_RATES: 'infomaniak=0.5:1.5' })
    expect(config.pricing.rates).toEqual([[/infomaniak/i, { inputPerMillion: 0.5, outputPerMillion: 1.5 }]])
  })

  it('fail-closes on malformed BORING_CREDITS_RATES (extra price field would silently truncate)', () => {
    expect(() => readCreditsConfig({ BORING_CREDITS_RATES: 'model=0.5:1.5:75' })).toThrow(/exactly two ":"-separated prices/)
  })

  it('fail-closes on malformed BORING_CREDITS_RATES (extra "=" would silently truncate)', () => {
    expect(() => readCreditsConfig({ BORING_CREDITS_RATES: 'model=0.5:1.5=oops' })).toThrow(/exactly one "="/)
  })

  it('fail-closes on a non-empty BORING_CREDITS_RATES that yields no entries', () => {
    expect(() => readCreditsConfig({ BORING_CREDITS_RATES: ';;;' })).toThrow(/no valid entries parsed/)
  })
})
