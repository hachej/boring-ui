import {
  CreditsService,
  PostgresMeteringStore,
  createCreditsMeteringSink,
  registerCreditsRoutes,
  type CreditsConfig,
} from '@hachej/boring-core/server'
import type { AgentMeteringSink } from '@hachej/boring-agent/server'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

const CREDIT_MICROS_PER_EUR = 1_000_000 // 1 credit = €0.000001

function eurToMicros(value: string | undefined, fallbackEur: number): number {
  const eur = value === undefined || value === '' ? fallbackEur : Number(value)
  return Math.round((Number.isFinite(eur) && eur >= 0 ? eur : fallbackEur) * CREDIT_MICROS_PER_EUR)
}

/** Parse "10:var_abc,25:var_def,50:var_ghi" → { '10': 'var_abc', ... }. */
function parseVariants(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const [pack, variant] = pair.split(':').map((s) => s.trim())
    if (pack && variant) out[pack] = variant
  }
  return out
}

/** Parse "regex=in:out;regex=in:out" → model rate table (EUR / MTok). */
function parseRates(raw: string | undefined): Array<[RegExp, { inputPerMillion: number; outputPerMillion: number }]> | undefined {
  if (!raw) return undefined
  const rates: Array<[RegExp, { inputPerMillion: number; outputPerMillion: number }]> = []
  for (const entry of raw.split(';')) {
    const [pattern, prices] = entry.split('=')
    const [input, output] = (prices ?? '').split(':').map(Number)
    if (pattern && Number.isFinite(input) && Number.isFinite(output)) {
      try {
        rates.push([new RegExp(pattern.trim(), 'i'), { inputPerMillion: input, outputPerMillion: output }])
      } catch {
        // skip a malformed pattern
      }
    }
  }
  return rates.length > 0 ? rates : undefined
}

export interface FullAppCreditsConfig extends CreditsConfig {
  lemonSqueezyWebhookSecret?: string
  /** Pack id → LS variant id. Webhook only credits these variants. */
  lemonSqueezyVariants: Record<string, string>
  /** Expected LS mode (true = test, false = live). Default test. */
  lemonSqueezyTestMode: boolean
  lemonSqueezyCheckout?: {
    apiKey: string
    storeId: string
    variants: Record<string, string>
    defaultPack: string
    redirectUrl?: string
    testMode: boolean
  }
}

export function readCreditsConfig(env: NodeJS.ProcessEnv = process.env): FullAppCreditsConfig {
  const expiresRaw = env.BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS
  const variants = parseVariants(env.BORING_CREDITS_LS_VARIANTS)
  // Default to TEST mode; live deploys must set BORING_CREDITS_LS_TEST_MODE=0.
  const testMode = env.BORING_CREDITS_LS_TEST_MODE !== '0'
  const checkoutReady = Boolean(env.BORING_CREDITS_LS_API_KEY && env.BORING_CREDITS_LS_STORE_ID && Object.keys(variants).length > 0)
  return {
    enabled: env.BORING_CREDITS_ENABLED !== '0',
    signupGrantMicros: eurToMicros(env.BORING_CREDITS_SIGNUP_GRANT_EUR, 2),
    signupGrantExpiresAfterDays: expiresRaw === undefined || expiresRaw === '0' ? null : Math.max(1, Number(expiresRaw) || 0) || null,
    runReservationMicros: eurToMicros(env.BORING_CREDITS_RESERVATION_EUR, 1),
    reservationTtlSeconds: Math.max(60, Number(env.BORING_CREDITS_RESERVATION_TTL_SECONDS ?? 7200) || 7200),
    minBalanceMicros: eurToMicros(env.BORING_CREDITS_MIN_BALANCE_EUR, 0.05),
    pricing: {
      margin: Number(env.BORING_CREDITS_MARGIN ?? 1.3) || 1.3,
      creditMicrosPerUnit: CREDIT_MICROS_PER_EUR,
      // Verified per-model EUR/MTok rates (e.g. Infomaniak). Unset ⇒ unconfigured
      // models bill at the conservative default (over-charge, never free).
      rates: parseRates(env.BORING_CREDITS_RATES),
    },
    lemonSqueezyWebhookSecret: env.BORING_CREDITS_LS_WEBHOOK_SECRET || undefined,
    lemonSqueezyVariants: variants,
    lemonSqueezyTestMode: testMode,
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

/** Conservative worst-case single-run cost (credit micros) from the priciest
 * configured rate and the model's max context+output, used to warn when the
 * reservation hold is too small to make the hard stop tight. */
function worstCaseRunMicros(config: FullAppCreditsConfig, env: NodeJS.ProcessEnv): number {
  const maxContext = Number(env.BORING_CREDITS_MAX_CONTEXT_TOKENS ?? 200_000) || 200_000
  const maxOutput = Number(env.BORING_CREDITS_MAX_OUTPUT_TOKENS ?? 16_384) || 16_384
  const rates = config.pricing.rates ?? []
  const maxInput = rates.reduce((m, [, r]) => Math.max(m, r.inputPerMillion), 3) // ≥ conservative default
  const maxOut = rates.reduce((m, [, r]) => Math.max(m, r.outputPerMillion), 15)
  const eur = (maxContext / 1_000_000) * maxInput + (maxOutput / 1_000_000) * maxOut
  return Math.ceil(eur * config.pricing.margin * CREDIT_MICROS_PER_EUR)
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
      registerCreditsRoutes(app, {
        service,
        lemonSqueezy: config.lemonSqueezyWebhookSecret
          ? {
              webhookSecret: config.lemonSqueezyWebhookSecret,
              creditVariantIds,
              expectedTestMode: config.lemonSqueezyTestMode,
              checkout: config.lemonSqueezyCheckout,
            }
          : undefined,
        log: (message, fields) => app.log.warn(fields ?? {}, message),
      })
      if (!config.lemonSqueezyWebhookSecret) {
        app.log.warn('credits: BORING_CREDITS_LS_WEBHOOK_SECRET unset — purchase webhook disabled (consumption still active)')
      } else {
        if (creditVariantIds.length === 0) {
          app.log.warn('credits: BORING_CREDITS_LS_VARIANTS unset — purchase webhook will credit NOTHING (fail closed)')
        }
        if (!config.lemonSqueezyCheckout) {
          app.log.warn('credits: Lemon Squeezy checkout not configured (need API key + store id + variants) — Buy-credits button disabled')
        }
      }
      // Warn when the per-run hold can't cover a worst-case run (loose hard stop).
      const worstCase = worstCaseRunMicros(config, env)
      if (config.enabled && config.runReservationMicros < worstCase) {
        app.log.warn(
          { runReservationMicros: config.runReservationMicros, worstCaseRunMicros: worstCase },
          'credits: per-run reservation is below the estimated worst-case run cost — raise BORING_CREDITS_RESERVATION_EUR to make the hard stop tight',
        )
      }
    },
  }
}
