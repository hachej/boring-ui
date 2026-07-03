import type {
  AgentMeteringSink,
  MeteringReleaseInput,
  MeteringReservationResult,
  MeteringReserveInput,
  MeteringSettleInput,
  MeteringUsageInput,
} from '@hachej/boring-agent/server'
import * as coreServer from '@hachej/boring-core/server'
import type { GovernanceService } from './governanceService.js'

const PostgresModelBudgetStore = (coreServer as unknown as {
  PostgresModelBudgetStore: new (db: unknown) => {
    reserve(input: unknown): Promise<{ reservationId: string }>
    settle(input: unknown): Promise<void>
    release(input: unknown): Promise<void>
  }
}).PostgresModelBudgetStore
const ModelBudgetExceededError = (coreServer as unknown as { ModelBudgetExceededError: new (usedMicros: number, heldMicros: number, budgetMicros: number, requestedMicros: number) => Error }).ModelBudgetExceededError

type ModelBudgetDb = ConstructorParameters<typeof PostgresModelBudgetStore>[0]

const CREDIT_MICROS_PER_EUR = 1_000_000
const DEFAULT_HOLD_TTL_SECONDS = 60 * 60

function authRequiredError(): Error {
  return Object.assign(new Error('authentication required'), { statusCode: 401, code: 'UNAUTHORIZED' })
}

function modelRequiredError(): Error {
  return Object.assign(new Error('model is required by governance policy'), { statusCode: 400, code: 'TOOL_INVALID_INPUT' })
}

function policyDeniedError(): Error {
  return Object.assign(new Error('model is not allowed by governance policy'), { statusCode: 403, code: 'TOOL_INVALID_INPUT' })
}

function budgetError(error: unknown): Error {
  if (typeof ModelBudgetExceededError === 'function' && error instanceof ModelBudgetExceededError) return error
  return error instanceof Error ? error : new Error(String(error))
}

function runKey(input: { userId?: string; runId: string }): string | null {
  return input.userId ? `${input.userId}\u0000${input.runId}` : null
}

export function createGovernanceMeteringSink(options: {
  service: GovernanceService
  getDb: () => ModelBudgetDb
  delegate: AgentMeteringSink
  holdTtlSeconds?: number
}): AgentMeteringSink {
  let store: InstanceType<typeof PostgresModelBudgetStore> | undefined
  const getStore = () => (store ??= new PostgresModelBudgetStore(options.getDb()))
  const reservationsByRun = new Map<string, string>()
  const holdTtlSeconds = options.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS

  async function reserveGovernance(input: MeteringReserveInput): Promise<string | undefined> {
    if (!options.service.isEnabled()) return undefined
    const identity = input as MeteringReserveInput & { userEmail?: string; userEmailVerified?: boolean }
    if (!input.userId || !identity.userEmail) throw authRequiredError()
    const user = { id: input.userId, email: identity.userEmail, emailVerified: identity.userEmailVerified === true }
    if (!input.model?.provider || !input.model.id) throw modelRequiredError()
    try {
      options.service.assertModelAllowed(user, { provider: input.model.provider, id: input.model.id })
    } catch {
      throw policyDeniedError()
    }
    const budgetMicros = options.service.monthlyBudgetMicros(user, { provider: input.model.provider, id: input.model.id })
    if (budgetMicros === null || budgetMicros <= 0) throw new ModelBudgetExceededError(0, 0, budgetMicros ?? 0, 0)
    const policy = options.service.policy()
    const holdMicros = Math.round((policy?.tenant.perRunHoldEur ?? 1) * CREDIT_MICROS_PER_EUR)
    const result = await getStore().reserve({
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: input.runId,
      provider: input.model.provider,
      model: input.model.id,
      budgetMicros,
      holdMicros,
      ttlSeconds: holdTtlSeconds,
    }).catch((error: unknown) => { throw budgetError(error) })
    const key = runKey(input)
    if (key) reservationsByRun.set(key, result.reservationId)
    return result.reservationId
  }

  async function finishGovernance(input: MeteringSettleInput | MeteringReleaseInput, action: 'settle' | 'release'): Promise<void> {
    if (!options.service.isEnabled()) return
    const key = runKey(input)
    const reservationId = key ? reservationsByRun.get(key) : undefined
    if (!reservationId && (!input.userId || !input.runId)) return
    if (action === 'settle') await getStore().settle({ reservationId, runId: input.runId, userId: input.userId })
    else await getStore().release({ reservationId, runId: input.runId, userId: input.userId })
    if (key) reservationsByRun.delete(key)
  }

  function releaseConsumesBudget(input: MeteringReleaseInput): boolean {
    return input.reason === 'usage-write-failed' || input.reason === 'fallback-hold-charge'
  }

  return {
    async reserveRun(input: MeteringReserveInput): Promise<MeteringReservationResult> {
      const governanceReservationId = await reserveGovernance(input)
      try {
        return await options.delegate.reserveRun(input)
      } catch (error) {
        if (governanceReservationId) await getStore().release({ reservationId: governanceReservationId }).catch(() => {})
        const key = runKey(input)
        if (key) reservationsByRun.delete(key)
        throw error
      }
    },

    recordUsage(input: MeteringUsageInput) {
      return options.delegate.recordUsage(input)
    },

    async settleRun(input: MeteringSettleInput): Promise<void> {
      try {
        await options.delegate.settleRun(input)
      } finally {
        // Normal successful runs write provider/model ledger rows; release the
        // admission hold so future budget checks count exact ledger spend, not
        // the conservative per-run hold.
        await finishGovernance(input, 'release')
      }
    },

    async releaseRun(input: MeteringReleaseInput): Promise<void> {
      if (releaseConsumesBudget(input)) {
        // Fallback-charge releases may have no provider/model ledger row, or
        // only a partial provider/model ledger row. Settle the governance hold
        // before delegating so model-budget accounting remains durable even if
        // the credit fallback write is transiently unavailable.
        await finishGovernance(input, 'settle')
        await options.delegate.releaseRun(input)
        return
      }

      try {
        await options.delegate.releaseRun(input)
      } finally {
        await finishGovernance(input, 'release')
      }
    },
  }
}
