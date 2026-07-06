import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
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

const UPDATE_ID_BATCH_SIZE = 1_000

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

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += UPDATE_ID_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + UPDATE_ID_BATCH_SIZE))
  }
  return chunks
}

type ModelBudgetLockTarget = {
  userId: string
  provider: string
  model: string
  period: string
}

function modelBudgetAdvisoryLockKey(target: ModelBudgetLockTarget): string {
  return `model-budget:${target.userId}:${target.provider}:${target.model}:${target.period}`
}

async function lockModelBudgetTargets(
  executor: Pick<PostgresJsDatabase, 'execute'>,
  targets: readonly ModelBudgetLockTarget[],
): Promise<void> {
  const keys = Array.from(new Set(targets.map(modelBudgetAdvisoryLockKey))).sort()
  for (const key of keys) {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)
  }
}

export class PostgresModelBudgetStore {
  constructor(private db: PostgresJsDatabase) {}

  static monthPeriodUtc(now = new Date()): string {
    return monthPeriodUtc(now).period
  }

  async sweepExpired(now = new Date()): Promise<number> {
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .select({
          id: modelBudgetReservations.id,
          userId: modelBudgetReservations.userId,
          provider: modelBudgetReservations.provider,
          model: modelBudgetReservations.model,
          period: modelBudgetReservations.period,
        })
        .from(modelBudgetReservations)
        .where(and(eq(modelBudgetReservations.status, 'active'), lt(modelBudgetReservations.expiresAt, now)))
      if (expired.length === 0) return 0
      await lockModelBudgetTargets(tx, expired)
      let count = 0
      for (const ids of chunkIds(expired.map((row) => row.id))) {
        const rows = await tx
          .update(modelBudgetReservations)
          .set({ status: 'expired' })
          .where(and(
            inArray(modelBudgetReservations.id, ids),
            eq(modelBudgetReservations.status, 'active'),
            lt(modelBudgetReservations.expiresAt, now),
          ))
          .returning({ id: modelBudgetReservations.id })
        count += rows.length
      }
      return count
    })
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
      const expired = await tx
        .select({
          id: modelBudgetReservations.id,
          userId: modelBudgetReservations.userId,
          provider: modelBudgetReservations.provider,
          model: modelBudgetReservations.model,
          period: modelBudgetReservations.period,
        })
        .from(modelBudgetReservations)
        .where(and(
          eq(modelBudgetReservations.status, 'active'),
          lt(modelBudgetReservations.expiresAt, now),
          or(
            and(
              eq(modelBudgetReservations.userId, input.userId),
              eq(modelBudgetReservations.provider, input.provider),
              eq(modelBudgetReservations.model, input.model),
              eq(modelBudgetReservations.period, period.period),
            ),
            and(
              eq(modelBudgetReservations.userId, input.userId),
              eq(modelBudgetReservations.runId, input.runId),
            ),
          ),
        ))
      await lockModelBudgetTargets(tx, [
        { userId: input.userId, provider: input.provider, model: input.model, period: period.period },
        ...expired,
      ])

      for (const ids of chunkIds(expired.map((row) => row.id))) {
        await tx
          .update(modelBudgetReservations)
          .set({ status: 'expired' })
          .where(and(
            inArray(modelBudgetReservations.id, ids),
            eq(modelBudgetReservations.status, 'active'),
            lt(modelBudgetReservations.expiresAt, now),
          ))
      }

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
      // Reserved-run spend is attributed to the reservation's period, not the
      // ledger row's created_at, so a run reserved before a UTC month boundary
      // and settled after it counts exactly once (in the reserved period).
      // Ledger rows stamped with modelBudgetReservationId map directly; legacy
      // rows without the stamp fall back to the newest reservation created at
      // or before the row (run ids can be reused across periods). Unreserved
      // legacy rows are counted by created_at month.
      const usageRows = await tx.execute(sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(${usageLedger.billedCostMicros}), 0)::text AS total
        FROM ${usageLedger}
        WHERE ${usageLedger.userId} = ${input.userId}
          AND ${usageLedger.provider} = ${input.provider}
          AND ${usageLedger.model} = ${input.model}
          AND (
            (
              EXISTS (
                SELECT 1 FROM ${modelBudgetReservations} r
                WHERE r.user_id = ${usageLedger.userId}
                  AND r.provider = ${usageLedger.provider}
                  AND r.model = ${usageLedger.model}
                  AND r.run_id = ${usageLedger.runId}
                  AND r.period = ${period.period}
                  AND r.status NOT IN ('active', 'settled')
                  AND (
                    ${usageLedger.metadata}->>'modelBudgetReservationId' = r.id::text
                    OR (
                      ${usageLedger.metadata}->>'modelBudgetReservationId' IS NULL
                      AND r.created_at <= ${usageLedger.createdAt}
                      AND NOT EXISTS (
                        SELECT 1 FROM ${modelBudgetReservations} newer
                        WHERE newer.user_id = r.user_id
                          AND newer.provider = r.provider
                          AND newer.model = r.model
                          AND newer.run_id = r.run_id
                          AND newer.created_at <= ${usageLedger.createdAt}
                          AND (
                            newer.created_at > r.created_at
                            OR (newer.created_at = r.created_at AND newer.id > r.id)
                          )
                      )
                    )
                  )
              )
            )
            OR (
              ${usageLedger.createdAt} >= ${periodStartIso}::timestamp
              AND ${usageLedger.createdAt} < ${periodEndIso}::timestamp
              AND ${usageLedger.metadata}->>'modelBudgetReservationId' IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM ${modelBudgetReservations} r
                WHERE r.user_id = ${usageLedger.userId}
                  AND r.provider = ${usageLedger.provider}
                  AND r.model = ${usageLedger.model}
                  AND r.run_id = ${usageLedger.runId}
                  AND r.created_at <= ${usageLedger.createdAt}
              )
            )
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
    await this.db.transaction(async (tx) => {
      const active = await tx
        .select({
          id: modelBudgetReservations.id,
          userId: modelBudgetReservations.userId,
          provider: modelBudgetReservations.provider,
          model: modelBudgetReservations.model,
          period: modelBudgetReservations.period,
        })
        .from(modelBudgetReservations)
        .where(and(requireFinishKey(input), eq(modelBudgetReservations.status, 'active')))
      if (active.length === 0) return
      await lockModelBudgetTargets(tx, active)
      await tx
        .update(modelBudgetReservations)
        .set({ status })
        .where(and(
          inArray(modelBudgetReservations.id, active.map((row) => row.id)),
          eq(modelBudgetReservations.status, 'active'),
        ))
    })
  }
}
