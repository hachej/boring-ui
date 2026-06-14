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
 * reservation exactly once. A stale reservation with positive billed usage or a
 * durable charge-on-expire marker (the run did chargeable work but never settled)
 * is CHARGED up to its hold on expiry; one with only zero-billed rows and no marker
 * (a non-billable / pre-execution abandon) expires free. All methods are idempotent
 * so callers may safely retry.
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
    storeId?: string
    testMode?: boolean
    currency?: string
    variantId?: string
  }): Promise<{ granted: boolean }> {
    if (!input.orderId) throw new Error('grantPurchaseOnce requires an orderId')
    if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros <= 0) {
      throw new Error('purchase amountMicros must be a positive integer')
    }
    const source = input.source ?? 'lemonsqueezy'
    const identity = { storeId: input.storeId ?? null, testMode: input.testMode ?? null, currency: input.currency ?? null, variantId: input.variantId ?? null }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${input.orderId}`}))`)
      const existing = await tx
        .select({
          status: creditPurchases.status,
          userId: creditPurchases.userId,
          amountMicros: creditPurchases.amountMicros,
          pendingRefundPpm: creditPurchases.pendingRefundPpm,
          storeId: creditPurchases.storeId,
          testMode: creditPurchases.testMode,
          currency: creditPurchases.currency,
          variantId: creditPurchases.variantId,
        })
        .from(creditPurchases)
        .where(eq(creditPurchases.orderId, input.orderId))
        .limit(1)
      const prior = existing[0]
      // Already granted, or fully refunded (tombstone/transitioned) → never grant.
      if (prior && prior.status !== 'refund_pending') {
        // A retry must carry the SAME user, amount, AND provider identity. Any
        // mismatch means an attribution bug or a reused/misrouted order id —
        // surface it loudly rather than silently 200-ack accounting corruption.
        if (
          prior.status === 'granted' &&
          (prior.userId !== input.userId ||
            prior.amountMicros !== input.amountMicros ||
            prior.storeId !== (input.storeId ?? null) ||
            prior.testMode !== (input.testMode ?? null) ||
            prior.currency !== (input.currency ?? null) ||
            prior.variantId !== (input.variantId ?? null))
        ) {
          throw new Error(
            `purchase ${input.orderId} already granted (user ${prior.userId}, ${prior.amountMicros} micros, ` +
              `store ${prior.storeId}, testMode ${prior.testMode}, variant ${prior.variantId}); ` +
              `refusing conflicting re-grant (user ${input.userId}, ${input.amountMicros} micros, ` +
              `store ${input.storeId ?? null}, testMode ${input.testMode ?? null}, variant ${input.variantId ?? null})`,
          )
        }
        return { granted: false }
      }

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
          .set({ userId: input.userId, amountMicros: input.amountMicros, status: revoke >= input.amountMicros ? 'refunded' : 'granted', pendingRefundPpm: null, refundedMicros: revoke > 0 ? revoke : null, refundedAt: revoke > 0 ? new Date() : null, ...identity })
          .where(eq(creditPurchases.orderId, input.orderId))
        await insertGrant()
        if (revoke > 0) {
          await this.insertVerifiedLedgerDebit(tx, {
            id: `refund:${input.orderId}:${revoke}`,
            userId: input.userId,
            amountMicros: revoke,
            metadata: { kind: 'purchase_refund', orderId: input.orderId, refundedToMicros: revoke, appliedAtGrant: true },
          })
        }
        return { granted: true }
      }

      await tx.insert(creditPurchases).values({
        orderId: input.orderId,
        userId: input.userId,
        amountMicros: input.amountMicros,
        status: 'granted',
        source,
        ...identity,
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
    opts: { refundFraction?: number; source?: string; allowTombstone?: boolean; expectedStoreId?: string; expectedTestMode?: boolean; expectedCurrency?: string } = {},
  ): Promise<{ revoked: boolean }> {
    if (!orderId) throw new Error('revokePurchase requires an orderId')
    const source = opts.source ?? 'lemonsqueezy-refund'
    // A pre-grant tombstone is written only when the caller EXPLICITLY vouches the
    // refund is for a credit order (variant/store/mode). Default false (fail
    // closed): an admin/manual/future caller that forgets the gate can't tombstone
    // an unknown order and block a legitimate later grant. An order we ALREADY
    // credited is revoked regardless of this flag.
    const allowTombstone = opts.allowTombstone === true
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
          pendingRefundPpm: creditPurchases.pendingRefundPpm,
          storeId: creditPurchases.storeId,
          testMode: creditPurchases.testMode,
          currency: creditPurchases.currency,
        })
        .from(creditPurchases)
        .where(eq(creditPurchases.orderId, orderId))
        .limit(1)
      const fraction = opts.refundFraction ?? 1
      const row = existing[0]
      if (!row) {
        // Refund before grant (out-of-order delivery), or a refund for an order
        // we never credited. Only write a tombstone when the caller vouched the
        // refund is for a credit order — otherwise ignore it (don't let an
        // unrelated/cross-store refund tombstone a future order by id).
        if (!allowTombstone) return { revoked: false }
        // A FULL refund writes a terminal 'refunded' tombstone (never credit it).
        // A PARTIAL refund records the pending fraction as 'refund_pending' so the
        // later order_created grants NET of it. Capture the refund's store/mode on
        // the tombstone for reconcile/audit.
        const tombstoneIdentity = { storeId: opts.expectedStoreId ?? null, testMode: opts.expectedTestMode ?? null }
        await tx.insert(creditPurchases).values(
          fraction >= 1
            ? { orderId, status: 'refunded', source, refundedAt: new Date(), ...tombstoneIdentity }
            : { orderId, status: 'refund_pending', source, refundedAt: new Date(), pendingRefundPpm: Math.round(fraction * 1_000_000), ...tombstoneIdentity },
        )
        return { revoked: false }
      }
      // A second pre-grant refund (the row exists but the grant hasn't landed, so
      // the credited amount is still unknown). Don't fall through to the
      // credited-amount math (credited=0 would wrongly mark it fully refunded and
      // block the grant) — accumulate the pending fraction instead.
      if (row.status === 'refund_pending') {
        if (fraction >= 1) {
          await tx.update(creditPurchases).set({ status: 'refunded', pendingRefundPpm: null, refundedAt: new Date() }).where(eq(creditPurchases.orderId, orderId))
        } else {
          // LS refunded_amount is cumulative → keep the largest fraction seen.
          const newPpm = Math.max(row.pendingRefundPpm ?? 0, Math.round(fraction * 1_000_000))
          await tx.update(creditPurchases).set({ pendingRefundPpm: newPpm, refundedAt: new Date() }).where(eq(creditPurchases.orderId, orderId))
        }
        return { revoked: false }
      }
      // Backstop beyond the per-store/mode webhook secret + the handler's payload
      // identity gate: a credited row's stored identity must match the configured
      // expected identity. A mismatch here is anomalous (data corruption / a
      // changed config revoking an order credited under different settings) — THROW
      // so it surfaces as a retryable 500/alert rather than a silent
      // already-credited-but-not-revoked no-op.
      if (
        (row.storeId != null && opts.expectedStoreId != null && row.storeId !== opts.expectedStoreId) ||
        (row.testMode != null && opts.expectedTestMode != null && row.testMode !== opts.expectedTestMode) ||
        (row.currency != null && opts.expectedCurrency != null && row.currency.toUpperCase() !== opts.expectedCurrency.toUpperCase())
      ) {
        throw new Error(`refund identity mismatch for ${orderId}: credited row (store=${row.storeId}, testMode=${row.testMode}, currency=${row.currency}) does not match expected (store=${opts.expectedStoreId}, testMode=${opts.expectedTestMode}, currency=${opts.expectedCurrency})`)
      }
      // Take the per-user advisory lock (the same one reserve() and the expiry
      // top-up take) so the refund debit is serialized with run admission and is
      // durably recorded against the balance. NOTE: this does NOT prevent a run
      // that was ALREADY admitted (reserve completed just before this lock) from
      // running on credits this refund removes — that run posts its usage and the
      // refund debit drives the balance negative, i.e. recoverable DEBT (surfaced
      // as debtMicros and blocking the next run), not free credits. Safe vs
      // deadlock: reserve takes only the user lock; this path already holds the
      // per-order lock and never blocks on a lock reserve wants.
      if (row.userId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${row.userId}))`)
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
      // Post the incremental debit (idempotent per cumulative level), verifying
      // any pre-existing row at this id matches before we mark the purchase
      // refunded (else we'd record a refund the balance was never debited for).
      const inserted = await this.insertVerifiedLedgerDebit(tx, {
        id: `refund:${orderId}:${target}`,
        userId: row.userId!,
        amountMicros: delta,
        source,
        metadata: { kind: 'purchase_refund', orderId, refundedToMicros: target },
      })
      await tx
        .update(creditPurchases)
        .set({ refundedMicros: target, status: fullyRefunded ? 'refunded' : row.status, refundedAt: new Date() })
        .where(eq(creditPurchases.orderId, orderId))
      return { revoked: inserted }
    })
  }

  /**
   * Insert a refund debit idempotently by id. If the id already exists (manual
   * repair / corrupted retry), VERIFY the existing row is the same debit (user +
   * amount) — throw on mismatch so a caller never records a refund the balance was
   * not actually debited for. Returns true iff a new debit row was written.
   */
  private async insertVerifiedLedgerDebit(
    tx: Queryable,
    input: { id: string; userId: string; amountMicros: number; source?: string; runId?: string; metadata: Record<string, unknown> },
  ): Promise<boolean> {
    const rows = await tx
      .insert(usageLedger)
      .values({
        id: input.id,
        userId: input.userId,
        runId: input.runId ?? null,
        source: input.source ?? 'lemonsqueezy-refund',
        billedCostMicros: input.amountMicros,
        providerCostMicros: 0,
        metadata: input.metadata,
      })
      .onConflictDoNothing({ target: usageLedger.id })
      .returning({ id: usageLedger.id })
    if (rows.length > 0) return true
    const existing = await tx
      .select({ userId: usageLedger.userId, billedCostMicros: usageLedger.billedCostMicros })
      .from(usageLedger)
      .where(eq(usageLedger.id, input.id))
      .limit(1)
    const e = existing[0]
    if (!e || e.userId !== input.userId || e.billedCostMicros !== input.amountMicros) {
      throw new Error(`ledger debit conflict for ${input.id}: existing debit does not match (refusing to record a debit that wasn't actually applied)`)
    }
    return false
  }

  /** Total billed micros already recorded for a run (for fallback top-up so a
   * partial-success run isn't charged the hold ON TOP of its real usage). */
  async billedMicrosForRun(userId: string, runId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${usageLedger.billedCostMicros}), 0)` })
      .from(usageLedger)
      .where(and(eq(usageLedger.userId, userId), eq(usageLedger.runId, runId)))
    return Number(rows[0]?.total ?? 0)
  }

  /** Total billed micros for a specific RESERVATION (run attempt). Preferred over
   * billedMicrosForRun for fallback top-up: runId is reused on client-nonce
   * replay, so summing by runId would count a prior attempt's billing and let a
   * later reusing attempt settle free. */
  async billedMicrosForReservation(userId: string, reservationId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${usageLedger.billedCostMicros}), 0)` })
      .from(usageLedger)
      .where(and(eq(usageLedger.userId, userId), sql`${usageLedger.metadata}->>'reservationId' = ${reservationId}`))
    return Number(rows[0]?.total ?? 0)
  }

  /** Durably record that an ACTIVE reservation must be charged the fallback hold if
   * it expires, BEFORE attempting the actual fallback charge. Committed on its own so
   * the intent survives a subsequent failed charge write — the expiry sweep then
   * charges a marked reservation even with zero billed rows (no free started run on a
   * brief finalization-time DB outage). Idempotent; a no-op on a non-active row. */
  async markReservationFallbackCharge(userId: string, reservationId: string): Promise<void> {
    await this.db
      .update(usageReservations)
      .set({ chargeOnExpire: true })
      .where(and(eq(usageReservations.id, reservationId), eq(usageReservations.userId, userId), eq(usageReservations.status, 'active')))
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

      // Expire the user's stale rows before reusing or inserting — through the
      // SAME charge-aware helper as expireStaleReservations (we already hold the
      // user lock here), so an executed-but-unsettled run is charged on expiry
      // rather than freed. Otherwise the idempotent lookup could return an expired
      // reservation (which computeBalance no longer counts), bypassing the hard stop.
      await this.expireUserStaleReservations(tx, input.userId, now)

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
    if (rows.length > 0) return { inserted: true }
    // The usage id already existed. A genuine idempotent retry carries the SAME
    // user + amount; a COLLISION (a reused message id with different usage) would
    // otherwise be silently dropped and the run settled free. Verify and THROW on
    // mismatch so the coordinator's fallback-charge path runs instead.
    const existing = await this.db
      .select({ userId: usageLedger.userId, runId: usageLedger.runId, billedCostMicros: usageLedger.billedCostMicros, reservationId: sql<string | null>`${usageLedger.metadata}->>'reservationId'` })
      .from(usageLedger)
      .where(eq(usageLedger.id, input.usageId))
      .limit(1)
    const e = existing[0]
    const incomingReservationId = (input.metadata?.reservationId as string | undefined) ?? null
    if (!e || e.userId !== input.userId || e.runId !== (input.runId ?? null) || e.billedCostMicros !== input.billedCostMicros || e.reservationId !== incomingReservationId) {
      throw new Error(`usage ledger id collision for ${input.usageId}: existing row does not match this usage (refusing to silently drop the debit)`)
    }
    return { inserted: false }
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

    // Run under the user's advisory lock so a settle/release is serialized with
    // reserve() and the charge-on-expire sweep — an expiry sweep can't overwrite
    // a concurrently-settled row (or vice versa) and overcharge.
    return this.db.transaction(async (tx) => {
      let userId = input.userId
      if (!userId && input.reservationId) {
        const owner = await tx
          .select({ userId: usageReservations.userId })
          .from(usageReservations)
          .where(eq(usageReservations.id, input.reservationId))
          .limit(1)
        userId = owner[0]?.userId
      }
      if (userId) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`)

      let targetId = input.reservationId
      if (!targetId) {
        const lookup = [
          eq(usageReservations.runId, input.runId as string),
          inArray(usageReservations.status, matchable),
        ]
        if (input.userId) lookup.push(eq(usageReservations.userId, input.userId))
        const found = await tx
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

      const rows = await tx
        .update(usageReservations)
        .set({ status })
        .where(and(...conditions))
        .returning({ id: usageReservations.id })
      return { updated: rows.length > 0 }
    })
  }

  /** Expire stale active reservations without charging. Returns the count. */
  async expireStaleReservations(now: Date = new Date()): Promise<number> {
    // Process per user under that user's advisory lock (the same lock reserve()
    // and revokePurchase() take), so an expiry top-up debit can't race a
    // concurrent admission into overdrawing past the hard stop.
    const users = await this.db
      .selectDistinct({ userId: usageReservations.userId })
      .from(usageReservations)
      .where(and(eq(usageReservations.status, 'active'), lt(usageReservations.expiresAt, now)))
    let total = 0
    for (const { userId } of users) {
      total += await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`)
        return this.expireUserStaleReservations(tx, userId, now)
      })
    }
    return total
  }

  /**
   * Expire one user's stale active reservations under the SINGLE charge-aware
   * policy. CALLER MUST already hold pg_advisory_xact_lock(hashtext(userId)).
   * A reservation that reached TTL without an explicit settle/release had a failed
   * finalization: if it has POSITIVE billed usage (`billedTotal > 0`) OR carries the
   * durable `charge_on_expire` marker, the run did chargeable work, so top it up to
   * the hold (idempotent) rather than free it; a reservation with only zero-billed
   * rows and no marker is a non-billable/pre-execution abandon and is freed (so a
   * user who closed the tab isn't over-charged).
   */
  private async expireUserStaleReservations(tx: Queryable, userId: string, now: Date): Promise<number> {
    // Atomically CLAIM the stale rows (active → expired, RETURNING) before
    // charging: whoever flips the row status first wins, so a concurrent
    // finishReservation (settle/release) can't be overwritten and a settled run
    // can't be charged the hold. (Both paths also hold this user's advisory lock.)
    const stale = await tx
      .update(usageReservations)
      .set({ status: 'expired' })
      .where(and(eq(usageReservations.userId, userId), eq(usageReservations.status, 'active'), lte(usageReservations.expiresAt, now)))
      .returning({ id: usageReservations.id, runId: usageReservations.runId, amountMicros: usageReservations.amountMicros, chargeOnExpire: usageReservations.chargeOnExpire })
    for (const r of stale) {
      const usage = await tx
        .select({ total: sql<string>`coalesce(sum(${usageLedger.billedCostMicros}), 0)` })
        .from(usageLedger)
        .where(and(eq(usageLedger.userId, userId), sql`${usageLedger.metadata}->>'reservationId' = ${r.id}`))
      const billedTotal = Number(usage[0]?.total ?? 0)
      // Charge-on-expire when the reservation has BILLABLE usage (a real debit
      // exists), OR carries a durable fallback-charge marker (the coordinator decided
      // this run must be charged but its charge write failed transiently). NOT on mere
      // row existence: a run that wrote only zero-token usage rows and was NOT marked
      // did no billable work, so it stays free even if its terminal release was lost
      // (e.g. a user abort whose releaseRun failed). Charging the full hold for a
      // non-billable, non-marked run would over-charge real money. The marker closes
      // the inverse gap: a started/successful run with no billable row whose fallback
      // charge failed would otherwise go free here.
      const executed = billedTotal > 0 || r.chargeOnExpire
      if (executed) {
        const topUp = Math.max(0, r.amountMicros - billedTotal)
        if (topUp > 0) {
          // Verified insert: if usage-fallback:<reservationId> already exists (the
          // sink's usage-write-failed fallback charged it), it must match — a
          // mismatch throws rather than silently leaving the reservation expired
          // with a wrong/no debit.
          await this.insertVerifiedLedgerDebit(tx, {
            id: `usage-fallback:${r.id}`,
            userId,
            runId: r.runId,
            amountMicros: topUp,
            source: 'pi-chat-expired',
            metadata: { kind: 'reservation_expired_fallback', reservationId: r.id },
          })
        }
      }
    }
    return stale.length // already marked expired by the atomic claim above
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
