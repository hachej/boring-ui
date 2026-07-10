import { PostgresBudgetReservationStore } from './PostgresBudgetReservationStore.js'
import type { FinishReservationInput, ReserveBudgetInput, ReserveBudgetResult } from './PostgresBudgetReservationStore.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export { ModelBudgetExceededError } from './PostgresBudgetReservationStore.js'

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

export type ReserveModelBudgetResult = Omit<ReserveBudgetResult, 'scope'>

export interface FinishModelBudgetReservationInput extends Omit<FinishReservationInput, 'scope'> {
  scope?: 'model'
}

export class PostgresModelBudgetStore {
  private readonly store: PostgresBudgetReservationStore

  constructor(db: PostgresJsDatabase) {
    this.store = new PostgresBudgetReservationStore(db)
  }

  static monthPeriodUtc(now = new Date()): string {
    return PostgresBudgetReservationStore.monthPeriodUtc(now)
  }

  sweepExpired(now = new Date()): Promise<number> {
    return this.store.sweepExpired(now)
  }

  async reserve(input: ReserveModelBudgetInput): Promise<ReserveModelBudgetResult> {
    const { scope: _scope, ...result } = await this.store.reserve({ ...input, scope: 'model' } satisfies ReserveBudgetInput)
    return result
  }

  settle(input: FinishModelBudgetReservationInput): Promise<void> {
    return this.store.settle({ ...input, scope: 'model' })
  }

  release(input: FinishModelBudgetReservationInput): Promise<void> {
    return this.store.release({ ...input, scope: 'model' })
  }
}
