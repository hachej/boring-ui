import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMeteringSink } from '@hachej/boring-agent/server'
import { ErrorCode } from '@hachej/boring-agent/shared'
import { createGovernanceService } from '../governanceService.js'

const reserveAdmission = vi.fn()
const releaseCreated = vi.fn()
const finishAdmission = vi.fn()
const finishRun = vi.fn()

vi.mock('@hachej/boring-core/server', async () => ({
  ModelBudgetExceededError: class ModelBudgetExceededError extends Error {
    statusCode = 402
    code = 'MODEL_BUDGET_EXCEEDED'
    constructor() { super('Budget reached for this model.') }
  },
  PostgresBudgetReservationStore: class PostgresBudgetReservationStore {
    reserveAdmission = reserveAdmission
    releaseCreated = releaseCreated
    finishAdmission = finishAdmission
    finishRun = finishRun
    metadataForAdmission = (input: { user?: { reservationId: string }; model: { reservationId: string } }) => ({
      ...(input.user ? { userBudgetReservationId: input.user.reservationId } : {}),
      modelBudgetReservationId: input.model.reservationId,
    })
  },
  UserBudgetExceededError: class UserBudgetExceededError extends Error {
    statusCode = 402
    code = 'MODEL_BUDGET_EXCEEDED'
    constructor() { super('Budget reached for this user.') }
  },
}))

const { createGovernanceMeteringSink } = await import('../metering.js')

function service() {
  return createGovernanceService({
    enabled: true,
    status: { state: 'active', path: '/policy.yaml', tenantId: 'company', userCount: 1 },
    policy: {
      tenant: { id: 'company', companyContextWorkspaceId: null, defaultMonthlyModelBudgetEur: 0, perRunHoldEur: 1, perRunHoldMicros: 1_000_000 },
      users: [{
        email: 'user@example.com',
        role: 'user',
        budgets: { monthlyEur: 10, monthlyMicros: 10_000_000 },
        models: [{ provider: 'infomaniak', id: 'qwen', monthlyBudgetEur: 5, monthlyBudgetMicros: 5_000_000 }],
        companyContext: { allow: [] },
      }],
      usersByEmail: new Map([['user@example.com', {
        email: 'user@example.com',
        role: 'user',
        budgets: { monthlyEur: 10, monthlyMicros: 10_000_000 },
        models: [{ provider: 'infomaniak', id: 'qwen', monthlyBudgetEur: 5, monthlyBudgetMicros: 5_000_000 }],
        companyContext: { allow: [] },
      }]]),
    },
  })
}

function disabledService() {
  return createGovernanceService({
    enabled: false,
    status: { state: 'disabled', reason: 'missing-env', path: null },
    policy: null,
  })
}

function delegate(overrides: Partial<AgentMeteringSink> = {}): AgentMeteringSink {
  return {
    reserveRun: vi.fn(async () => ({ reservationId: 'credits-res' })),
    recordUsage: vi.fn(async () => ({ billedMicros: 0 })),
    settleRun: vi.fn(async () => {}),
    releaseRun: vi.fn(async () => {}),
    ...overrides,
  }
}

function reserveInput(input: Record<string, unknown>) {
  return input as never
}

function db() {
  return {} as never
}

function admission(userReservationId: string, modelReservationId: string) {
  return {
    user: { scope: 'user', reservationId: userReservationId, created: true },
    model: { scope: 'model', reservationId: modelReservationId, created: true },
  }
}

