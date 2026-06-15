import {
  CreditsService,
  PostgresMeteringStore,
  createCreditsMeteringSink,
  registerCreditsRoutes,
  maxServedRate,
  maxEffectiveRate,
  type CreditsConfig,
  type CreditPricingConfig,
} from '@hachej/boring-core/server'
import type { AgentMeteringSink } from '@hachej/boring-agent/server'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

const CREDIT_MICROS_PER_EUR = 1_000_000 // 1 credit = €0.000001

/** EUR env → credit micros. Money config is a trust boundary: a provided value
 * that isn't a finite non-negative number THROWS (a typo must not silently
 * collapse to the fallback). Fallback applies only when unset/empty. */
function eurToMicros(name: string, value: string | undefined, fallbackEur: number): number {
  if (value === undefined || value === '') return Math.round(fallbackEur * CREDIT_MICROS_PER_EUR)
  const eur = Number(value)
  if (!Number.isFinite(eur) || eur < 0) {
    throw new Error(`invalid ${name}: expected a non-negative EUR amount, got "${value}"`)
  }
  return Math.round(eur * CREDIT_MICROS_PER_EUR)
}

/** Parse a provided numeric money env strictly; fallback only when unset/empty.
 * `integer` requires a whole number (for discrete counts like tokens/calls). */
function parseNumberEnv(name: string, value: string | undefined, fallback: number, min: number, integer = false): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new Error(`invalid ${name}: expected ${integer ? 'an integer' : 'a number'} >= ${min}, got "${value}"`)
  }
  return n
}

/** Parse "10:var_abc,25:var_def,50:var_ghi" → { '10': 'var_abc', ... }. The pack
 * id is the EUR credit VALUE the pack grants (so it drives crediting, not the
 * order amount). Throws on a malformed/empty/duplicate/non-positive-amount entry
 * so checkout & webhook can't silently diverge from the intended packs. */
function parseVariants(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim() === '') return {}
  const out: Record<string, string> = {}
  const seenVariants = new Set<string>()
  for (const pair of raw.split(',')) {
    if (pair.trim() === '') continue
    const parts = pair.split(':').map((s) => s.trim())
    const [pack, variant] = parts
    if (parts.length !== 2 || !pack || !variant) {
      throw new Error(`invalid BORING_CREDITS_LS_VARIANTS entry (expected exactly "creditEur:variantId"): "${pair}"`)
    }
    if (!Number.isFinite(Number(pack)) || Number(pack) <= 0) {
      throw new Error(`invalid BORING_CREDITS_LS_VARIANTS pack id (must be a positive EUR credit value): "${pack}"`)
    }
    // LS variant ids are positive integers; require it so the checkout's
    // enabled_variants lock is always effective.
    if (!/^[0-9]+$/.test(variant) || Number(variant) <= 0) {
      throw new Error(`invalid BORING_CREDITS_LS_VARIANTS variant id (must be a positive integer Lemon Squeezy id): "${variant}"`)
    }
    if (pack in out) throw new Error(`duplicate pack id in BORING_CREDITS_LS_VARIANTS: "${pack}"`)
    // Reject a variant id reused across packs — it would make one variant credit
    // an ambiguous amount (the last pack to map to it would win).
    if (seenVariants.has(variant)) throw new Error(`duplicate variant id in BORING_CREDITS_LS_VARIANTS: "${variant}"`)
    seenVariants.add(variant)
    out[pack] = variant
  }
  return out
}

const STRIPE_CUSTOM_PACK_ID = 'custom'

/** Parse "5:price_x,10:price_y" → { '5': 'price_x', ... } for Stripe. Pack id is the
 * major-unit price (= EUR credit value granted); the value is a Stripe Price id. Throws
 * on malformed/duplicate/non-positive entries so checkout & webhook can't diverge. */
function parseStripeVariants(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim() === '') return {}
  const out: Record<string, string> = {}
  const seenPrices = new Set<string>()
  for (const pair of raw.split(',')) {
    if (pair.trim() === '') continue
    const parts = pair.split(':').map((s) => s.trim())
    const [pack, priceId] = parts
    if (parts.length !== 2 || !pack || !priceId) {
      throw new Error(`invalid BORING_CREDITS_STRIPE_VARIANTS entry (expected "creditEur:priceId"): "${pair}"`)
    }
    if (!Number.isFinite(Number(pack)) || Number(pack) <= 0) {
      throw new Error(`invalid BORING_CREDITS_STRIPE_VARIANTS pack id (must be a positive EUR credit value): "${pack}"`)
    }
    if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
      throw new Error(`invalid BORING_CREDITS_STRIPE_VARIANTS price id (must look like "price_…"): "${priceId}"`)
    }
    if (pack in out) throw new Error(`duplicate pack id in BORING_CREDITS_STRIPE_VARIANTS: "${pack}"`)
    if (pack === STRIPE_CUSTOM_PACK_ID) throw new Error(`BORING_CREDITS_STRIPE_VARIANTS pack id "${STRIPE_CUSTOM_PACK_ID}" is reserved for the custom pay-what-you-want pack`)
    if (seenPrices.has(priceId)) throw new Error(`duplicate price id in BORING_CREDITS_STRIPE_VARIANTS: "${priceId}"`)
    seenPrices.add(priceId)
    out[pack] = priceId
  }
  return out
}

