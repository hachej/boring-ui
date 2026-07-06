import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMeteringSink } from '@hachej/boring-agent/server'
import { ErrorCode } from '@hachej/boring-agent/shared'
import { createGovernanceService } from '../governanceService.js'

const reserve = vi.fn()
const release = vi.fn()
const settle = vi.fn()

vi.mock('@hachej/boring-core/server', async () => ({
  ModelBudgetExceededError: class ModelBudgetExceededError extends Error {
    statusCode = 402
    code = 'MODEL_BUDGET_EXCEEDED'
    constructor() { super('Budget reached for this model.') }
  },
  PostgresModelBudgetStore: class PostgresModelBudgetStore {
    reserve = reserve
    release = release
    settle = settle
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
        models: [{ provider: 'infomaniak', id: 'qwen', monthlyBudgetEur: 5, monthlyBudgetMicros: 5_000_000 }],
        companyContext: { allow: [] },
      }],
      usersByEmail: new Map([['user@example.com', {
        email: 'user@example.com',
        role: 'user',
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

describe('createGovernanceMeteringSink', () => {
  beforeEach(() => {
    reserve.mockReset()
    release.mockReset()
    settle.mockReset()
    reserve.mockResolvedValue({ reservationId: 'gov-res' })
    release.mockResolvedValue(undefined)
    settle.mockResolvedValue(undefined)
  })

  it('reports metering active unless both governance and delegated metering are disabled', () => {
    expect(createGovernanceMeteringSink({ service: disabledService(), delegate: delegate(), getDb: () => ({}) }).isEnabled?.()).toBe(true)
    expect(createGovernanceMeteringSink({ service: disabledService(), delegate: delegate({ isEnabled: () => false }), getDb: () => ({}) }).isEnabled?.()).toBe(false)
  })

  it('reserves governance budget before delegating to credits', async () => {
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: () => ({}) })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-1', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).resolves.toEqual({ reservationId: 'credits-res' })

    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', provider: 'infomaniak', model: 'qwen', budgetMicros: 5_000_000, holdMicros: 1_000_000,
    }))
    expect(credits.reserveRun).toHaveBeenCalled()
  })

  it('tags delegated usage with the governance reservation id', async () => {
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: () => ({}) })
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
      metadata: { existing: true, modelBudgetReservationId: 'gov-res' },
    }))
  })

  it('returns stable model budget error and does not delegate when budget is exceeded', async () => {
    const error = Object.assign(new Error('Budget reached for this model.'), { statusCode: 402, code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED })
    reserve.mockRejectedValue(error)
    const credits = delegate()
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: () => ({}) })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-2', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).rejects.toMatchObject({ code: ErrorCode.enum.MODEL_BUDGET_EXCEEDED, message: 'Budget reached for this model.' })
    expect(credits.reserveRun).not.toHaveBeenCalled()
  })

  it('releases governance hold when delegated credits reserve fails', async () => {
    const credits = delegate({ reserveRun: vi.fn(async () => { throw new Error('credits down') }) })
    const sink = createGovernanceMeteringSink({ service: service(), delegate: credits, getDb: () => ({}) })

    await expect(sink.reserveRun(reserveInput({
      workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true,
      sessionId: 's1', runId: 'run-3', source: 'pi-chat', kind: 'prompt', message: 'hi',
      model: { provider: 'infomaniak', id: 'qwen' },
    }))).rejects.toThrow('credits down')

    expect(release).toHaveBeenCalledWith({ reservationId: 'gov-res' })
  })

  it('settles and releases tracked governance holds with run lifecycle', async () => {
    const sink = createGovernanceMeteringSink({ service: service(), delegate: delegate(), getDb: () => ({}) })
    const base = { workspaceId: 'ws', userId: 'user-1', userEmail: 'user@example.com', userEmailVerified: true, sessionId: 's1', source: 'pi-chat' as const }

    await sink.reserveRun(reserveInput({ ...base, runId: 'run-4', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.settleRun({ ...base, runId: 'run-4', status: 'ok' })
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'gov-res' }))

    reserve.mockResolvedValueOnce({ reservationId: 'gov-res-2' })
    await sink.reserveRun(reserveInput({ ...base, runId: 'run-5', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.releaseRun({ ...base, runId: 'run-5', reason: 'cancelled' })
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'gov-res-2' }))

    reserve.mockResolvedValueOnce({ reservationId: 'gov-res-3' })
    await sink.reserveRun(reserveInput({ ...base, runId: 'run-6', kind: 'prompt', message: 'hi', model: { provider: 'infomaniak', id: 'qwen' } }))
    await sink.releaseRun({ ...base, runId: 'run-6', reason: 'fallback-hold-charge' })
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'gov-res-3' }))
  })
})
