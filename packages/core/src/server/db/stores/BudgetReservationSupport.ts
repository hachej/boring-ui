import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export type BudgetReservationStatus = 'active' | 'settled' | 'released' | 'expired'

export interface BudgetPeriodUtc {
  period: string
  start: Date
  end: Date
}

export function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
}

export function monthPeriodUtc(now: Date): BudgetPeriodUtc {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  return {
    period: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  }
}

export function chunkIds(ids: string[], size = 1_000): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size))
  return chunks
}

export async function lockBudgetTargets<TTarget>(
  executor: Pick<PostgresJsDatabase, 'execute'>,
  targets: readonly TTarget[],
  keyForTarget: (target: TTarget) => string,
): Promise<void> {
  const keys = Array.from(new Set(targets.map(keyForTarget))).sort()
  for (const key of keys) await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)
}