/** Build the Stripe route wiring from env, or undefined when Stripe isn't configured.
 * Configured = a secret key or webhook secret is present (mirrors the LS gate). */
function readStripeRouteConfig(env: NodeJS.ProcessEnv): {
  webhookSecret?: string
  attributionSecret?: string | readonly string[]
  expectedTestMode: boolean
  requireCurrency: string
  creditOnlyStore: boolean
  creditMicrosByPack: Record<string, number>
  customPack?: { id: string; minMinor: number }
  checkout?: { apiKey: string; variants: Record<string, string>; defaultPack: string; customPriceId?: string; redirectUrl?: string }
} | undefined {
  const apiKey = env.BORING_CREDITS_STRIPE_SECRET_KEY || undefined
  const webhookSecret = env.BORING_CREDITS_STRIPE_WEBHOOK_SECRET || undefined
  if (!apiKey && !webhookSecret) return undefined

  // Mode MUST be explicit when Stripe is configured (no silent prod-defaults-to-test).
  const tmRaw = env.BORING_CREDITS_STRIPE_TEST_MODE
  if (tmRaw !== '0' && tmRaw !== '1') {
    throw new Error(`BORING_CREDITS_STRIPE_TEST_MODE must be explicitly "0" (live) or "1" (test) when Stripe is configured; got "${tmRaw ?? ''}"`)
  }
  const testMode = tmRaw === '1'
  // Test-mode purchases mint real spendable credits — never allow in production.
  if (env.NODE_ENV === 'production' && testMode) {
    throw new Error('credits: BORING_CREDITS_STRIPE_TEST_MODE=1 in production mints non-charging but spendable credits — set it to 0 and purge any test grants before live cutover')
  }
  // The key's own mode determines the session livemode, which the webhook gates on. A
  // key/mode disagreement would create sessions the webhook then drops as not-our-mode
  // (paid, never credited). Require the sk_/rk_ test/live prefix to match testMode.
  if (apiKey) {
    const keyIsTest = /^(sk|rk)_test_/.test(apiKey)
    const keyIsLive = /^(sk|rk)_live_/.test(apiKey)
    if (keyIsTest && !testMode) throw new Error('credits: BORING_CREDITS_STRIPE_SECRET_KEY is a TEST key but BORING_CREDITS_STRIPE_TEST_MODE=0 — checkouts would be test-mode but the webhook expects live, so paid orders would not be credited')
    if (keyIsLive && testMode) throw new Error('credits: BORING_CREDITS_STRIPE_SECRET_KEY is a LIVE key but BORING_CREDITS_STRIPE_TEST_MODE=1 — checkouts would be live but the webhook expects test, so paid orders would not be credited')
  }
  const variants = parseStripeVariants(env.BORING_CREDITS_STRIPE_VARIANTS)
  const creditMicrosByPack: Record<string, number> = {}
  for (const packId of Object.keys(variants)) {
    const micros = Math.round(Number(packId) * CREDIT_MICROS_PER_EUR)
    if (!Number.isSafeInteger(micros) || micros <= 0) {
      throw new Error(`BORING_CREDITS_STRIPE_VARIANTS pack "${packId}" maps to a non-positive credit amount`)
    }
    creditMicrosByPack[packId] = micros
  }
  const customPrice = env.BORING_CREDITS_STRIPE_CUSTOM_PRICE || undefined
  if (customPrice && !/^price_[A-Za-z0-9]+$/.test(customPrice)) {
    throw new Error(`invalid BORING_CREDITS_STRIPE_CUSTOM_PRICE (must look like "price_…"): "${customPrice}"`)
  }
  const customPack = customPrice
    ? { id: STRIPE_CUSTOM_PACK_ID, minMinor: parseNumberEnv('BORING_CREDITS_STRIPE_CUSTOM_MIN_MINOR', env.BORING_CREDITS_STRIPE_CUSTOM_MIN_MINOR, 50, 1, true) }
    : undefined
  // Validate the default AFTER the custom pack is known: it may be a fixed pack OR the
  // reserved custom id (a custom-only deployment can default to "custom").
  const defaultPackEnv = env.BORING_CREDITS_STRIPE_DEFAULT_PACK
  if (defaultPackEnv && !(defaultPackEnv in variants) && !(customPack && defaultPackEnv === STRIPE_CUSTOM_PACK_ID)) {
    throw new Error(`BORING_CREDITS_STRIPE_DEFAULT_PACK "${defaultPackEnv}" is not a configured pack in BORING_CREDITS_STRIPE_VARIANTS (or the custom pack)`)
  }
  const checkoutReady = Boolean(apiKey && (Object.keys(variants).length > 0 || customPack))
  // Dedicated attribution secret(s), decoupled from the webhook secret so rotating the
  // webhook secret doesn't invalidate in-flight checkout uat tokens. [current, ...previous].
  const attrCurrent = env.BORING_CREDITS_STRIPE_ATTRIBUTION_SECRET || undefined
  const attrPrevious = (env.BORING_CREDITS_STRIPE_ATTRIBUTION_SECRET_PREVIOUS || '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const attributionSecret = attrCurrent ? [attrCurrent, ...attrPrevious] : undefined
  return {
    webhookSecret,
    attributionSecret,
    expectedTestMode: testMode,
    requireCurrency: env.BORING_CREDITS_STRIPE_CURRENCY || 'EUR',
    creditOnlyStore: env.BORING_CREDITS_STRIPE_CREDIT_ONLY_STORE !== '0',
    creditMicrosByPack,
    // Custom-pack WEBHOOK policy (top-level): recognized even if checkout is unconfigured.
    customPack,
    checkout: checkoutReady
      ? {
          apiKey: apiKey!,
          variants,
          defaultPack: defaultPackEnv || Object.keys(variants)[0] || STRIPE_CUSTOM_PACK_ID,
          customPriceId: customPrice,
          redirectUrl: env.BORING_CREDITS_STRIPE_REDIRECT_URL || undefined,
        }
      : undefined,
  }
}

/** Parse the LS test/live mode. When LS is configured the value MUST be an
 * explicit "0" (live) or "1" (test); an unset/other value throws so production
 * can't silently default to test mode. */
function parseTestMode(value: string | undefined, lsConfigured: boolean): boolean {
  if (value === '1') return true
  if (value === '0') return false
  if (!lsConfigured && (value === undefined || value === '')) return true
  throw new Error(
    `BORING_CREDITS_LS_TEST_MODE must be explicitly "0" (live) or "1" (test) when Lemon Squeezy is configured; got "${value ?? ''}"`,
  )
}

/** Strictly parse the signup-grant expiry env: 0/unset ⇒ never expires; a
 * provided value must be a positive integer day count (no silent fall-open). */
function parseExpiryDays(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === '0') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`invalid BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS: expected a positive integer or 0, got "${value}"`)
  }
  return n
}

