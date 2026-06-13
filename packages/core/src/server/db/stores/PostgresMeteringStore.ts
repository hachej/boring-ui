import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { creditGrants, creditPurchases, usageLedger, usageReservations } from '../schema.js'

/**
 * Product-neutral credit metering primitives: grants, reservations, and an
 * idempotent usage ledger. All amounts are integer micros of a host-defined
 * currency unit; embedding apps own pricing, currency, and grant policy.
 *
 * Designed as the persistence backend for an AgentMeteringSink
 * (@hachej/boring-agent): reserve before a run executes, record usage rows
 * idempotently as native usage arrives, then settle or release the
 * reservation exactly once. Stale reservations expire without charging.
 * All methods are idempotent so callers may safely retry.
 */

/** The query surface shared by the root db handle and a transaction. */
type Queryable = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update'>

export class InsufficientCreditError extends Error {
  readonly statusCode = 402
  // Matches @hachej/boring-agent's canonical ErrorCode so the agent route
  // preserves it (instead of degrading to INTERNAL_ERROR) when a sink throws
  // this across the boundary.
  readonly code = 'PAYMENT_REQUIRED'

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
  /** Stable run id; at most one active reservation may exist per runId. */
  runId: string
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
  runId?: string
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

export interface FinishReservationInput {
  /** Preferred key: the id returned by reserve(). */
  reservationId?: string
  /** Fallback key; pair with userId to scope across tenants. */
  runId?: string
  userId?: string
}

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

