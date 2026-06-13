import { InsufficientCreditError, type PostgresMeteringStore } from '../db/stores/PostgresMeteringStore.js'
import { usageToCredits, type CreditPricingConfig } from './pricing.js'

export const SIGNUP_GRANT_REASON = 'signup_grant'

export interface CreditsConfig {
  enabled: boolean
  /** Free starter grant on signup, in credit micros (1 credit = €0.000001). */
  signupGrantMicros: number
  /** Days until the signup grant expires; null = never. */
  signupGrantExpiresAfterDays: number | null
  /** Per-run overdraft hold, in credit micros. */
  runReservationMicros: number
  reservationTtlSeconds: number
  /** Floor below which a run is refused. */
  minBalanceMicros: number
  pricing: CreditPricingConfig
}

export const DEFAULT_CREDITS_CONFIG: CreditsConfig = {
  enabled: true,
  signupGrantMicros: 2_000_000, // €2
  signupGrantExpiresAfterDays: null,
  runReservationMicros: 250_000, // €0.25 hold
  reservationTtlSeconds: 2 * 60 * 60,
  minBalanceMicros: 50_000, // €0.05
  pricing: { margin: 1.3, creditMicrosPerUnit: 1_000_000 },
}

export interface CreditBalance {
  enabled: boolean
  userId: string
  grantedMicros: number
  usedMicros: number
  remainingMicros: number
  activeReservedMicros: number
  /** remaining minus active holds; never negative in the response. */
  availableMicros: number
  currency: 'credits'
}

export interface CreditUsageRecord {
  usageId: string
  userId: string
  workspaceId?: string
  sessionId?: string
  runId?: string
  messageId?: string
  reservationId?: string
  provider?: string
  model?: string
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } }
  stopReason?: string
}

export class CreditExhaustedError extends Error {
  readonly statusCode = 402
  readonly code = 'PAYMENT_REQUIRED'
  readonly details: { balance: CreditBalance }

  constructor(balance: CreditBalance) {
    super('insufficient credits')
    this.name = 'CreditExhaustedError'
    this.details = { balance }
  }
}

/** The subset of PostgresMeteringStore the credits policy uses; Pick keeps
 * upstream signature changes compile-time errors and lets tests stub it. */
export type CreditsMeteringStore = Pick<
  PostgresMeteringStore,
  'grantOnce' | 'getBalance' | 'reserve' | 'recordUsage' | 'finishReservation' | 'expireStaleReservations'
>

function disabledBalance(userId: string): CreditBalance {
  return {
    enabled: false,
    userId,
    grantedMicros: 0,
    usedMicros: 0,
    activeReservedMicros: 0,
    remainingMicros: Number.MAX_SAFE_INTEGER,
    availableMicros: Number.MAX_SAFE_INTEGER,
    currency: 'credits',
  }
}

/**
 * Product credit policy over the generic metering store: free signup grant,
 * purchase grants, per-run reservation hard stop, token→credit pricing, and the
 * balance shape the UI consumes. Currency-neutral (amounts are credit micros).
 */
export class CreditsService {
  /** Users whose signup grant was ensured this process; avoids an INSERT per balance poll. */
  private readonly signupGrantedUsers = new Set<string>()

  constructor(
    private readonly store: CreditsMeteringStore,
    readonly config: CreditsConfig = DEFAULT_CREDITS_CONFIG,
  ) {}

  /** Idempotently grant the free starter credits (call from the post-signup hook
   * and lazily on first balance/reserve). */
  async grantSignupCredits(userId: string): Promise<void> {
    if (!this.config.enabled || this.config.signupGrantMicros <= 0) return
    if (this.signupGrantedUsers.has(userId)) return
    const expiresAt = this.config.signupGrantExpiresAfterDays === null
      ? undefined
      : new Date(Date.now() + this.config.signupGrantExpiresAfterDays * 24 * 60 * 60 * 1000)
    await this.store.grantOnce({
      userId,
      reason: SIGNUP_GRANT_REASON,
      amountMicros: this.config.signupGrantMicros,
      expiresAt,
    })
    this.signupGrantedUsers.add(userId)
  }

  /** Credit a completed purchase. Idempotent per order id (safe on webhook retry). */
  async grantPurchase(userId: string, orderId: string, amountMicros: number): Promise<{ created: boolean }> {
    if (!this.config.enabled) return { created: false }
    return this.store.grantOnce({ userId, reason: `purchase:${orderId}`, amountMicros })
  }

  async getBalance(userId: string): Promise<CreditBalance> {
    if (!this.config.enabled) return disabledBalance(userId)
    await this.grantSignupCredits(userId)
    const balance = await this.store.getBalance(userId)
    return {
      enabled: true,
      userId,
      grantedMicros: balance.grantedMicros,
      usedMicros: balance.usedMicros,
      activeReservedMicros: balance.activeReservedMicros,
      remainingMicros: Math.max(0, balance.availableMicros),
      availableMicros: Math.max(0, balance.availableMicros),
      currency: 'credits',
    }
  }

  /** Reserve a per-run hold. Returns the reservation id; throws
   * CreditExhaustedError (402) below the floor. */
  async reserveRun(input: { userId: string; workspaceId?: string; sessionId?: string; runId: string }): Promise<string | undefined> {
    if (!this.config.enabled) return undefined
    await this.grantSignupCredits(input.userId)
    await this.store.expireStaleReservations()
    try {
      const { reservationId } = await this.store.reserve({
        userId: input.userId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.runId,
        source: 'pi-chat',
        amountMicros: this.config.runReservationMicros,
        ttlSeconds: this.config.reservationTtlSeconds,
        minAvailableMicros: Math.max(this.config.minBalanceMicros, this.config.runReservationMicros),
      })
      return reservationId
    } catch (error) {
      if (error instanceof InsufficientCreditError) {
        throw new CreditExhaustedError(await this.getBalance(input.userId))
      }
      throw error
    }
  }

  /** Charge native usage, priced token→credits with margin. */
  async recordUsage(input: CreditUsageRecord): Promise<void> {
    if (!this.config.enabled) return
    const model = { provider: input.provider, id: input.model }
    const cost = usageToCredits(
      {
        inputTokens: input.usage.input,
        outputTokens: input.usage.output,
        cacheReadTokens: input.usage.cacheRead,
        cacheWriteTokens: input.usage.cacheWrite,
        providerReportedCost: input.usage.cost.total,
      },
      model,
      this.config.pricing,
    )
    await this.store.recordUsage({
      usageId: input.usageId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: input.runId,
      messageId: input.messageId,
      source: 'pi-chat',
      provider: input.provider,
      model: input.model,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      providerCostMicros: cost.providerCostMicros,
      billedCostMicros: cost.billedCreditMicros,
      stopReason: input.stopReason,
      metadata: { currency: 'credits' },
    })
  }

  async settleRun(userId: string, runId: string, reservationId?: string): Promise<void> {
    if (!this.config.enabled) return
    await this.store.finishReservation(reservationId ? { reservationId } : { runId, userId }, 'settled')
  }

  async releaseRun(userId: string, runId: string, reservationId?: string): Promise<void> {
    if (!this.config.enabled) return
    await this.store.finishReservation(reservationId ? { reservationId } : { runId, userId }, 'released')
  }
}