/**
 * Parse "regex=in:out;regex=in:out" → model rate table (EUR / MTok). Money
 * config is a trust boundary: a malformed or non-positive entry THROWS at
 * startup rather than being silently skipped (which would let the matching
 * model bill at €0 — free production usage) — fail closed, never fall open.
 */
function parseRates(raw: string | undefined): Array<[RegExp, { inputPerMillion: number; outputPerMillion: number }]> | undefined {
  if (!raw || raw.trim() === '') return undefined
  const rates: Array<[RegExp, { inputPerMillion: number; outputPerMillion: number }]> = []
  for (const entry of raw.split(';')) {
    if (entry.trim() === '') continue
    // Exact arity, fail-closed: a typo like `model=0.5:1.5:75` or `model=0.5=oops`
    // must NOT silently truncate (which could underprice). Require exactly one `=`
    // and exactly two `:`-separated price fields.
    const eq = entry.split('=')
    if (eq.length !== 2) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (expected exactly one "=" as pattern=in:out): "${entry}"`)
    }
    const [pattern, prices] = eq
    if (!pattern || !pattern.trim()) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (missing pattern): "${entry}"`)
    }
    const priceParts = prices.split(':')
    if (priceParts.length !== 2) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (expected exactly two ":"-separated prices in:out): "${entry}"`)
    }
    const [input, output] = priceParts.map(Number)
    if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (rates must be positive EUR/MTok): "${entry}"`)
    }
    try {
      rates.push([new RegExp(pattern.trim(), 'i'), { inputPerMillion: input, outputPerMillion: output }])
    } catch {
      throw new Error(`invalid BORING_CREDITS_RATES entry (bad regex): "${entry}"`)
    }
  }
  // A non-empty raw that yielded no entries (e.g. ";;;") is malformed — fail closed
  // rather than silently disabling rate config.
  if (rates.length === 0) {
    throw new Error(`invalid BORING_CREDITS_RATES (no valid entries parsed): "${raw}"`)
  }
  return rates
}

