import type {
  AgentMeteringSink,
  MeteringReleaseInput,
  MeteringReservationResult,
  MeteringReserveInput,
  MeteringSettleInput,
  MeteringUsageInput,
} from '@hachej/boring-agent/server'
import { ErrorCode } from '@hachej/boring-agent/shared'
import { ModelBudgetExceededError, PostgresBudgetReservationStore, UserBudgetExceededError } from '@hachej/boring-core/server'
import type { BudgetReservationAdmission, ReserveBudgetInput } from '@hachej/boring-core/server'
import type { GovernanceService } from './governanceService.js'

type BudgetDb = ConstructorParameters<typeof PostgresBudgetReservationStore>[0]
const DEFAULT_HOLD_TTL_SECONDS = 60 * 60

function authRequiredError(): Error {
  return Object.assign(new Error('authentication required'), { statusCode: 401, code: ErrorCode.enum.UNAUTHORIZED })
}

function modelRequiredError(): Error {
  return Object.assign(new Error('model is required by governance policy'), { statusCode: 400, code: ErrorCode.enum.TOOL_INVALID_INPUT })
}

function policyDeniedError(): Error {
  return Object.assign(new Error('model is not allowed by governance policy'), { statusCode: 403, code: ErrorCode.enum.TOOL_INVALID_INPUT })
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
  getDb: () => BudgetDb
  delegate: AgentMeteringSink
  holdTtlSeconds?: number
}): AgentMeteringSink {
  let store: InstanceType<typeof PostgresBudgetReservationStore> | undefined
  const getStore = () => (store ??= new PostgresBudgetReservationStore(options.getDb(), { eligibleLegacySources: ['pi-chat', 'pi-chat-fallback', 'pi-chat-expired'] }))
  const admissionsByRun = new Map<string, BudgetReservationAdmission>()
  const holdTtlSeconds = options.holdTtlSeconds ?? DEFAULT_HOLD_TTL_SECONDS

  async function reserveGovernance(input: MeteringReserveInput): Promise<BudgetReservationAdmission | undefined> {
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

    const modelBudgetMicros = options.service.monthlyBudgetMicros(user, { provider: input.model.provider, id: input.model.id })
    if (modelBudgetMicros === null || modelBudgetMicros <= 0) throw new ModelBudgetExceededError(0, 0, modelBudgetMicros ?? 0, 0)
    const policy = options.service.policy()
    const holdMicros = policy?.tenant.perRunHoldMicros ?? 1_000_000
    const now = new Date()
    let userReservationInput: Extract<ReserveBudgetInput, { scope: 'user' }> | undefined
    const userBudgetMicros = options.service.userMonthlyBudgetMicros(user)
    if (userBudgetMicros !== null) {
      if (userBudgetMicros <= 0) throw new (UserBudgetExceededError ?? ModelBudgetExceededError)(0, 0, userBudgetMicros, 0)
      userReservationInput = {
        scope: 'user',
        userId: input.userId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.runId,
        budgetMicros: userBudgetMicros,
        holdMicros,
        ttlSeconds: holdTtlSeconds,
        now,
      }
    }
    const modelReservationInput: Extract<ReserveBudgetInput, { scope: 'model' }> = {
      scope: 'model',
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      runId: input.runId,
      provider: input.model.provider,
      model: input.model.id,
      budgetMicros: modelBudgetMicros,
      holdMicros,
      ttlSeconds: holdTtlSeconds,
      now,
    }
    const admission = await getStore().reserveAdmission({ user: userReservationInput, model: modelReservationInput }).catch((error: unknown) => { throw budgetError(error) })
    const key = runKey(input)
    if (key) admissionsByRun.set(key, admission)
    return admission
  }

  async function finishGovernance(input: MeteringSettleInput | MeteringReleaseInput, action: 'settle' | 'release'): Promise<void> {
    if (!options.service.isEnabled()) return
    const key = runKey(input)
    const admission = key ? admissionsByRun.get(key) : undefined
    const status = action === 'settle' ? 'settled' : 'released'
    if (admission) {
      await getStore().finishAdmission(admission, status)
      if (key) admissionsByRun.delete(key)
      return
    }
    if (!input.userId || !input.runId) return
    await getStore().finishRun({ runId: input.runId, userId: input.userId }, status)
  }

  function releaseConsumesBudget(input: MeteringReleaseInput): boolean {
    return input.reason === 'usage-write-failed' || input.reason === 'fallback-hold-charge'
  }

  return {
    isEnabled: () => options.service.isEnabled() || options.delegate.isEnabled?.() !== false,

    async reserveRun(input: MeteringReserveInput): Promise<MeteringReservationResult> {
      const admission = await reserveGovernance(input)
      try {
        return await options.delegate.reserveRun(input)
      } catch (error) {
        try {
          // Only release holds created by this reserve attempt; existing idempotent
          // handles may belong to an already-admitted run whose delegate retry failed.
          if (admission) await getStore().releaseCreated(admission)
        } catch {
          // Preserve the delegated reservation failure; budget cleanup remains idempotent and retryable.
        } finally {
          const key = runKey(input)
          if (key) admissionsByRun.delete(key)
        }
        throw error
      }
    },

    recordUsage(input: MeteringUsageInput) {
      const key = runKey(input)
      const admission = key ? admissionsByRun.get(key) : undefined
      return options.delegate.recordUsage(admission
        ? { ...input, metadata: { ...(input.metadata ?? {}), ...getStore().metadataForAdmission(admission) } }
        : input)
    },

    async settleRun(input: MeteringSettleInput): Promise<void> {
      try {
        await options.delegate.settleRun(input)
      } finally {
        await finishGovernance(input, 'release')
      }
    },

    async releaseRun(input: MeteringReleaseInput): Promise<void> {
      if (releaseConsumesBudget(input)) {
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
