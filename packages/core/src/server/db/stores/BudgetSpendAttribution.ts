import { inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { budgetReservations, usageLedger } from '../schema.js'
import type { ReserveBudgetInput } from './PostgresBudgetReservationStore.js'

type BudgetDatabase = PostgresJsDatabase<Record<string, unknown>>

export interface BudgetSpendTotals {
  usedMicros: number
  heldMicros: number
}

type SpendTotals = (input: ReserveBudgetInput, usageMicros: number) => Promise<BudgetSpendTotals>

interface BudgetSpendAttributionStrategy<S extends ReserveBudgetInput['scope']> {
  usageMicros(tx: BudgetDatabase, input: Extract<ReserveBudgetInput, { scope: S }>, period: string, start: Date, end: Date, eligibleLegacySources: readonly string[]): Promise<number>
}

const budgetSpendAttributionStrategies: { [S in ReserveBudgetInput['scope']]: BudgetSpendAttributionStrategy<S> } = {
  model: { usageMicros: modelUsageMicros },
  user: { usageMicros: userUsageMicros },
}

export async function computeBudgetSpend<S extends ReserveBudgetInput['scope']>(
  tx: BudgetDatabase,
  input: Extract<ReserveBudgetInput, { scope: S }>,
  period: string,
  start: Date,
  end: Date,
  eligibleLegacySources: readonly string[],
  totals: SpendTotals,
): Promise<BudgetSpendTotals> {
  const strategy = budgetSpendAttributionStrategies[input.scope] as BudgetSpendAttributionStrategy<S>
  return totals(input, await strategy.usageMicros(tx, input, period, start, end, eligibleLegacySources))
}

async function modelUsageMicros(tx: BudgetDatabase, input: Extract<ReserveBudgetInput, { scope: 'model' }>, period: string, start: Date, end: Date): Promise<number> {
  const periodStartIso = start.toISOString()
  const periodEndIso = end.toISOString()
  const metadataExpr = sql`${usageLedger.metadata}->>'modelBudgetReservationId'`
  const usageRows = await tx.execute(sql<{ total: string | number | null }>`
    SELECT COALESCE(SUM(${usageLedger.billedCostMicros}), 0)::text AS total
    FROM ${usageLedger}
    WHERE ${usageLedger.userId} = ${input.userId}
      AND ${usageLedger.provider} = ${input.provider}
      AND ${usageLedger.model} = ${input.model}
      AND (
        EXISTS (
          SELECT 1 FROM ${budgetReservations} r
          WHERE r.scope = 'model'
            AND r.user_id = ${usageLedger.userId}
            AND r.provider = ${usageLedger.provider}
            AND r.model = ${usageLedger.model}
            AND r.run_id = ${usageLedger.runId}
            AND r.period = ${period}
            AND r.status NOT IN ('active', 'settled')
            AND (
              ${metadataExpr} = r.id::text
              OR (
                ${metadataExpr} IS NULL
                AND r.created_at <= ${usageLedger.createdAt}
                AND NOT EXISTS (
                  SELECT 1 FROM ${budgetReservations} newer
                  WHERE newer.scope = 'model'
                    AND newer.user_id = r.user_id
                    AND newer.provider = r.provider
                    AND newer.model = r.model
                    AND newer.run_id = r.run_id
                    AND newer.created_at <= ${usageLedger.createdAt}
                    AND (newer.created_at > r.created_at OR (newer.created_at = r.created_at AND newer.id > r.id))
                )
              )
            )
        )
        OR (
          ${metadataExpr} IS NULL
          AND ${usageLedger.createdAt} >= ${periodStartIso}::timestamp
          AND ${usageLedger.createdAt} < ${periodEndIso}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM ${budgetReservations} r
            WHERE r.scope = 'model'
              AND r.user_id = ${usageLedger.userId}
              AND r.provider = ${usageLedger.provider}
              AND r.model = ${usageLedger.model}
              AND r.run_id = ${usageLedger.runId}
              AND r.created_at <= ${usageLedger.createdAt}
          )
        )
      )
  `)
  return Number(usageRows[0]?.total ?? 0)
}

async function userUsageMicros(tx: BudgetDatabase, input: Extract<ReserveBudgetInput, { scope: 'user' }>, period: string, start: Date, end: Date, eligibleLegacySources: readonly string[]): Promise<number> {
  const periodStartIso = start.toISOString()
  const periodEndIso = end.toISOString()
  const metadataExpr = sql`${usageLedger.metadata}->>'userBudgetReservationId'`
  const legacySourcePredicate = inArray(usageLedger.source, [...eligibleLegacySources])
  const usageRows = await tx.execute(sql<{ total: string | number | null }>`
    SELECT COALESCE(SUM(${usageLedger.billedCostMicros}), 0)::text AS total
    FROM ${usageLedger}
    WHERE ${usageLedger.userId} = ${input.userId}
      AND (
        EXISTS (
          SELECT 1 FROM ${budgetReservations} r
          WHERE r.scope = 'user'
            AND r.id::text = ${metadataExpr}
            AND r.user_id = ${usageLedger.userId}
            AND r.period = ${period}
            AND r.status NOT IN ('active', 'settled')
        )
        OR (
          ${legacySourcePredicate}
          AND ${metadataExpr} IS NULL
          AND EXISTS (
            SELECT 1 FROM ${budgetReservations} r
            WHERE r.scope = 'user'
              AND r.user_id = ${usageLedger.userId}
              AND r.run_id = ${usageLedger.runId}
              AND r.period = ${period}
              AND r.status NOT IN ('active', 'settled')
              AND r.created_at <= ${usageLedger.createdAt}
              AND NOT EXISTS (
                SELECT 1 FROM ${budgetReservations} newer
                WHERE newer.scope = 'user'
                  AND newer.user_id = r.user_id
                  AND newer.run_id = r.run_id
                  AND newer.created_at <= ${usageLedger.createdAt}
                  AND (newer.created_at > r.created_at OR (newer.created_at = r.created_at AND newer.id > r.id))
              )
          )
        )
        OR (
          ${legacySourcePredicate}
          AND ${metadataExpr} IS NULL
          AND ${usageLedger.createdAt} >= ${periodStartIso}::timestamp
          AND ${usageLedger.createdAt} < ${periodEndIso}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM ${budgetReservations} r
            WHERE r.scope = 'user'
              AND r.user_id = ${usageLedger.userId}
              AND r.run_id = ${usageLedger.runId}
              AND r.created_at <= ${usageLedger.createdAt}
          )
        )
      )
  `)
  return Number(usageRows[0]?.total ?? 0)
}
