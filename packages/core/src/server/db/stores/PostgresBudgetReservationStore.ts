import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

type BudgetDatabase = PostgresJsDatabase<Record<string, unknown>>
import { budgetReservations, usageLedger } from '../schema.js'
import { assertPositiveSafeInteger, chunkIds, lockBudgetTargets, monthPeriodUtc } from './BudgetReservationSupport.js'
import { computeBudgetSpend } from './BudgetSpendAttribution.js'

export type BudgetReservationStatus = 'active' | 'settled' | 'released' | 'expired'
export type BudgetReservationScope = 'model' | 'user'

export class ModelBudgetExceededError extends Error {
  readonly statusCode = 402
  readonly code = 'MODEL_BUDGET_EXCEEDED'

  constructor(
    readonly usedMicros: number,
    readonly heldMicros: number,
    readonly budgetMicros: number,
    readonly requestedMicros: number,
  ) {
    super('Budget reached for this model.')
    this.name = 'ModelBudgetExceededError'
  }
}

export class UserBudgetExceededError extends Error {
  readonly statusCode = 402
  readonly code = 'MODEL_BUDGET_EXCEEDED'

  constructor(
    readonly usedMicros: number,
    readonly heldMicros: number,
    readonly budgetMicros: number,
    readonly requestedMicros: number,
  ) {
    super('Budget reached for this user.')
    this.name = 'UserBudgetExceededError'
  }
}

interface ReserveBudgetBaseInput {
  userId: string
  workspaceId?: string
  sessionId?: string
  runId: string
  budgetMicros: number
  holdMicros: number
  ttlSeconds: number
  now?: Date
}

export type ReserveBudgetInput =
  | (ReserveBudgetBaseInput & { scope: 'user'; provider?: never; model?: never })
  | (ReserveBudgetBaseInput & { scope: 'model'; provider: string; model: string })

export interface ReserveModelBudgetInput extends ReserveBudgetBaseInput {
  provider: string
  model: string
}

export interface ReserveBudgetResult {
  scope: BudgetReservationScope
  reservationId: string
  created: boolean
  period: string
}

export type BudgetSpendQuery =
  | { scope: 'user'; userId: string; now?: Date }
  | { scope: 'model'; userId: string; provider: string; model: string; now?: Date }

export interface BudgetSpendSnapshot {
  scope: BudgetReservationScope
  /** Settled usage (ledger + settled fallback reservations) in micros for the current period. */
  usedMicros: number
  /** In-flight active holds in micros for the current period. */
  heldMicros: number
  /** Period key (e.g. "2026-07"). */
  period: string
  /** Inclusive UTC start of the current budget period. */
  periodStart: Date
  /** Exclusive UTC end of the current budget period == the reset boundary. */
  periodEnd: Date
}

export interface BudgetReservationAdmissionInput {
  user?: Extract<ReserveBudgetInput, { scope: 'user' }>
  model: Extract<ReserveBudgetInput, { scope: 'model' }>
}

export interface BudgetReservationAdmission {
  user?: ReserveBudgetResult & { scope: 'user' }
  model: ReserveBudgetResult & { scope: 'model' }
}

export type ReserveModelBudgetResult = ReserveBudgetResult

export interface FinishReservationInput {
  scope: BudgetReservationScope
  reservationId?: string
  runId?: string
  userId?: string
}

export interface FinishModelBudgetReservationInput {
  scope?: 'model'
  reservationId?: string
  runId?: string
  userId?: string
}

type BudgetLockTarget = { scope: BudgetReservationScope; userId: string; provider?: string | null; model?: string | null; period: string }
type BudgetReservationRow = BudgetLockTarget & { id: string }

function toBudgetReservationRow(row: { id: string; scope: string; userId: string; provider?: string | null; model?: string | null; period: string }): BudgetReservationRow {
  if (row.scope !== 'model' && row.scope !== 'user') throw new Error(`invalid budget reservation scope: ${row.scope}`)
  return { id: row.id, scope: row.scope, userId: row.userId, provider: row.provider ?? null, model: row.model ?? null, period: row.period }
}