  /**
   * Credit a purchase exactly once GLOBALLY per order id. The order id is the
   * primary key, so a webhook retry or a delivery misrouted to a different user
   * can never double-credit. A per-order advisory lock serializes this against
   * revokePurchase so a refund that arrives BEFORE order_created (out-of-order
   * delivery) leaves a 'refunded' tombstone that blocks this grant — the user
   * never keeps credits for a refunded order. Returns `granted: false` when the
   * order was already processed or has been refunded.
   */
  async grantPurchaseOnce(input: {
    orderId: string
    userId: string
    amountMicros: number
    source?: string
  }): Promise<{ granted: boolean }> {
    if (!input.orderId) throw new Error('grantPurchaseOnce requires an orderId')
    if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0) {
      throw new Error('purchase amountMicros must be a positive integer')
    }
    const source = input.source ?? 'lemonsqueezy'
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${input.orderId}`}))`)
      const existing = await tx
        .select({ status: creditPurchases.status, pendingRefundPpm: creditPurchases.pendingRefundPpm })
        .from(creditPurchases)
        .where(eq(creditPurchases.orderId, input.orderId))
        .limit(1)
      const prior = existing[0]
      // Already granted, or fully refunded (tombstone/transitioned) → never grant.
      if (prior && prior.status !== 'refund_pending') return { granted: false }

      const insertGrant = async () => {
        const grantRows = await tx
          .insert(creditGrants)
          .values({ userId: input.userId, reason: `purchase:${input.orderId}`, amountMicros: input.amountMicros })
          .onConflictDoNothing({ target: [creditGrants.userId, creditGrants.reason] })
          .returning({ id: creditGrants.id })
        // The purchase row was just claimed, so the grant must be fresh. A
        // conflict means a pre-existing grant with this reason (manual import /
        // data repair) — fail loudly rather than record a purchase with no credit.
        if (grantRows.length === 0) {
          throw new Error(`purchase ${input.orderId} claimed but a credit grant already existed`)
        }
      }

      if (prior?.status === 'refund_pending') {
        // A partial refund landed before this grant: mint the full grant, then
        // immediately revoke the pending fraction so the net credit is correct.
        const pendingPpm = prior.pendingRefundPpm ?? 0
        const revoke = Math.min(input.amountMicros, Math.round((input.amountMicros * pendingPpm) / 1_000_000))
        await tx
          .update(creditPurchases)
          .set({ userId: input.userId, amountMicros: input.amountMicros, status: revoke >= input.amountMicros ? 'refunded' : 'granted', pendingRefundPpm: null, refundedMicros: revoke > 0 ? revoke : null, refundedAt: revoke > 0 ? new Date() : null })
          .where(eq(creditPurchases.orderId, input.orderId))
        await insertGrant()
        if (revoke > 0) {
          await tx
            .insert(usageLedger)
            .values({ id: `refund:${input.orderId}:${revoke}`, userId: input.userId, source: 'lemonsqueezy-refund', billedCostMicros: revoke, providerCostMicros: 0, metadata: { kind: 'purchase_refund', orderId: input.orderId, refundedToMicros: revoke, appliedAtGrant: true } })
            .onConflictDoNothing({ target: usageLedger.id })
        }
        return { granted: true }
      }

      await tx.insert(creditPurchases).values({
        orderId: input.orderId,
        userId: input.userId,
        amountMicros: input.amountMicros,
        status: 'granted',
        source,
      })
      await insertGrant()
      return { granted: true }
    })
  }

  /**
   * Revoke a refunded/disputed purchase. Under the same per-order advisory lock
   * as grantPurchaseOnce, supports repeated PARTIAL refunds:
   *  - `refundFraction` is the cumulative fraction of the order (by money) that
   *    has been refunded — i.e. LS `refunded_amount / total` (both tax-inclusive),
   *    which maps the refund onto the same basis as the credited amount. The
   *    revoked credits = round(creditedMicros × fraction), capped at credited.
   *    The method debits only the delta since the last refund. Omit (undefined)
   *    for a full refund of the entire credited amount.
   *  - granted order  → debit the delta, track cumulative `refunded_micros`, and
   *    mark 'refunded' once fully revoked; returns revoked=true when a debit was
   *    posted.
   *  - not yet seen   → write a 'refunded' tombstone so a later order_created
   *    cannot grant; returns revoked=false (nothing was credited yet).
   *  - already fully refunded / no new delta → no-op; returns revoked=false.
   */
  async revokePurchase(
    orderId: string,
    opts: { refundFraction?: number; source?: string } = {},
  ): Promise<{ revoked: boolean }> {
    if (!orderId) throw new Error('revokePurchase requires an orderId')
    const source = opts.source ?? 'lemonsqueezy-refund'
    if (opts.refundFraction !== undefined && (!Number.isFinite(opts.refundFraction) || opts.refundFraction < 0)) {
      throw new Error('revokePurchase refundFraction must be a non-negative number')
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${orderId}`}))`)
      const existing = await tx
        .select({
          userId: creditPurchases.userId,
          amountMicros: creditPurchases.amountMicros,
          status: creditPurchases.status,
          refundedMicros: creditPurchases.refundedMicros,
        })
        .from(creditPurchases)
        .where(eq(creditPurchases.orderId, orderId))
        .limit(1)
      const fraction = opts.refundFraction ?? 1
      const row = existing[0]
      if (!row) {
        // Refund before grant (out-of-order delivery). A FULL refund writes a
        // terminal 'refunded' tombstone (the order must never be credited). A
        // PARTIAL refund records the pending fraction as 'refund_pending' so the
        // later order_created grants NET of it — neither losing the refund nor
        // blocking the whole purchase.
        await tx.insert(creditPurchases).values(
          fraction >= 1
            ? { orderId, status: 'refunded', source, refundedAt: new Date() }
            : { orderId, status: 'refund_pending', source, refundedAt: new Date(), pendingRefundPpm: Math.round(fraction * 1_000_000) },
        )
        return { revoked: false }
      }
      const credited = row.amountMicros ?? 0
      const alreadyRefunded = row.refundedMicros ?? 0
      // Cumulative revoked amount on the credited (pre-tax) basis, capped at
      // what was credited. A full refund (fraction undefined or ≥1) revokes all.
      const target = Math.min(credited, Math.round(credited * Math.min(1, fraction)))
      const delta = target - alreadyRefunded
      const fullyRefunded = target >= credited
      if (delta <= 0) {
        // No new amount to revoke; still ensure status reflects a full refund.
        if (fullyRefunded && row.status !== 'refunded') {
          await tx.update(creditPurchases).set({ status: 'refunded', refundedAt: new Date() }).where(eq(creditPurchases.orderId, orderId))
        }
        return { revoked: false }
      }
      // Post the incremental debit (idempotent per cumulative level).
      const debit = await tx
        .insert(usageLedger)
        .values({
          id: `refund:${orderId}:${target}`,
          userId: row.userId!,
          source,
          billedCostMicros: delta,
          providerCostMicros: 0,
          metadata: { kind: 'purchase_refund', orderId, refundedToMicros: target },
        })
        .onConflictDoNothing({ target: usageLedger.id })
        .returning({ id: usageLedger.id })
      await tx
        .update(creditPurchases)
        .set({ refundedMicros: target, status: fullyRefunded ? 'refunded' : row.status, refundedAt: new Date() })
        .where(eq(creditPurchases.orderId, orderId))
      return { revoked: debit.length > 0 }
    })
  }

  async getBalance(userId: string, now: Date = new Date()): Promise<MeteringBalance> {
    return this.computeBalance(this.db, userId, now)
  }

  /**
   * Reserve credit for a run. Serialized per user (advisory transaction
   * lock) so concurrent reservations cannot jointly overdraw. Idempotent per
   * runId: re-reserving while a reservation is still active returns the
   * existing reservation instead of double-holding. Throws
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
    if (input.minAvailableMicros !== undefined && (!Number.isSafeInteger(input.minAvailableMicros) || input.minAvailableMicros < 0)) {
      // This is the hard-stop floor; a NaN/negative value would silently weaken
      // the admission check.
      throw new Error('reserve minAvailableMicros must be a non-negative integer')
    }
    const minAvailable = input.minAvailableMicros ?? input.amountMicros
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`)

      // Demote the user's expired-but-still-active rows before reusing or
      // inserting. Otherwise the idempotent lookup could return an expired
      // reservation (which computeBalance no longer counts) — letting a retry
      // run without re-checking the balance, i.e. bypassing the hard stop.
      await tx
        .update(usageReservations)
        .set({ status: 'expired' })
        .where(and(
          eq(usageReservations.userId, input.userId),
          eq(usageReservations.status, 'active'),
          lte(usageReservations.expiresAt, now),
        ))

      const existing = await tx
        .select({ id: usageReservations.id })
        .from(usageReservations)
        .where(and(
          eq(usageReservations.runId, input.runId),
          eq(usageReservations.userId, input.userId),
          eq(usageReservations.status, 'active'),
        ))
        .limit(1)
      const existingId = existing[0]?.id
      if (existingId) return { reservationId: existingId }

      const balance = await this.computeBalance(tx, input.userId, now)
      if (balance.availableMicros < minAvailable) {
        throw new InsufficientCreditError(balance.availableMicros, minAvailable)
      }
      const rows = await tx
        .insert(usageReservations)
        .values({
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          sessionId: input.sessionId ?? null,
          runId: input.runId,
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
        runId: input.runId ?? null,
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
   * Finish a reservation. Settling also recovers reservations that expired
   * before a delayed settlement retry, so charged usage never leaves a
   * reservation dangling. Releasing only touches active rows. Idempotent:
   * repeat calls are no-ops.
   *
   * A runId may have more than one row (an expired row plus a fresh active
   * retry), so the runId fallback resolves to the single newest matching row
   * — a settle never flips both the dead and the live reservation together.
   */
  async finishReservation(input: FinishReservationInput, status: ReservationFinalStatus): Promise<{ updated: boolean }> {
    if (!input.reservationId && !input.runId) {
      throw new Error('finishReservation requires reservationId or runId')
    }
    // runId is not globally unique per tenant, so a runId-keyed finish must be
    // scoped by userId to avoid touching another user's reservation.
    if (!input.reservationId && !input.userId) {
      throw new Error('finishReservation by runId requires userId')
    }
    const matchable = status === 'settled' ? ['active', 'expired'] : ['active']

    let targetId = input.reservationId
    if (!targetId) {
      const lookup = [
        eq(usageReservations.runId, input.runId as string),
        inArray(usageReservations.status, matchable),
      ]
      if (input.userId) lookup.push(eq(usageReservations.userId, input.userId))
      const found = await this.db
        .select({ id: usageReservations.id })
        .from(usageReservations)
        .where(and(...lookup))
      if (found.length === 0) return { updated: false }
      // A reused runId can have several finishable rows (e.g. an expired row
      // plus a fresh active retry). Picking one blindly could settle the wrong
      // hold, so demand the unambiguous reservationId instead.
      if (found.length > 1) {
        throw new Error('finishReservation by runId is ambiguous (multiple rows); pass reservationId')
      }
      targetId = found[0]?.id
      if (!targetId) return { updated: false }
    }

    const conditions = [eq(usageReservations.id, targetId), inArray(usageReservations.status, matchable)]
    if (input.userId) conditions.push(eq(usageReservations.userId, input.userId))

    const rows = await this.db
      .update(usageReservations)
      .set({ status })
      .where(and(...conditions))
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

  private async computeBalance(executor: Queryable, userId: string, now: Date): Promise<MeteringBalance> {
    const [granted, used, reserved] = await Promise.all([
      this.sumGrants(executor, userId, now),
      this.sumUsage(executor, userId),
      this.sumActiveReservations(executor, userId, now),
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

  private async sumGrants(executor: Queryable, userId: string, now: Date): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`coalesce(sum(${creditGrants.amountMicros}), 0)` })
      .from(creditGrants)
      .where(and(eq(creditGrants.userId, userId), or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, now))))
    return toSafeMicros(rows[0]?.total, 'grant total')
  }

  private async sumUsage(executor: Queryable, userId: string): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`coalesce(sum(${usageLedger.billedCostMicros}), 0)` })
      .from(usageLedger)
      .where(eq(usageLedger.userId, userId))
    return toSafeMicros(rows[0]?.total, 'usage total')
  }

  private async sumActiveReservations(executor: Queryable, userId: string, now: Date): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`coalesce(sum(${usageReservations.amountMicros}), 0)` })
      .from(usageReservations)
      .where(
        and(
          eq(usageReservations.userId, userId),
          eq(usageReservations.status, 'active'),
          gt(usageReservations.expiresAt, now),
        ),
      )
    return toSafeMicros(rows[0]?.total, 'active reservation total')
  }
}

/**
 * Postgres returns bigint sums as strings. Parse to number but fail closed
 * above MAX_SAFE_INTEGER rather than silently rounding — a rounded balance
 * could let the hard-stop comparison admit or reject reservations wrongly.
 */
function toSafeMicros(value: string | undefined, label: string): number {
  const parsed = BigInt(value ?? '0')
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`metering ${label} exceeds the safe integer range (${parsed})`)
  }
  return Number(parsed)
}
