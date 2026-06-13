import {
  CreditsService,
  PostgresMeteringStore,
  createCreditsMeteringSink,
  registerCreditsRoutes,
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

/** Parse a provided numeric money env strictly; fallback only when unset/empty. */
function parseNumberEnv(name: string, value: string | undefined, fallback: number, min: number): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`invalid ${name}: expected a number >= ${min}, got "${value}"`)
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
    const [pack, variant] = pair.split(':').map((s) => s.trim())
    if (!pack || !variant) {
      throw new Error(`invalid BORING_CREDITS_LS_VARIANTS entry (expected "creditEur:variantId"): "${pair}"`)
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
    const [pattern, prices] = entry.split('=')
    const [input, output] = (prices ?? '').split(':').map(Number)
    if (!pattern || !pattern.trim()) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (missing pattern): "${entry}"`)
    }
    if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) {
      throw new Error(`invalid BORING_CREDITS_RATES entry (rates must be positive EUR/MTok): "${entry}"`)
    }
    try {
      rates.push([new RegExp(pattern.trim(), 'i'), { inputPerMillion: input, outputPerMillion: output }])
    } catch {
      throw new Error(`invalid BORING_CREDITS_RATES entry (bad regex): "${entry}"`)
    }
  }
  return rates.length > 0 ? rates : undefined
}

export interface FullAppCreditsConfig extends CreditsConfig {
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
 * Conservative worst-case RUN cost (credit micros). A single Pi prompt can make
 * several model calls (tool loop) before any debit posts, and each call is
 * priced at the priciest rate the config can ACTUALLY charge (maxEffectiveRate —
 * the same effective table usageToCredits uses, incl. DEFAULT_MODEL_RATES when
 * no env rates are set) over the max context+output, with margin. The per-run
 * hold must cover the whole run for the hard stop to be tight, so we multiply a
 * worst-case call by BORING_CREDITS_MAX_CALLS_PER_RUN. A run that exceeds that
 * call budget can still overshoot the hold; the overshoot is bounded and the
 * user's NEXT run is then refused (negative balance), so exposure is capped.
 */
function worstCaseRunMicros(pricing: CreditPricingConfig, env: NodeJS.ProcessEnv): number {
  const maxContext = parseNumberEnv('BORING_CREDITS_MAX_CONTEXT_TOKENS', env.BORING_CREDITS_MAX_CONTEXT_TOKENS, 200_000, 1)
  const maxOutput = parseNumberEnv('BORING_CREDITS_MAX_OUTPUT_TOKENS', env.BORING_CREDITS_MAX_OUTPUT_TOKENS, 16_384, 1)
  const maxCalls = parseNumberEnv('BORING_CREDITS_MAX_CALLS_PER_RUN', env.BORING_CREDITS_MAX_CALLS_PER_RUN, 4, 1)
  const rate = maxEffectiveRate(pricing)
  const unitsPerCall = (maxContext / 1_000_000) * rate.inputPerMillion + (maxOutput / 1_000_000) * rate.outputPerMillion
  return Math.ceil(unitsPerCall * maxCalls * pricing.margin * pricing.creditMicrosPerUnit)
}

export function readCreditsConfig(env: NodeJS.ProcessEnv = process.env): FullAppCreditsConfig {
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
  // When Lemon Squeezy is configured, the test/live mode MUST be explicit — a
  // wrong default would either mint credits from non-charging test orders or
  // reject real live webhooks. Require an exact "0" (live) or "1" (test).
  const lsConfigured = Boolean(env.BORING_CREDITS_LS_WEBHOOK_SECRET || env.BORING_CREDITS_LS_API_KEY)
  const testMode = parseTestMode(env.BORING_CREDITS_LS_TEST_MODE, lsConfigured)
  const checkoutReady = Boolean(env.BORING_CREDITS_LS_API_KEY && env.BORING_CREDITS_LS_STORE_ID && Object.keys(variants).length > 0)
  // Margin < 1 would bill below provider cost — reject it (fail closed).
  const margin = parseNumberEnv('BORING_CREDITS_MARGIN', env.BORING_CREDITS_MARGIN, 1.3, 1)
  // Verified per-model EUR/MTok rates (e.g. Infomaniak). Unset ⇒ unconfigured
  // models bill at the conservative default (over-charge, never free).
  const rates = parseRates(env.BORING_CREDITS_RATES)
  // The per-run hold defaults to the worst-case run so the hard stop is tight by
  // construction; an explicit BORING_CREDITS_RESERVATION_EUR is validated in attach().
  const worstCase = worstCaseRunMicros({ margin, creditMicrosPerUnit: CREDIT_MICROS_PER_EUR, rates }, env)
  const runReservationMicros = env.BORING_CREDITS_RESERVATION_EUR
    ? eurToMicros('BORING_CREDITS_RESERVATION_EUR', env.BORING_CREDITS_RESERVATION_EUR, 1)
    : worstCase
  return {
    enabled: env.BORING_CREDITS_ENABLED !== '0',
    signupGrantMicros: eurToMicros('BORING_CREDITS_SIGNUP_GRANT_EUR', env.BORING_CREDITS_SIGNUP_GRANT_EUR, 2),
    signupGrantExpiresAfterDays: parseExpiryDays(env.BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS),
    runReservationMicros,
    reservationTtlSeconds: Math.max(60, parseNumberEnv('BORING_CREDITS_RESERVATION_TTL_SECONDS', env.BORING_CREDITS_RESERVATION_TTL_SECONDS, 7200, 60)),
    minBalanceMicros: eurToMicros('BORING_CREDITS_MIN_BALANCE_EUR', env.BORING_CREDITS_MIN_BALANCE_EUR, 0.05),
    pricing: {
      margin,
      creditMicrosPerUnit: CREDIT_MICROS_PER_EUR,
      rates,
    },
    lemonSqueezyWebhookSecret: env.BORING_CREDITS_LS_WEBHOOK_SECRET || undefined,
    lemonSqueezyVariants: variants,
    lemonSqueezyCreditMicrosByVariant: creditMicrosByVariant,
    lemonSqueezyTestMode: testMode,
    lemonSqueezyStoreId: env.BORING_CREDITS_LS_STORE_ID || undefined,
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
              creditVariantIds,
              creditMicrosByVariant: config.lemonSqueezyCreditMicrosByVariant,
              expectedTestMode: config.lemonSqueezyTestMode,
              expectedStoreId: config.lemonSqueezyStoreId,
              checkout: config.lemonSqueezyCheckout,
            }
          : undefined
      registerCreditsRoutes(app, {
        service,
        lemonSqueezy,
        log: (message, fields) => app.log.warn(fields ?? {}, message),
      })
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
        if (!config.lemonSqueezyCheckout) {
          app.log.warn('credits: Lemon Squeezy checkout not configured (need API key + store id + variants) — Buy-credits button disabled')
        }
      }
      // The per-run hold is the only bound on a single run's overdraft (actual
      // cost is posted after the run). If it can't cover a worst-case run, the
      // hard stop isn't hard. Fail closed at startup rather than ship a config
      // that lets one run push a user arbitrarily negative.
      const worstCase = worstCaseRunMicros(config.pricing, env)
      if (config.enabled && config.runReservationMicros < worstCase) {
        throw new Error(
          `credits: per-run reservation (${config.runReservationMicros} micros) is below the worst-case run cost ` +
            `(${worstCase} micros). Raise BORING_CREDITS_RESERVATION_EUR (or lower BORING_CREDITS_MAX_CONTEXT_TOKENS/` +
            `BORING_CREDITS_MAX_OUTPUT_TOKENS/BORING_CREDITS_MAX_CALLS_PER_RUN) so the per-run hard stop covers a run.`,
        )
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
    },
  }
}
