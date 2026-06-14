import { InsufficientCreditError, type PostgresMeteringStore } from '../db/stores/PostgresMeteringStore.js'
import { usageToCredits, type CreditPricingConfig, type ModelTokenRate } from './pricing.js'

/** Validate money-critical pricing config up front so a misconfigured host
 * (e.g. creditMicrosPerUnit 0, margin < 1, a non-positive rate) fails fast
 * rather than silently billing zero or corrupting the balance math. */
function validatePricingConfig(p: CreditPricingConfig): void {
  if (!Number.isSafeInteger(p.creditMicrosPerUnit) || p.creditMicrosPerUnit <= 0) {
    throw new Error('credits pricing.creditMicrosPerUnit must be a positive safe integer')
  }
  if (!Number.isFinite(p.margin) || p.margin < 1) {
    throw new Error('credits pricing.margin must be a finite number >= 1 (never bill below provider cost)')
  }
  const checkRate = (rate: ModelTokenRate, label: string) => {
    if (!Number.isFinite(rate.inputPerMillion) || rate.inputPerMillion <= 0 || !Number.isFinite(rate.outputPerMillion) || rate.outputPerMillion <= 0) {
      throw new Error(`credits pricing ${label} rate must have positive input/output rates`)
    }
  }
  for (const [, rate] of p.rates ?? []) checkRate(rate, 'configured')
  if (p.defaultRate) checkRate(p.defaultRate, 'default')
}

export const SIGNUP_GRANT_REASON = 'signup_grant'

export type CreditsLogger = (message: string, fields?: Record<string, unknown>) => void

