import { and, eq, lt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { modelBudgetReservations, usageLedger } from '../schema.js'

export type ModelBudgetReservationStatus = 'active' | 'settled' | 'released' | 'expired'

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

export interface ReserveModelBudgetInput {
  userId: string
  workspaceId?: string
  sessionId?: string
  runId: string
  provider: string
  model: string
  budgetMicros: number
  holdMicros: number
  ttlSeconds: number
  now?: Date
}

export interface ReserveModelBudgetResult {
  reservationId: string
  created: boolean
  period: string
}

export interface FinishModelBudgetReservationInput {
  reservationId?: string
  runId?: string
  userId?: string
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
}

function monthPeriodUtc(now: Date): { period: string; start: Date; end: Date } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  return {
    period: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  }
}

function requireFinishKey(input: FinishModelBudgetReservationInput) {
  if (input.reservationId) return eq(modelBudgetReservations.id, input.reservationId)
  if (!input.runId || !input.userId) throw new Error('finish requires reservationId or runId+userId')
  return and(eq(modelBudgetReservations.runId, input.runId), eq(modelBudgetReservations.userId, input.userId))
}

export class PostgresModelBudgetStore {
  constructor(private db: PostgresJsDatabase) {}

  static monthPeriodUtc(now = new Date()): string {
    return monthPeriodUtc(now).period
  }

  async sweepExpired(now = new Date()): Promise<number> {
    const rows = await this.db
      .update(modelBudgetReservations)
      .set({ status: 'expired' })
      .where(and(eq(modelBudgetReservations.status, 'active'), lt(modelBudgetReservations.expiresAt, now)))
      .returning({ id: modelBudgetReservations.id })
    return rows.length
  }

  async reserve(input: ReserveModelBudgetInput): Promise<ReserveModelBudgetResult> {
    if (!input.userId) throw new Error('reserve requires userId')
    if (!input.provider || !input.model) throw new Error('reserve requires provider/model')
    assertPositiveSafeInteger('budgetMicros', input.budgetMicros)
    assertPositiveSafeInteger('holdMicros', input.holdMicros)
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) throw new Error('ttlSeconds must be a positive safe integer')

    const now = input.now ?? new Date()
    const period = monthPeriodUtc(now)
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000)

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`model-budget:${input.userId}:${input.provider}:${input.model}:${period.period}`}))`)

      await tx
        .update(modelBudgetReservations)
        .set({ status: 'expired' })
        .where(and(eq(modelBudgetReservations.status, 'active'), lt(modelBudgetReservations.expiresAt, now)))

      const existing = await tx
        .select({
          id: modelBudgetReservations.id,
          provider: modelBudgetReservations.provider,
          model: modelBudgetReservations.model,
          period: modelBudgetReservations.period,
        })
        .from(modelBudgetReservations)
        .where(and(
          eq(modelBudgetReservations.status, 'active'),
          eq(modelBudgetReservations.userId, input.userId),
          eq(modelBudgetReservations.runId, input.runId),
        ))
        .limit(1)
      const prior = existing[0]
      if (prior) {
        if (prior.provider !== input.provider || prior.model !== input.model || prior.period !== period.period) {
          throw new Error(`active model budget reservation for run ${input.runId} has conflicting tuple`)
        }
        return { reservationId: prior.id, created: false, period: period.period }
      }

      const periodStartIso = period.start.toISOString()
      const periodEndIso = period.end.toISOString()
      const usageRows = await tx.execute(sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(${usageLedger.billedCostMicros}), 0)::text AS total
        FROM ${usageLedger}
        WHERE ${usageLedger.userId} = ${input.userId}
          AND ${usageLedger.provider} = ${input.provider}
          AND ${usageLedger.model} = ${input.model}
          AND ${usageLedger.createdAt} >= ${periodStartIso}::timestamp
          AND ${usageLedger.createdAt} < ${periodEndIso}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM ${modelBudgetReservations} r
            WHERE r.status IN ('active', 'settled')
              AND r.user_id = ${usageLedger.userId}
              AND r.provider = ${usageLedger.provider}
              AND r.model = ${usageLedger.model}
              AND r.period = ${period.period}
              AND r.run_id = ${usageLedger.runId}
          )
      `)
      const heldRows = await tx.execute(sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(amount_micros), 0)::text AS total
        FROM ${modelBudgetReservations}
        WHERE status = 'active'
          AND user_id = ${input.userId}
          AND provider = ${input.provider}
          AND model = ${input.model}
          AND period = ${period.period}
      `)
      const settledFallbackRows = await tx.execute(sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(amount_micros), 0)::text AS total
        FROM ${modelBudgetReservations}
        WHERE status = 'settled'
          AND user_id = ${input.userId}
          AND provider = ${input.provider}
          AND model = ${input.model}
          AND period = ${period.period}
      `)
      const usedMicros = Number(usageRows[0]?.total ?? 0) + Number(settledFallbackRows[0]?.total ?? 0)
      const heldMicros = Number(heldRows[0]?.total ?? 0)
      if (usedMicros + heldMicros + input.holdMicros > input.budgetMicros) {
        throw new ModelBudgetExceededError(usedMicros, heldMicros, input.budgetMicros, input.holdMicros)
      }

      const inserted = await tx
        .insert(modelBudgetReservations)
        .values({
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          sessionId: input.sessionId ?? null,
          runId: input.runId,
          provider: input.provider,
          model: input.model,
          period: period.period,
          amountMicros: input.holdMicros,
          expiresAt,
        })
        .returning({ id: modelBudgetReservations.id })
      return { reservationId: inserted[0]!.id, created: true, period: period.period }
    })
  }

  async settle(input: FinishModelBudgetReservationInput): Promise<void> {
    await this.finish(input, 'settled')
  }

  async release(input: FinishModelBudgetReservationInput): Promise<void> {
    await this.finish(input, 'released')
  }

  private async finish(input: FinishModelBudgetReservationInput, status: Exclude<ModelBudgetReservationStatus, 'active' | 'expired'>): Promise<void> {
    await this.db
      .update(modelBudgetReservations)
      .set({ status })
      .where(and(requireFinishKey(input), eq(modelBudgetReservations.status, 'active')))
  }
}