interface BudgetScopePolicy {
  metadataKey: 'modelBudgetReservationId' | 'userBudgetReservationId'
  lockKey(target: BudgetLockTarget): string
  assertInput(input: ReserveBudgetInput): void
  sameReservation(existing: { provider: string | null; model: string | null; period: string }, input: ReserveBudgetInput, period: string): boolean
  exceededError: typeof ModelBudgetExceededError | typeof UserBudgetExceededError
  totalFilter(input: ReserveBudgetInput, period: string): ReturnType<typeof sql>
  scopeBudgetWhere(input: ReserveBudgetInput): Array<ReturnType<typeof eq>>
}

function requireModelBudgetInput(input: ReserveBudgetInput): Extract<ReserveBudgetInput, { scope: 'model' }> {
  if (input.scope !== 'model') throw new Error('expected model budget input')
  return input
}

const budgetScopePolicies: Record<BudgetReservationScope, BudgetScopePolicy> = {
  model: {
    metadataKey: 'modelBudgetReservationId',
    lockKey: (target) => `model-budget:${target.userId}:${target.provider ?? ''}:${target.model ?? ''}:${target.period}`,
    assertInput: (input) => {
      const modelInput = requireModelBudgetInput(input)
      if (!modelInput.provider.trim() || !modelInput.model.trim()) throw new Error('reserve requires provider/model')
    },
    sameReservation: (existing, input, period) => {
      const modelInput = requireModelBudgetInput(input)
      return existing.period === period && existing.provider === modelInput.provider && existing.model === modelInput.model
    },
    exceededError: ModelBudgetExceededError,
    totalFilter: (input, period) => {
      const modelInput = requireModelBudgetInput(input)
      return sql`scope = 'model' AND user_id = ${modelInput.userId} AND provider = ${modelInput.provider} AND model = ${modelInput.model} AND period = ${period}`
    },
    scopeBudgetWhere: (input) => {
      const modelInput = requireModelBudgetInput(input)
      return [eq(budgetReservations.provider, modelInput.provider), eq(budgetReservations.model, modelInput.model)]
    },
  },
  user: {
    metadataKey: 'userBudgetReservationId',
    lockKey: (target) => `user-budget:${target.userId}:${target.period}`,
    assertInput: () => {},
    sameReservation: (existing, _input, period) => existing.period === period,
    exceededError: UserBudgetExceededError,
    totalFilter: (input, period) => sql`scope = 'user' AND user_id = ${input.userId} AND period = ${period}`,
    scopeBudgetWhere: () => [],
  },
}

function scopePolicy(scope: BudgetReservationScope): BudgetScopePolicy {
  return budgetScopePolicies[scope]
}

function budgetLockKey(target: BudgetLockTarget): string {
  return scopePolicy(target.scope).lockKey(target)
}

function requireFinishKey(input: FinishReservationInput) {
  if (input.reservationId) return and(eq(budgetReservations.id, input.reservationId), eq(budgetReservations.scope, input.scope))
  if (!input.runId || !input.userId) throw new Error('finish requires reservationId or runId+userId')
  return and(eq(budgetReservations.runId, input.runId), eq(budgetReservations.userId, input.userId), eq(budgetReservations.scope, input.scope))
}

function metadataKey(scope: BudgetReservationScope): 'modelBudgetReservationId' | 'userBudgetReservationId' {
  return scopePolicy(scope).metadataKey
}

function admissionFromResults(results: ReserveBudgetResult[]): BudgetReservationAdmission {
  const user = results.find((result): result is ReserveBudgetResult & { scope: 'user' } => result.scope === 'user')
  const model = results.find((result): result is ReserveBudgetResult & { scope: 'model' } => result.scope === 'model')
  if (!model) throw new Error('budget admission requires a model reservation')
  const handles = user ? [user, model] : [model]
  return { user, model }
}

function normalizeTarget(input: ReserveBudgetInput, period: string): BudgetLockTarget {
  return { scope: input.scope, userId: input.userId, provider: input.provider ?? null, model: input.model ?? null, period }
}