export interface CreditsConfig {
  enabled: boolean
  /** Free starter grant on signup, in credit micros (1 credit = €0.000001). */
  signupGrantMicros: number
  /** Days until the signup grant expires; null = never. */
  signupGrantExpiresAfterDays: number | null
  /**
   * Per-run hold, in credit micros. This is the per-run overdraft bound: a run
   * is admitted against this hold, but the actual charge is posted afterward, so
   * a single run can overshoot the hold by (actualCost − hold). Set this to
   * cover your worst-case single run (max tokens on the priciest enabled model)
   * so the hard stop is effectively exact.
   */
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
  // €1 hold — covers a worst-case single run so a run rarely overshoots its hold.
  runReservationMicros: 1_000_000,
  reservationTtlSeconds: 2 * 60 * 60,
  minBalanceMicros: 50_000, // €0.05
  // No explicit defaultRate ⇒ an unmatched model bills at the highest effective
  // rate (fail closed), not a cheap fallback.
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
  /** Owed amount when the ledger went negative (e.g. after a refund of spent
   * credits); 0 otherwise. Surfaced for audit/support so debt isn't hidden. */
  debtMicros: number
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
  'grantOnce' | 'grantPurchaseOnce' | 'revokePurchase' | 'getBalance' | 'reserve' | 'recordUsage' | 'finishReservation' | 'expireStaleReservations' | 'billedMicrosForRun' | 'billedMicrosForReservation' | 'markReservationFallbackCharge'
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
    debtMicros: 0,
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
    private readonly log?: CreditsLogger,
  ) {
    validatePricingConfig(config.pricing)
    // Fail fast on bad money amounts rather than deferring to a later store call.
    const posInt = (n: number) => Number.isSafeInteger(n) && n > 0
    const nonNegInt = (n: number) => Number.isSafeInteger(n) && n >= 0
    if (!nonNegInt(config.signupGrantMicros)) throw new Error('credits: signupGrantMicros must be a non-negative safe integer')
    if (!posInt(config.runReservationMicros)) throw new Error('credits: runReservationMicros must be a positive safe integer')
    if (!nonNegInt(config.minBalanceMicros)) throw new Error('credits: minBalanceMicros must be a non-negative safe integer')
    if (!posInt(config.reservationTtlSeconds)) throw new Error('credits: reservationTtlSeconds must be a positive safe integer')
    if (!Number.isSafeInteger(config.runReservationMicros + config.minBalanceMicros)) {
      throw new Error('credits: runReservationMicros + minBalanceMicros exceeds the safe integer range')
    }
    // Expiring signup grants would create debt after partial spend (see
    // grantSignupCredits) — reject the config until promo-balance allocation exists.
    if (config.signupGrantExpiresAfterDays !== null) {
      throw new Error('credits: signupGrantExpiresAfterDays is not supported yet (an expiring grant turns a partly-spent trial into debt); use null')
    }
  }

  /** Idempotently grant the free starter credits (call from the post-signup hook
   * and lazily on first balance/reserve). The grant NEVER expires: an expiring
   * grant would drop from grantedMicros on expiry while spent usage stayed, turning
   * a partly-spent trial into debt. (Proper expiry must cap/allocate usage against
   * the promo balance — a tracked follow-up; the expiry config is rejected up front.) */
  async grantSignupCredits(userId: string): Promise<void> {
    if (!this.config.enabled || this.config.signupGrantMicros <= 0) return
    if (this.signupGrantedUsers.has(userId)) return
    await this.store.grantOnce({
      userId,
      reason: SIGNUP_GRANT_REASON,
      amountMicros: this.config.signupGrantMicros,
    })
    this.signupGrantedUsers.add(userId)
  }

  /** Credit a completed purchase. Globally idempotent per order id (safe on
   * webhook retry, and the same order can never be credited to two users). The
   * optional provider identity is persisted for audit/refund reconciliation. */
  async grantPurchase(
    userId: string,
    orderId: string,
    amountMicros: number,
    identity?: { storeId?: string; testMode?: boolean; currency?: string; variantId?: string },
  ): Promise<{ created: boolean }> {
    if (!this.config.enabled) return { created: false }
    const { granted } = await this.store.grantPurchaseOnce({ userId, orderId, amountMicros, ...identity })
    return { created: granted }
  }

  /** Revoke a refunded/disputed purchase. `refundFraction` is the cumulative
   * fraction of the order refunded (LS refunded_amount / total) for partial
   * refunds; omit for a full refund. `allowTombstone` permits writing a pre-grant
   * refund tombstone for an order not yet credited (set only when the refund
   * validates as a credit order); an already-credited order is always revocable.
   * Idempotent per cumulative level. */
  async revokePurchase(
    orderId: string,
    opts: { refundFraction?: number; allowTombstone?: boolean; expectedStoreId?: string; expectedTestMode?: boolean; expectedCurrency?: string } = {},
  ): Promise<{ revoked: boolean }> {
    if (!this.config.enabled) return { revoked: false }
    return this.store.revokePurchase(orderId, {
      refundFraction: opts.refundFraction,
      allowTombstone: opts.allowTombstone,
      expectedStoreId: opts.expectedStoreId,
      expectedTestMode: opts.expectedTestMode,
      expectedCurrency: opts.expectedCurrency,
    })
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
      // remaining = granted − used (ledger). available = remaining − active holds.
      remainingMicros: Math.max(0, balance.remainingMicros),
      availableMicros: Math.max(0, balance.availableMicros),
      // Owed when the raw ledger is negative (refund of already-spent credits).
      debtMicros: Math.max(0, -balance.remainingMicros),
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
        // Must keep minBalanceMicros available AFTER placing the hold, so a run
        // is admitted only when available ≥ hold + floor (matches the config doc).
        minAvailableMicros: this.config.runReservationMicros + this.config.minBalanceMicros,
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
    if (cost.pricedFromDefault) {
      // Unpriced model billed at the conservative default — surface it so an
      // explicit rate gets configured.
      this.log?.('credits: model billed at default rate (no configured rate)', {
        model: input.model, provider: input.provider, billedCostMicros: cost.billedCreditMicros,
      })
    }
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
      // reservationId tags the row to THIS run attempt so the fallback top-up can
      // scope to the current reservation (runId is reused on client-nonce replay).
      metadata: { currency: 'credits', ...(input.reservationId ? { reservationId: input.reservationId } : {}) },
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

  /**
   * Fail-closed billing for a completed run whose usage write failed: a run that
   * already executed must never go free. Charge the per-run hold (worst-case)
   * as a conservative, idempotent debit, then settle the reservation. Tagged
   * source 'pi-chat-fallback' so it's reconcilable against the missing real
   * usage row. Over-charges rather than risk free usage.
   */
  async chargeFallbackUsage(input: { userId: string; runId: string; reservationId?: string }): Promise<void> {
    if (!this.config.enabled) return
    const key = input.reservationId ?? input.runId
    // Durably record the charge intent FIRST (its own committed statement), so if the
    // top-up/settle below fails transiently the reservation stays active+marked and
    // the expiry sweep still charges the hold — a started/no-billable-usage run can't
    // go free on a brief finalization-time DB outage. (Only when the reservation id is
    // known; the runId-only path predates per-reservation marking.)
    if (input.reservationId) {
      await this.store.markReservationFallbackCharge(input.userId, input.reservationId)
    }
    // Top up to the hold, not ON TOP of it: if some usage rows for this attempt
    // were already billed (partial write failure), charge only the missing delta.
    // Scope to the RESERVATION (this attempt) when known — runId is reused on a
    // client-nonce replay, so summing by runId would let a reusing attempt that
    // reports no usage settle free. Fall back to runId only when no reservation.
    const alreadyBilled = input.reservationId
      ? await this.store.billedMicrosForReservation(input.userId, input.reservationId)
      : await this.store.billedMicrosForRun(input.userId, input.runId)
    const topUp = Math.max(0, this.config.runReservationMicros - alreadyBilled)
    if (topUp > 0) {
      await this.store.recordUsage({
        usageId: `usage-fallback:${key}`,
        userId: input.userId,
        runId: input.runId,
        source: 'pi-chat-fallback',
        billedCostMicros: topUp,
        providerCostMicros: 0,
        metadata: { kind: 'usage_write_failed_fallback', reservationId: input.reservationId ?? null, alreadyBilledMicros: alreadyBilled, currency: 'credits' },
      })
    }
    await this.store.finishReservation(
      input.reservationId ? { reservationId: input.reservationId } : { runId: input.runId, userId: input.userId },
      'settled',
    )
    this.log?.('credits: usage write failed/missing — topped up to the hold and settled (reconcile against missing usage)', {
      runId: input.runId, reservationId: input.reservationId, alreadyBilledMicros: alreadyBilled, topUpMicros: topUp,
    })
  }
}
