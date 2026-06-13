import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { creditGrants, usageLedger, usageReservations } from '../schema.js'

/**
 * Product-neutral credit metering primitives: grants, reservations, and an
 * idempotent usage ledger. All amounts are integer micros of a host-defined
 * currency unit; embedding apps own pricing, currency, and grant policy.
 *
 * Designed as the persistence backend for an AgentMeteringSink
 * (@hachej/boring-agent): reserve before a run executes, record usage rows
 * idempotently as native usage arrives, then settle or release the
 * reservation exactly once. Stale reservations expire without charging.
 */

export class InsufficientCreditError extends Error {
  readonly statusCode = 402
  readonly code = 'INSUFFICIENT_CREDIT'

  constructor(
    readonly availableMicros: number,
    readonly requiredMicros: number,
  ) {
    super('insufficient credit')
    this.name = 'InsufficientCreditError'
  }
}

export interface MeteringBalance {
  userId: string
  grantedMicros: number
  usedMicros: number
  remainingMicros: number
  activeReservedMicros: number
  /** remainingMicros minus activeReservedMicros; what a new reservation sees. */
  availableMicros: number
}

export interface GrantOnceInput {
  userId: string
  /** Unique per (userId, reason); repeat calls with the same reason are no-ops. */
  reason: string
  amountMicros: number
  expiresAt?: Date
}

export interface ReserveInput {
  userId: string
  workspaceId?: string
  sessionId?: string
  /** Stable run id; at most one active reservation may exist per turnId. */
  turnId: string
  source?: string
  amountMicros: number
  ttlSeconds: number
  /**
   * Reject when the user's available balance (remaining minus active
   * reservations) is below this floor. Defaults to amountMicros, i.e. the
   * reservation must fit entirely.
   */
  minAvailableMicros?: number
}

export interface ReserveResult {
  reservationId: string
}

export interface RecordUsageInput {
  /** Stable idempotency key; a second insert with the same id is a no-op. */
  usageId: string
  userId: string
  workspaceId?: string
  sessionId?: string
  turnId?: string
  messageId?: string
  source?: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Provider-reported cost, in micros, before host pricing policy. */
  providerCostMicros?: number
  /** Host-priced cost actually charged against the balance. */
  billedCostMicros: number
  stopReason?: string
  metadata?: Record<string, unknown>
}

export interface RecordUsageResult {
  inserted: boolean
}

export type ReservationFinalStatus = 'settled' | 'released'

export class PostgresMeteringStore {
  constructor(private db: PostgresJsDatabase) {}

  /** Idempotently create a grant keyed by (userId, reason). */
  async grantOnce(input: GrantOnceInput): Promise<{ created: boolean }> {
    if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0) {
      throw new Error('grant amountMicros must be a positive integer')
    }
    const rows = await this.db
      .insert(creditGrants)
      .values({
        userId: input.userId,
        reason: input.reason,
        amountMicros: input.amountMicros,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoNothing({ target: [creditGrants.userId, creditGrants.reason] })
      .returning({ id: creditGrants.id })
    return { created: rows.length > 0 }
  }

  async getBalance(userId: string, now: Date = new Date()): Promise<MeteringBalance> {
    const [granted, used, reserved] = await Promise.all([
      this.sumGrants(userId, now),
      this.sumUsage(userId),
      this.sumActiveReservations(userId, now),
    ])
    const remainingMicros = granted - used
    return {
      userId,
      grantedMicros: granted,
      usedMicros: used,
      remainingMicros,
      activeReservedMicros: reserved,
      availableMicros: remainingMicros - reserved,
    }
  }

  /**
   * Reserve credit for a run. Serialized per user (advisory transaction
   * lock) so concurrent reservations cannot jointly overdraw. Throws
   * InsufficientCreditError when the available balance is below
   * minAvailableMicros (default: the reservation amount itself).
   */
  async reserve(input: ReserveInput, now: Date = new Date()): Promise<ReserveResult> {
    if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0) {
      throw new Error('reserve amountMicros must be a positive integer')
    }
    if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
      throw new Error('reserve ttlSeconds must be positive')
    }
    const minAvailable = input.minAvailableMicros ?? input.amountMicros
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`)
      const store = new PostgresMeteringStore(tx as unknown as PostgresJsDatabase)
      const balance = await store.getBalance(input.userId, now)
      if (balance.availableMicros < minAvailable) {
        throw new InsufficientCreditError(balance.availableMicros, minAvailable)
      }
      const rows = await tx
        .insert(usageReservations)
        .values({
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          sessionId: input.sessionId ?? null,
          turnId: input.turnId,
          source: input.source ?? '',
          amountMicros: input.amountMicros,
          status: 'active',
          expiresAt,
        })
        .returning({ id: usageReservations.id })
      const reservationId = rows[0]?.id
      if (!reservationId) throw new Error('reservation insert returned no id')
      return { reservationId }
    })
  }

  /** Idempotent ledger insert; returns whether a new row was written. */
  async recordUsage(input: RecordUsageInput): Promise<RecordUsageResult> {
    if (!Number.isSafeInteger(input.billedCostMicros) || input.billedCostMicros < 0) {
      throw new Error('billedCostMicros must be a non-negative integer')
    }
    const rows = await this.db
      .insert(usageLedger)
      .values({
        id: input.usageId,
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        sessionId: input.sessionId ?? null,
        turnId: input.turnId ?? null,
        messageId: input.messageId ?? null,
        source: input.source ?? '',
        provider: input.provider ?? null,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTokens ?? 0,
        providerCostMicros: input.providerCostMicros ?? 0,
        billedCostMicros: input.billedCostMicros,
        stopReason: input.stopReason ?? null,
        metadata: input.metadata ?? {},
      })
      .onConflictDoNothing({ target: usageLedger.id })
      .returning({ id: usageLedger.id })
    return { inserted: rows.length > 0 }
  }

  /**
   * Finish the active reservation for a run. Settling also recovers
   * reservations that expired before a delayed settlement retry, so charged
   * usage never leaves a reservation dangling. Releasing only touches active
   * rows. Idempotent: repeat calls are no-ops.
   */
  async finishReservation(turnId: string, status: ReservationFinalStatus): Promise<{ updated: boolean }> {
    const matchable = status === 'settled' ? ['active', 'expired'] : ['active']
    const rows = await this.db
      .update(usageReservations)
      .set({ status })
      .where(and(eq(usageReservations.turnId, turnId), inArray(usageReservations.status, matchable)))
      .returning({ id: usageReservations.id })
    return { updated: rows.length > 0 }
  }

  /** Expire stale active reservations without charging. Returns the count. */
  async expireStaleReservations(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .update(usageReservations)
      .set({ status: 'expired' })
      .where(and(eq(usageReservations.status, 'active'), lt(usageReservations.expiresAt, now)))
      .returning({ id: usageReservations.id })
    return rows.length
  }

  private async sumGrants(userId: string, now: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${creditGrants.amountMicros}), 0)` })
      .from(creditGrants)
      .where(and(eq(creditGrants.userId, userId), or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now))))
    return Number(rows[0]?.total ?? 0)
  }

  private async sumUsage(userId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${usageLedger.billedCostMicros}), 0)` })
      .from(usageLedger)
      .where(eq(usageLedger.userId, userId))
    return Number(rows[0]?.total ?? 0)
  }

  private async sumActiveReservations(userId: string, now: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${usageReservations.amountMicros}), 0)` })
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.userId, userId),
          eq(usageReservations.status, 'active'),
          gt(usageReservations.expiresAt, now),
        ),
      )
    return Number(rows[0]?.total ?? 0)
  }
}