describe('createGovernanceMeteringSink', () => {
  beforeEach(() => {
    reserveAdmission.mockReset()
    releaseCreated.mockReset()
    finishAdmission.mockReset()
    finishRun.mockReset()
    reserveAdmission.mockResolvedValue(admission('gov-user-res', 'gov-model-res'))
    releaseCreated.mockResolvedValue(undefined)
    finishAdmission.mockResolvedValue(undefined)
    finishRun.mockResolvedValue(undefined)
  })

  it('reports metering active unless both governance and delegated metering are disabled', () => {
    expect(createGovernanceMeteringSink({ service: disabledService(), delegate: delegate(), getDb: db }).isEnabled?.()).toBe(true)
    expect(createGovernanceMeteringSink({ service: disabledService(), delegate: delegate({ isEnabled: () => false }), getDb: db }).isEnabled?.()).toBe(false)
  })

  it('reserves governance budget before delegating to credits', async () => {
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: db })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-1', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).resolves.toEqual({ reservationId: 'credits-res' })

    expect(reserveAdmission).toHaveBeenCalledWith({
      user: expect.objectContaining({ scope: 'user', userId: 'user-1', budgetMicros: 10_000_000, holdMicros: 1_000_000 }),
      model: expect.objectContaining({ scope: 'model', userId: 'user-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 5_000_000, holdMicros: 1_000_000 }),
    })
    expect(credits.reserveRun).toHaveBeenCalled()
  })

  it('tags delegated usage with the governance reservation id', async () => {
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: db })
    const base = { workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true, sessionId: 's1', runId: 'run-usage', source: 'pi-chat' as const }

    await sink.reserveRun(reserveInput({ ...base, kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.recordUsage({
      ...base,
      usageId: 'usage-1',
      model: { provider: 'infomaniak', id: 'qwen' },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      metadata: { existing: true },
    })

    expect(credits.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { existing: true, modelBudgetReservationId: 'gov-model-res', userBudgetReservationId: 'gov-user-res' },
    }))
  })

  it('returns stable user budget error and does not reserve model budget or delegate when user budget is exceeded', async () => {
    const error = Object.assign(new Error('Budget reached for this user.'), { statusCode: 402, code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED })
    reserveAdmission.mockRejectedValueOnce(error)
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: db })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-user-over', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).rejects.toMatchObject({ code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED, message: 'Budget reached for this user.' })
    expect(reserveAdmission).toHaveBeenCalledTimes(1)
    expect(reserveAdmission).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ scope: 'user' }) }))
    expect(credits.reserveRun).not.toHaveBeenCalled()
  })

  it('returns stable model budget error and does not delegate when budget is exceeded', async () => {
    const error = Object.assign(new Error('Budget reached for this model.'), { statusCode: 402, code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED })
    reserveAdmission.mockRejectedValueOnce(error)
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: db })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-2', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).rejects.toMatchObject({ code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED, message: 'Budget reached for this model.' })
    expect(credits.reserveRun).not.toHaveBeenCalled()
  })

  it('releases governance hold when delegated credits reserve fails', async () => {
    const credits = delegate({ reserveRun: vi.fn(async () => { throw new Error('credits down') }) })
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: db })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-3', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).rejects.toThrow('credits down')

    expect(releaseCreated).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ reservationId: 'gov-user-res' }),
      model: expect.objectContaining({ reservationId: 'gov-model-res' }),
    }))
  })

  it('settles and releases tracked governance holds with run lifecycle', async () => {
    const sink = createGovernanceMeteringSink({ service: service(), delegate: delegate(), getDb: db })
    const base = { workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true, sessionId: 's1', source: 'pi-chat' as const }

    await sink.reserveRun(reserveInput({ ...base, runId: 'run-4', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.settleRun({ ...base, runId: 'run-4', status: 'ok' })
    expect(finishAdmission).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ reservationId: 'gov-user-res' }),
      model: expect.objectContaining({ reservationId: 'gov-model-res' }),
    }), 'released')

    reserveAdmission.mockResolvedValueOnce(admission('gov-user-res-2', 'gov-model-res-2'))
    await sink.reserveRun(reserveInput({ ...base, runId: 'run-5', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.releaseRun({ ...base, runId: 'run-5', reason: 'cancelled' })
    expect(finishAdmission).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ reservationId: 'gov-user-res-2' }),
      model: expect.objectContaining({ reservationId: 'gov-model-res-2' }),
    }), 'released')

    reserveAdmission.mockResolvedValueOnce(admission('gov-user-res-3', 'gov-model-res-3'))
    await sink.reserveRun(reserveInput({ ...base, runId: 'run-6', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.releaseRun({ ...base, runId: 'run-6', reason: 'fallback-hold-charge' })
    expect(finishAdmission).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.objectContaining({ reservationId: 'gov-user-res-3' }),
      model: expect.objectContaining({ reservationId: 'gov-model-res-3' }),
    }), 'settled')
  })
})