function assertReserveInput(input: ReserveBudgetInput): void {
  if (!input.userId) throw new Error('reserve requires userId')
  scopePolicy(input.scope).assertInput(input)
  assertPositiveSafeInteger('budgetMicros', input.budgetMicros)
  assertPositiveSafeInteger('holdMicros', input.holdMicros)
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) throw new Error('ttlSeconds must be a positive safe integer')
}

export class PostgresBudgetReservationStore {
  constructor(
    private db: BudgetDatabase,
    private readonly options: { eligibleLegacySources?: readonly string[] } = {},
  ) {}

  static monthPeriodUtc(now = new Date()): string {
    return monthPeriodUtc(now).period
  }

  async sweepExpired(now = new Date()): Promise<number> {
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .select({
          id: budgetReservations.id,
          scope: budgetReservations.scope,
          userId: budgetReservations.userId,
          provider: budgetReservations.provider,
          model: budgetReservations.model,
          period: budgetReservations.period,
        })
        .from(budgetReservations)
        .where(and(eq(budgetReservations.status, 'active'), lt(budgetReservations.expiresAt, now)))
      if (expired.length === 0) return 0
      await lockBudgetTargets(tx, expired.map(toBudgetReservationRow), budgetLockKey)
      let count = 0
      for (const ids of chunkIds(expired.map((row) => row.id))) {
        const rows = await tx.update(budgetReservations).set({ status: 'expired' }).where(and(
          inArray(budgetReservations.id, ids),
          eq(budgetReservations.status, 'active'),
          lt(budgetReservations.expiresAt, now),
        )).returning({ id: budgetReservations.id })
        count += rows.length
      }
      return count
    })
  }

  /**
   * Read-only snapshot of current-period used/held spend for a budget target,
   * reusing the exact same accounting the admission path applies during a
   * reservation (usage ledger + settled/active reservations). No rows are
   * written. The reset boundary is derived from the same monthly period logic.
   */
  async getSpendSnapshot(query: BudgetSpendQuery): Promise<BudgetSpendSnapshot> {
    if (!query.userId) throw new Error('getSpendSnapshot requires userId')
    const now = query.now ?? new Date()
    const period = monthPeriodUtc(now)
    const input: ReserveBudgetInput = query.scope === 'model'
      ? { scope: 'model', userId: query.userId, provider: query.provider, model: query.model, runId: '', budgetMicros: 1, holdMicros: 1, ttlSeconds: 1 }
      : { scope: 'user', userId: query.userId, runId: '', budgetMicros: 1, holdMicros: 1, ttlSeconds: 1 }
    const { usedMicros, heldMicros } = await this.db.transaction((tx) => this.spend(tx, input, period.period, period.start, period.end))
    return { scope: query.scope, usedMicros, heldMicros, period: period.period, periodStart: period.start, periodEnd: period.end }
  }

  async reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
    assertReserveInput(input)
    const now = input.now ?? new Date()
    return this.db.transaction((tx) => this.reserveInTransaction(tx, input, now))
  }

  async reserveAdmission(input: BudgetReservationAdmissionInput): Promise<BudgetReservationAdmission> {
    return admissionFromResults(await this.reserveMany(input.user ? [input.user, input.model] : [input.model]))
  }

  async reserveMany(inputs: readonly ReserveBudgetInput[]): Promise<ReserveBudgetResult[]> {
    const now = inputs[0]?.now ?? new Date()
    const period = monthPeriodUtc(now).period
    for (const input of inputs) {
      assertReserveInput(input)
      if (input.now && input.now.getTime() !== now.getTime()) throw new Error('reserveMany requires all item clocks to match')
    }
    return this.db.transaction(async (tx) => {
      await lockBudgetTargets(tx, inputs.map((input) => normalizeTarget(input, period)), budgetLockKey)
      const results: ReserveBudgetResult[] = []
      for (const input of inputs) results.push(await this.reserveInTransaction(tx, { ...input, now }, now))
      return results
    })
  }

  private async reserveInTransaction(tx: BudgetDatabase, input: ReserveBudgetInput, now: Date): Promise<ReserveBudgetResult> {
    const period = monthPeriodUtc(now)
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)
    const expired = await tx
      .select({
        id: budgetReservations.id,
        scope: budgetReservations.scope,
        userId: budgetReservations.userId,
        provider: budgetReservations.provider,
        model: budgetReservations.model,
        period: budgetReservations.period,
      })
      .from(budgetReservations)
      .where(and(
        eq(budgetReservations.status, 'active'),
        lt(budgetReservations.expiresAt, now),
        or(
          this.scopeBudgetWhere(input, period.period),
          and(eq(budgetReservations.scope, input.scope), eq(budgetReservations.userId, input.userId), eq(budgetReservations.runId, input.runId)),
        ),
      ))
    await lockBudgetTargets(tx, [normalizeTarget(input, period.period), ...expired.map(toBudgetReservationRow)], budgetLockKey)

    for (const ids of chunkIds(expired.map((row) => row.id))) {
      await tx.update(budgetReservations).set({ status: 'expired' }).where(and(
        inArray(budgetReservations.id, ids),
        eq(budgetReservations.status, 'active'),
        lt(budgetReservations.expiresAt, now),
      ))
    }

    const existing = await tx.select({
      id: budgetReservations.id,
      provider: budgetReservations.provider,
      model: budgetReservations.model,
      period: budgetReservations.period,
    }).from(budgetReservations).where(and(
      eq(budgetReservations.status, 'active'),
      eq(budgetReservations.scope, input.scope),
      eq(budgetReservations.userId, input.userId),
      eq(budgetReservations.runId, input.runId),
    )).limit(1)
    const prior = existing[0]
    if (prior) {
      if (!scopePolicy(input.scope).sameReservation(prior, input, period.period)) throw new Error(`active ${input.scope} budget reservation for run ${input.runId} has conflicting target`)
      return { scope: input.scope, reservationId: prior.id, created: false, period: period.period }
    }

    const { usedMicros, heldMicros } = await this.spend(tx, input, period.period, period.start, period.end)
    if (usedMicros + heldMicros + input.holdMicros > input.budgetMicros) {
      const ErrorCtor = scopePolicy(input.scope).exceededError
      throw new ErrorCtor(usedMicros, heldMicros, input.budgetMicros, input.holdMicros)
    }

    const inserted = await tx.insert(budgetReservations).values({
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId,
      scope: input.scope,
      provider: input.provider ?? null,
      model: input.model ?? null,
      period: period.period,
      amountMicros: input.holdMicros,
      expiresAt,
      // Keep attribution deterministic when callers inject a clock. Without
      // this, ledger rows stamped with `now` can precede the reservation's
      // wall-clock default and be counted in addition to its hold.
      createdAt: now,
    }).returning({ id: budgetReservations.id })
    return { scope: input.scope, reservationId: inserted[0]!.id, created: true, period: period.period }
  }

  async settle(input: FinishReservationInput): Promise<void> {
    await this.finish(input, 'settled')
  }

  async release(input: FinishReservationInput): Promise<void> {
    await this.finish(input, 'released')
  }

  metadataForAdmission(admission: BudgetReservationAdmission): Record<string, string> {
    return Object.fromEntries(this.handlesForAdmission(admission).map((result) => [metadataKey(result.scope), result.reservationId]))
  }

  async releaseCreated(admission: BudgetReservationAdmission): Promise<void> {
    const created = this.handlesForAdmission(admission)
      .filter((handle) => handle.created)
      .map((handle) => ({ scope: handle.scope, reservationId: handle.reservationId }))
    if (created.length > 0) await this.finishMany(created, 'released')
  }

  async finishAdmission(admission: BudgetReservationAdmission, status: Exclude<BudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    await this.finishMany(this.handlesForAdmission(admission).map((handle) => ({ scope: handle.scope, reservationId: handle.reservationId })), status)
  }

  private handlesForAdmission(admission: BudgetReservationAdmission): ReserveBudgetResult[] {
    return admission.user ? [admission.user, admission.model] : [admission.model]
  }

  async finishRun(input: { userId: string; runId: string }, status: Exclude<BudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    await this.finishMany((['model', 'user'] as const).map((scope) => ({ scope, runId: input.runId, userId: input.userId })), status)
  }

  async finishMany(inputs: readonly FinishReservationInput[], status: Exclude<BudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    await this.db.transaction(async (tx) => {
      const active: BudgetReservationRow[] = []
      for (const input of inputs) {
        const scope = input.scope
        const rows = await tx.select({
          id: budgetReservations.id,
          scope: budgetReservations.scope,
          userId: budgetReservations.userId,
          provider: budgetReservations.provider,
          model: budgetReservations.model,
          period: budgetReservations.period,
        }).from(budgetReservations).where(and(requireFinishKey({ ...input, scope }), eq(budgetReservations.status, 'active')))
        active.push(...rows.map(toBudgetReservationRow))
      }
      if (active.length === 0) return
      await lockBudgetTargets(tx, active, budgetLockKey)
      for (const ids of chunkIds(active.map((row) => row.id))) {
        await tx.update(budgetReservations).set({ status }).where(and(
          inArray(budgetReservations.id, ids),
          eq(budgetReservations.status, 'active'),
        ))
      }
    })
  }

  private scopeBudgetWhere(input: ReserveBudgetInput, period: string) {
    const base = [
      eq(budgetReservations.scope, input.scope),
      eq(budgetReservations.status, 'active'),
      eq(budgetReservations.userId, input.userId),
      eq(budgetReservations.period, period),
    ]
    base.push(...scopePolicy(input.scope).scopeBudgetWhere(input))
    return and(...base)
  }

  private async reservationTotal(
    tx: BudgetDatabase,
    input: ReserveBudgetInput,
    period: string,
    status: 'active' | 'settled',
  ): Promise<number> {
    const scopeFilter = scopePolicy(input.scope).totalFilter(input, period)
    const rows = await tx.execute(sql<{ total: string | number | null }>`
      SELECT COALESCE(SUM(amount_micros), 0)::text AS total
      FROM ${budgetReservations}
      WHERE status = ${status} AND ${scopeFilter}
    `)
    return Number(rows[0]?.total ?? 0)
  }

  private async spend(tx: BudgetDatabase, input: ReserveBudgetInput, period: string, start: Date, end: Date) {
    return computeBudgetSpend(
      tx,
      input,
      period,
      start,
      end,
      this.options.eligibleLegacySources ?? [],
      (budgetInput, usageMicros) => this.spendTotals(tx, budgetInput, period, usageMicros),
    )
  }

  private async spendTotals(tx: BudgetDatabase, input: ReserveBudgetInput, period: string, usageMicros: number) {
    const heldMicros = await this.reservationTotal(tx, input, period, 'active')
    const settledFallbackMicros = await this.reservationTotal(tx, input, period, 'settled')
    return { usedMicros: usageMicros + settledFallbackMicros, heldMicros }
  }

  private async finish(input: FinishReservationInput, status: Exclude<BudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    await this.db.transaction((tx) => this.finishInTransaction(tx, input, status))
  }

  private async finishInTransaction(tx: BudgetDatabase, input: FinishReservationInput, status: Exclude<BudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    const scope = input.scope
    const active = await tx.select({
      id: budgetReservations.id,
      scope: budgetReservations.scope,
      userId: budgetReservations.userId,
      provider: budgetReservations.provider,
      model: budgetReservations.model,
      period: budgetReservations.period,
    }).from(budgetReservations).where(and(requireFinishKey({ ...input, scope }), eq(budgetReservations.status, 'active')))
    if (active.length === 0) return
    await lockBudgetTargets(tx, active.map(toBudgetReservationRow), budgetLockKey)
    await tx.update(budgetReservations).set({ status }).where(and(
      inArray(budgetReservations.id, active.map((row) => row.id)),
      eq(budgetReservations.status, 'active'),
    ))
  }
}