export interface FullAppCreditsConfig extends CreditsConfig {
  /** Background stale-reservation sweep cadence (seconds). */
  sweepIntervalSeconds: number
  lemonSqueezyWebhookSecret?: string
  /** Pack id (EUR credit value) → LS variant id. Webhook only credits these variants. */
  lemonSqueezyVariants: Record<string, string>
  /** LS variant id → fixed credit micros granted for that pack (immune to order
   * amount/discount/tax). Derived from the pack id (EUR) × creditMicrosPerUnit. */
  lemonSqueezyCreditMicrosByVariant: Record<string, number>
  /** Expected LS mode (true = test, false = live). Default test. */
  lemonSqueezyTestMode: boolean
  /** Expected LS store id; the webhook ignores orders from another store. */
  lemonSqueezyStoreId?: string
  /** Attribution signing/verify secret(s) for checkout `uat`, decoupled from the
   * webhook secret. [current, ...previous] for rotation grace. Undefined ⇒ the route
   * defaults to the webhook secret. */
  lemonSqueezyAttributionSecrets?: readonly string[]
  /** Whether the LS store sells ONLY credit packs (default true). True ⇒ an
   * unknown-variant paid order on our store is a pack misconfig (retryable 500);
   * false (a mixed store) ⇒ it's a different product and is 200-ignored. */
  lemonSqueezyCreditOnlyStore: boolean
  lemonSqueezyCheckout?: {
    apiKey: string
    storeId: string
    variants: Record<string, string>
    defaultPack: string
    redirectUrl?: string
    testMode: boolean
  }
}

/**
 * Conservative worst-case RUN cost (credit micros) for sizing the per-run hold.
 * A single Pi prompt can make several model calls (tool loop) before any debit
 * posts, each priced at the priciest SERVED rate (maxServedRate — configured
 * rates + the conservative default, NOT the built-in DEFAULT_MODEL_RATES) over
 * the max context+output, with margin, × BORING_CREDITS_MAX_CALLS_PER_RUN. Using
 * served rates (not the built-in Opus default) keeps the hold proportional to the
 * models this deployment actually serves so a small starter grant stays usable;
 * an unconfigured/unreachable expensive model would overshoot the hold (bounded;
 * the user's NEXT run is then refused). Billing an unmatched model still fails
 * closed high (maxEffectiveRate).
 */
function worstCaseRunMicros(pricing: CreditPricingConfig, env: NodeJS.ProcessEnv, rate: { inputPerMillion: number; outputPerMillion: number }): number {
  const maxContext = parseNumberEnv('BORING_CREDITS_MAX_CONTEXT_TOKENS', env.BORING_CREDITS_MAX_CONTEXT_TOKENS, 200_000, 1, true)
  const maxOutput = parseNumberEnv('BORING_CREDITS_MAX_OUTPUT_TOKENS', env.BORING_CREDITS_MAX_OUTPUT_TOKENS, 16_384, 1, true)
  const maxCalls = parseNumberEnv('BORING_CREDITS_MAX_CALLS_PER_RUN', env.BORING_CREDITS_MAX_CALLS_PER_RUN, 4, 1, true)
  const unitsPerCall = (maxContext / 1_000_000) * rate.inputPerMillion + (maxOutput / 1_000_000) * rate.outputPerMillion
  return Math.ceil(unitsPerCall * maxCalls * pricing.margin * pricing.creditMicrosPerUnit)
}

export type ReservationHoldVerdict =
  | { action: 'ok' }
  | { action: 'throw'; message: string }
  | { action: 'warn'; message: string; fields: Record<string, number> }

/**
 * Decide whether the configured per-run hold is acceptable, against two thresholds:
 *  - SERVED worst case (`maxServedRate`): the hold MUST cover a worst-case run on the
 *    models this deployment serves. Below it, even a normal run overshoots → fatal
 *    (`throw`) unless `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1` (a soft-stop
 *    opt-in, forbidden in production). Only reachable with an explicit too-low
 *    `BORING_CREDITS_RESERVATION_EUR` — the UNSET default IS the served worst case.
 *  - EFFECTIVE worst case (`maxEffectiveRate`, incl. the built-in Opus rate an
 *    UNMATCHED/misrouted model bills at): the served-rate default sits below it, so a
 *    misrouted expensive run overshoots into recoverable debt (bounded; next run
 *    refused). That's a documented accepted limitation → `warn`, never block (else the
 *    recommended default could not boot).
 * Pure (no app/db), so the default-config "must not crash startup" path is unit-testable.
 */
export function assessReservationHold(config: FullAppCreditsConfig, env: NodeJS.ProcessEnv = process.env): ReservationHoldVerdict {
  if (!config.enabled) return { action: 'ok' }
  const servedWorstCase = worstCaseRunMicros(config.pricing, env, maxServedRate(config.pricing))
  const effectiveWorstCase = worstCaseRunMicros(config.pricing, env, maxEffectiveRate(config.pricing))
  const hold = config.runReservationMicros
  const unsafeAllowed = env.BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION === '1'
  if (hold < servedWorstCase) {
    if (unsafeAllowed && env.NODE_ENV === 'production') {
      return { action: 'throw', message: 'credits: BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1 is not allowed in production — raise BORING_CREDITS_RESERVATION_EUR to cover at least the served worst-case run (or restrict served models)' }
    }
    if (unsafeAllowed) {
      return {
        action: 'warn',
        message: 'credits: UNSAFE per-run reservation (below the SERVED worst-case run) explicitly allowed — even a normal run can overshoot the hold (bounded; next run refused). Launch-blocking debt.',
        fields: { runReservationMicros: hold, servedWorstCaseMicros: servedWorstCase },
      }
    }
    return {
      action: 'throw',
      message:
        `credits: per-run reservation (${hold} micros) is below the SERVED worst-case run cost ` +
        `(${servedWorstCase} micros) — even a normal run would not hold. Raise BORING_CREDITS_RESERVATION_EUR (or ` +
        `lower BORING_CREDITS_MAX_CONTEXT_TOKENS/_MAX_OUTPUT_TOKENS/_MAX_CALLS_PER_RUN), or set ` +
        `BORING_CREDITS_ALLOW_UNSAFE_LOW_RESERVATION=1 to accept the soft stop deliberately.`,
    }
  }
  if (hold < effectiveWorstCase) {
    return {
      action: 'warn',
      message: 'credits: per-run hold covers the served models but not an unmatched/misrouted expensive model (e.g. Opus) — such a run can overshoot the hold into recoverable debt (bounded; next run refused). Restrict served models or raise BORING_CREDITS_RESERVATION_EUR for a hard stop on unknown models.',
      fields: { runReservationMicros: hold, servedWorstCaseMicros: servedWorstCase, effectiveWorstCaseMicros: effectiveWorstCase },
    }
  }
  return { action: 'ok' }
}

