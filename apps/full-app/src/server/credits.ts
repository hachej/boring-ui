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

export function readCreditsConfig(env: NodeJS.ProcessEnv = process.env): CreditsConfig & { lemonSqueezyWebhookSecret?: string } {
  const expiresRaw = env.BORING_CREDITS_SIGNUP_GRANT_EXPIRES_DAYS
  return {
    enabled: env.BORING_CREDITS_ENABLED !== '0',
    signupGrantMicros: eurToMicros(env.BORING_CREDITS_SIGNUP_GRANT_EUR, 2),
    signupGrantExpiresAfterDays: expiresRaw === undefined || expiresRaw === '0' ? null : Math.max(1, Number(expiresRaw) || 0) || null,
    runReservationMicros: eurToMicros(env.BORING_CREDITS_RESERVATION_EUR, 0.25),
    reservationTtlSeconds: Math.max(60, Number(env.BORING_CREDITS_RESERVATION_TTL_SECONDS ?? 7200) || 7200),
    minBalanceMicros: eurToMicros(env.BORING_CREDITS_MIN_BALANCE_EUR, 0.05),
    pricing: {
      margin: Number(env.BORING_CREDITS_MARGIN ?? 1.3) || 1.3,
      creditMicrosPerUnit: CREDIT_MICROS_PER_EUR,
    },
    lemonSqueezyWebhookSecret: env.BORING_CREDITS_LS_WEBHOOK_SECRET || undefined,
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
      service = new CreditsService(store, config)
      registerCreditsRoutes(app, {
        service,
        lemonSqueezy: config.lemonSqueezyWebhookSecret
          ? { webhookSecret: config.lemonSqueezyWebhookSecret }
          : undefined,
        log: (message, fields) => app.log.warn(fields ?? {}, message),
      })
      if (!config.lemonSqueezyWebhookSecret) {
        app.log.warn('credits: BORING_CREDITS_LS_WEBHOOK_SECRET unset — purchase webhook disabled (consumption still active)')
      }
    },
  }
}