export function readCreditsConfig(env: NodeJS.ProcessEnv = process.env): FullAppCreditsConfig {
  const enabled = env.BORING_CREDITS_ENABLED !== '0'

  // BORING_CREDITS_ENABLED=0 is a full emergency kill switch — it must boot through
  // ANY stale/malformed credit env (rates, margin, reservation, TTL, LS). Return an
  // inert default config WITHOUT parsing/validating any credit env. The service is
  // still constructed (its constructor skips validation when disabled) and every
  // method short-circuits, so these values are never read.
  if (!enabled) {
    return {
      enabled: false,
      signupGrantMicros: 0,
      signupGrantExpiresAfterDays: null,
      runReservationMicros: 1,
      reservationTtlSeconds: 60,
      minBalanceMicros: 0,
      sweepIntervalSeconds: 300,
      pricing: { margin: 1, creditMicrosPerUnit: CREDIT_MICROS_PER_EUR, rates: [] },
      lemonSqueezyWebhookSecret: undefined,
      lemonSqueezyVariants: {},
      lemonSqueezyCreditMicrosByVariant: {},
      lemonSqueezyTestMode: false,
      lemonSqueezyStoreId: undefined,
      lemonSqueezyCreditOnlyStore: true,
      lemonSqueezyCheckout: undefined,
    }
  }

  // --- Core config (enabled only). ---
  // Margin < 1 would bill below provider cost — reject it (fail closed).
  const margin = parseNumberEnv('BORING_CREDITS_MARGIN', env.BORING_CREDITS_MARGIN, 1.3, 1)
  // Verified per-model EUR/MTok rates (e.g. Infomaniak). Unset ⇒ unconfigured
  // models bill at the conservative default (over-charge, never free).
  const rates = parseRates(env.BORING_CREDITS_RATES)
  // The per-run hold defaults to the SERVED-rate worst case (proportional to the
  // models this deployment serves, so a small starter grant stays usable). attach()
  // hard-throws only if the hold can't cover the SERVED worst case (an explicit
  // too-low value), and merely WARNS if it covers the served but not the effective
  // (unmatched/misrouted) worst case — so this recommended default boots cleanly.
  const pricingForHold: CreditPricingConfig = { margin, creditMicrosPerUnit: CREDIT_MICROS_PER_EUR, rates }
  const servedWorstCase = worstCaseRunMicros(pricingForHold, env, maxServedRate(pricingForHold))
  const runReservationMicros = env.BORING_CREDITS_RESERVATION_EUR
    ? eurToMicros('BORING_CREDITS_RESERVATION_EUR', env.BORING_CREDITS_RESERVATION_EUR, 1)
    : servedWorstCase
  // The stale-reservation sweep charges-on-expire any reservation past TTL that has
  // usage rows (treating it as a run that executed but never settled). If the TTL
  // could elapse while a run is STILL alive, that charge-on-expire plus the run's
  // later usage would overcharge. Enforce the invariant (rather than leave it to
  // operator folklore): TTL must exceed the declared max run runtime + a settlement
  // slack, so a still-running run can never be old enough to be swept.
  const reservationTtlSeconds = Math.max(60, parseNumberEnv('BORING_CREDITS_RESERVATION_TTL_SECONDS', env.BORING_CREDITS_RESERVATION_TTL_SECONDS, 7200, 60))
  const maxRunSeconds = parseNumberEnv('BORING_CREDITS_MAX_RUN_SECONDS', env.BORING_CREDITS_MAX_RUN_SECONDS, 1800, 1, true)
  const SETTLEMENT_SLACK_SECONDS = 300
  if (reservationTtlSeconds < maxRunSeconds + SETTLEMENT_SLACK_SECONDS) {
    throw new Error(
      `credits: BORING_CREDITS_RESERVATION_TTL_SECONDS (${reservationTtlSeconds}) must exceed BORING_CREDITS_MAX_RUN_SECONDS ` +
        `(${maxRunSeconds}) by at least ${SETTLEMENT_SLACK_SECONDS}s of settlement slack — otherwise the stale-reservation ` +
        `sweep could charge-on-expire a run that is still alive (overcharge). Raise the TTL or lower the declared max run runtime.`,
    )
  }
  const minBalanceMicros = eurToMicros('BORING_CREDITS_MIN_BALANCE_EUR', env.BORING_CREDITS_MIN_BALANCE_EUR, 0.05)
  // Background stale-reservation sweep cadence. The per-user expiry in reserve()
  // covers active users; this sweeper charges-on-expire the marked reservations of
  // users who don't return, so a durable fallback charge whose write failed isn't
  // lost. Off the request path (no cross-user coupling). Default 5 min.
  const sweepIntervalSeconds = Math.max(30, parseNumberEnv('BORING_CREDITS_SWEEP_INTERVAL_SECONDS', env.BORING_CREDITS_SWEEP_INTERVAL_SECONDS, 300, 30))
  // Default the signup grant so a FRESH user can start their first run out of the box.
  // reserveRun admits a run only when available ≥ hold + floor, so an UNSET grant
  // defaults to max(€2, hold + floor). Without this, an unconfigured/dev deploy (high
  // served-rate floor → ~€4 hold) would 402 every first run with no in-app way to buy.
  // An EXPLICIT BORING_CREDITS_SIGNUP_GRANT_EUR is respected as-is (attach() still warns
  // if an explicit grant is below the hold). A configured deploy with cheap rates has a
  // low hold, so this stays at €2.
  const defaultSignupGrantMicros = Math.max(2 * CREDIT_MICROS_PER_EUR, runReservationMicros + minBalanceMicros)
  const signupGrantMicros = env.BORING_CREDITS_SIGNUP_GRANT_EUR
    ? eurToMicros('BORING_CREDITS_SIGNUP_GRANT_EUR', env.BORING_CREDITS_SIGNUP_GRANT_EUR, 2)
    : defaultSignupGrantMicros
  const common = {
    enabled,
    signupGrantMicros,
    signupGrantExpiresAfterDays: parseExpiryDays(env.BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS),
    runReservationMicros,
    reservationTtlSeconds,
    minBalanceMicros,
    sweepIntervalSeconds,
    pricing: { margin, creditMicrosPerUnit: CREDIT_MICROS_PER_EUR, rates },
  }

  // --- Lemon Squeezy purchase config (enabled only; disabled returned inert above).
  // Only parse/validate LS env when Lemon Squeezy is actually configured (a webhook
  // secret or API key is present). A consumption-only deployment (metering on, no
  // purchases) must not crash on stale BORING_CREDITS_LS_VARIANTS / _DEFAULT_PACK /
  // malformed _TEST_MODE — return inert LS fields. ---
  const lsConfigured = Boolean(env.BORING_CREDITS_LS_WEBHOOK_SECRET || env.BORING_CREDITS_LS_API_KEY)
  if (!lsConfigured) {
    return {
      ...common,
      lemonSqueezyWebhookSecret: undefined,
      lemonSqueezyVariants: {},
      lemonSqueezyCreditMicrosByVariant: {},
      lemonSqueezyTestMode: false,
      lemonSqueezyStoreId: undefined,
      lemonSqueezyCreditOnlyStore: true,
      lemonSqueezyAttributionSecrets: undefined,
      lemonSqueezyCheckout: undefined,
    }
  }
  const variants = parseVariants(env.BORING_CREDITS_LS_VARIANTS)
  const defaultPackEnv = env.BORING_CREDITS_LS_DEFAULT_PACK
  if (defaultPackEnv && !(defaultPackEnv in variants)) {
    throw new Error(`BORING_CREDITS_LS_DEFAULT_PACK "${defaultPackEnv}" is not a configured pack in BORING_CREDITS_LS_VARIANTS`)
  }
  // variant id → fixed credit micros (pack id is the EUR credit value).
  const creditMicrosByVariant: Record<string, number> = {}
  for (const [packEur, variantId] of Object.entries(variants)) {
    const micros = Math.round(Number(packEur) * CREDIT_MICROS_PER_EUR)
    if (!Number.isSafeInteger(micros) || micros <= 0) {
      throw new Error(`BORING_CREDITS_LS_VARIANTS pack "${packEur}" maps to a non-positive credit amount`)
    }
    creditMicrosByVariant[variantId] = micros
  }
  // The webhook must know which store its orders belong to — otherwise any
  // signed order in the right mode/currency/variant credits, with no store gate.
  if (env.BORING_CREDITS_LS_WEBHOOK_SECRET && !env.BORING_CREDITS_LS_STORE_ID) {
    throw new Error('BORING_CREDITS_LS_STORE_ID is required when BORING_CREDITS_LS_WEBHOOK_SECRET is set (the webhook must validate the order store)')
  }
  // LS is configured here (we returned inert above otherwise). The test/live mode
  // MUST be explicit — a wrong default would either mint credits from non-charging
  // test orders or reject real live webhooks. Require an exact "0" (live) or "1".
  const testMode = parseTestMode(env.BORING_CREDITS_LS_TEST_MODE, true)
  // Launch gate: test-mode Lemon Squeezy checkouts are non-charging but still mint
  // real, spendable credits (the balance isn't mode-scoped). They must never run
  // in production — purge any test grants before live cutover.
  if (env.NODE_ENV === 'production' && testMode) {
    throw new Error('credits: BORING_CREDITS_LS_TEST_MODE=1 in production mints non-charging but spendable credits — set it to 0 and purge any test grants before live cutover')
  }
  const checkoutReady = Boolean(env.BORING_CREDITS_LS_API_KEY && env.BORING_CREDITS_LS_STORE_ID && Object.keys(variants).length > 0)
  // Dedicated attribution secret(s) for checkout `uat`, decoupled from the webhook
  // secret so rotating the webhook secret doesn't break in-flight checkout links.
  // [current, ...previous] for rotation grace. Unset ⇒ route falls back to the
  // webhook secret (back-compat).
  const attributionCurrent = env.BORING_CREDITS_ATTRIBUTION_SECRET || undefined
  const attributionPrevious = (env.BORING_CREDITS_ATTRIBUTION_SECRET_PREVIOUS || '')
    .split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const lemonSqueezyAttributionSecrets = attributionCurrent
    ? [attributionCurrent, ...attributionPrevious]
    : undefined
  return {
    ...common,
    lemonSqueezyWebhookSecret: env.BORING_CREDITS_LS_WEBHOOK_SECRET || undefined,
    lemonSqueezyVariants: variants,
    lemonSqueezyCreditMicrosByVariant: creditMicrosByVariant,
    lemonSqueezyTestMode: testMode,
    lemonSqueezyStoreId: env.BORING_CREDITS_LS_STORE_ID || undefined,
    lemonSqueezyAttributionSecrets,
    // The launch store sells only credit packs → unknown-variant paid orders are
    // pack misconfigs that must fail loud. Set 0 for a mixed store (credits + other
    // products) so legitimate non-credit orders are ignored, not retried forever.
    lemonSqueezyCreditOnlyStore: env.BORING_CREDITS_LS_CREDIT_ONLY_STORE !== '0',
    lemonSqueezyCheckout: checkoutReady
      ? {
          apiKey: env.BORING_CREDITS_LS_API_KEY!,
          storeId: env.BORING_CREDITS_LS_STORE_ID!,
          variants,
          defaultPack: env.BORING_CREDITS_LS_DEFAULT_PACK || Object.keys(variants)[0]!,
          redirectUrl: env.BORING_CREDITS_LS_REDIRECT_URL || undefined,
          testMode,
        }
      : undefined,
  }
}

/**
 * Credit consumption + purchase wiring for the full app. The sink is created
 * up-front (passed to createCoreWorkspaceAgentServer) but the service is built
 * after the server exists (it needs app.db). Signup grants happen lazily on
 * first balance/reserve, so no auth hook is required.
 */
export function buildCreditsWiring(env: NodeJS.ProcessEnv = process.env): {
  meteringSink: AgentMeteringSink
  attach: (app: CoreWorkspaceAgentServer) => void
} {
  const config = readCreditsConfig(env)
  let service: CreditsService | undefined
  const getService = (): CreditsService => {
    if (!service) throw new Error('credits service not ready (attach not called)')
    return service
  }

  return {
    meteringSink: createCreditsMeteringSink(getService),
    attach(app) {
      const store = new PostgresMeteringStore(app.db as unknown as ConstructorParameters<typeof PostgresMeteringStore>[0])
      service = new CreditsService(store, config, (message, fields) => app.log.warn(fields ?? {}, message))
      const creditVariantIds = Object.values(config.lemonSqueezyVariants)
      // When credits are disabled, do NOT expose checkout/webhook: a paid order
      // acknowledged-but-not-persisted would be lost, and a refund wouldn't
      // tombstone. The whole feature is off, so wire neither (balance still
      // returns a disabled balance).
      const lemonSqueezy =
        config.enabled && config.lemonSqueezyWebhookSecret
          ? {
              webhookSecret: config.lemonSqueezyWebhookSecret,
              attributionSecret: config.lemonSqueezyAttributionSecrets,
              // Don't let a stale order_created webhook resurrect a deleted user's
              // purchase/grant rows (PII) after account deletion.
              userExists: async (userId: string) => (await app.userStore.getById(userId)) !== null,
              creditVariantIds,
              creditMicrosByVariant: config.lemonSqueezyCreditMicrosByVariant,
              expectedTestMode: config.lemonSqueezyTestMode,
              expectedStoreId: config.lemonSqueezyStoreId,
              creditOnlyStore: config.lemonSqueezyCreditOnlyStore,
              checkout: config.lemonSqueezyCheckout,
            }
          : undefined
      // Stripe purchase wiring (alternative provider). Only PARSE Stripe env when credits
      // are enabled — the BORING_CREDITS_ENABLED=0 kill switch must boot even with stale/
      // invalid Stripe env. userExists guards against PII resurrection on a stale webhook.
      const stripeRoute = config.enabled ? readStripeRouteConfig(env) : undefined
      const stripe =
        config.enabled && stripeRoute
          ? {
              ...stripeRoute,
              userExists: async (userId: string) => (await app.userStore.getById(userId)) !== null,
            }
          : undefined
      if (lemonSqueezy && stripe) {
        throw new Error('credits: configure at most one purchase provider — both Lemon Squeezy (BORING_CREDITS_LS_*) and Stripe (BORING_CREDITS_STRIPE_*) are configured')
      }
      registerCreditsRoutes(app, {
        service,
        lemonSqueezy,
        stripe,
        log: (message, fields) => app.log.warn(fields ?? {}, message),
      })
      if (config.enabled && stripeRoute) {
        if (!stripeRoute.checkout) {
          app.log.warn('credits: Stripe configured but checkout not ready (need BORING_CREDITS_STRIPE_SECRET_KEY + variants or a custom price) — Buy button hidden')
        } else if (!stripeRoute.webhookSecret) {
          app.log.warn('credits: BORING_CREDITS_STRIPE_WEBHOOK_SECRET unset — checkout opens but purchases will NOT auto-credit (no webhook). Use `stripe listen` or set the secret.')
        }
      }
      if (!config.enabled) {
        app.log.warn('credits: BORING_CREDITS_ENABLED=0 — consumption + purchase webhook/checkout disabled')
      } else if (!config.lemonSqueezyWebhookSecret) {
        app.log.warn('credits: BORING_CREDITS_LS_WEBHOOK_SECRET unset — purchase webhook disabled (consumption still active)')
      } else {
        // Webhook is enabled: empty variants would 200-ack paid orders WITHOUT
        // crediting (customer pays, no credits, LS stops retrying). Fail fast.
        if (creditVariantIds.length === 0) {
          throw new Error('credits: BORING_CREDITS_LS_WEBHOOK_SECRET is set but BORING_CREDITS_LS_VARIANTS is empty — paid orders would be acknowledged without crediting. Configure the credit packs or unset the webhook secret.')
        }
        // The webhook requires a server-signed attribution token (custom_data.uat),
        // which ONLY a server-created checkout mints. With the webhook enabled but no
        // checkout configured, there's no way to produce attributable orders — every
        // real order would 500 forever as untrusted_attribution (paid, never credited).
        // Fail fast: the purchase flow is unusable without server-side checkout.
        if (!config.lemonSqueezyCheckout) {
          throw new Error('credits: BORING_CREDITS_LS_WEBHOOK_SECRET is set but server-side checkout is not configured (need BORING_CREDITS_LS_API_KEY + store id + variants). The webhook requires a server-signed attribution token that only server-created checkouts mint, so real orders would 500 forever as untrusted_attribution. Configure checkout or unset the webhook secret.')
        }
      }
      // The per-run hold bounds a single run's overdraft. Evaluate it against the
      // served + effective worst cases (a 'throw' verdict is fatal; a 'warn' is a
      // documented accepted posture). Extracted as a pure function so the default
      // (served-rate) config is regression-tested to boot, not crash.
      const verdict = assessReservationHold(config, env)
      if (config.enabled) {
        if (verdict.action === 'throw') throw new Error(verdict.message)
        if (verdict.action === 'warn') app.log.warn(verdict.fields, verdict.message)
      }
      // A free-grant smaller than the per-run hold means new users can't start a
      // run at all (reserve needs the full hold available). Surface it — the
      // operator must raise the grant, lower the hold, or configure cheaper rates.
      if (config.enabled && config.signupGrantMicros > 0 && config.signupGrantMicros < config.runReservationMicros) {
        app.log.warn(
          { signupGrantMicros: config.signupGrantMicros, runReservationMicros: config.runReservationMicros },
          'credits: signup grant is below the per-run hold — new users will be blocked from their first run until they buy credits',
        )
      }
      // Background charge-on-expire sweeper. reserve() expires the CURRENT user's
      // stale reservations on admission, but a user who never returns would otherwise
      // leave a marked (charge_on_expire) reservation un-charged past TTL — and
      // computeBalance drops expired reservations from the hold, so the durable
      // fallback charge would be lost. This periodic sweep (off the request path, so a
      // cross-user conflict/DB blip just retries next tick) closes that gap.
      if (config.enabled) {
        const timer = setInterval(() => {
          void store.expireStaleReservations().catch((error) =>
            app.log.warn({ error: String(error) }, 'credits: background stale-reservation sweep failed (will retry next tick)'),
          )
        }, config.sweepIntervalSeconds * 1000)
        timer.unref?.() // don't keep the process alive for the timer
        app.addHook('onClose', async () => clearInterval(timer))
      }
    },
  }
}
