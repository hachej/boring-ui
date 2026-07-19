import { describe, expect, it, vi } from 'vitest'
import { createGovernanceService, type GovernanceUsageSpendReader } from '../governanceService.js'
import type { GovernanceLoadResult, GovernanceUserPolicy } from '../policyTypes.js'

const PERIOD_END = new Date('2026-08-01T00:00:00.000Z')

function userPolicy(overrides: Partial<GovernanceUserPolicy> = {}): GovernanceUserPolicy {
  return {
    email: 'user@example.com',
    role: 'user',
    budgets: { monthlyEur: 20, monthlyMicros: 20_000_000 },
    models: [
      { provider: 'infomaniak', id: 'qwen', monthlyBudgetEur: 5, monthlyBudgetMicros: 5_000_000 },
      { provider: 'openai', id: 'gpt-5.5', monthlyBudgetEur: 10, monthlyBudgetMicros: 10_000_000 },
    ],
    companyContext: { allow: [] },
    skills: [],
    ...overrides,
  }
}

function service(policyUser: GovernanceUserPolicy = userPolicy(), enabled = true) {
  const result: GovernanceLoadResult = enabled
    ? {
        enabled: true,
        status: { state: 'active', path: '/policy.yaml', tenantId: 'company', userCount: 1 },
        policy: {
          tenant: { id: 'company', companyContextWorkspaceId: null, defaultMonthlyModelBudgetEur: 0, perRunHoldEur: 1, perRunHoldMicros: 1_000_000 },
          roles: { admin: { skills: [] }, user: { skills: [] } },
          users: [policyUser],
          usersByEmail: new Map([[policyUser.email, policyUser]]),
        },
      }
    : { enabled: false, status: { state: 'disabled', reason: 'missing-env', path: null }, policy: null }
  return createGovernanceService(result)
}

function reader(spend: Record<string, { usedMicros: number; heldMicros: number }>): GovernanceUsageSpendReader {
  return {
    getSpendSnapshot: vi.fn(async (query) => {
      const key = query.scope === 'user' ? 'user' : `${query.provider}/${query.model}`
      const entry = spend[key] ?? { usedMicros: 0, heldMicros: 0 }
      return { usedMicros: entry.usedMicros, heldMicros: entry.heldMicros, periodEnd: PERIOD_END }
    }),
  }
}

const user = { id: 'user-1', email: 'user@example.com', emailVerified: true }

describe('GovernanceService.getUsageSummary', () => {
  it('computes used/held/remaining/pct per model and the aggregate row', async () => {
    const summary = await service().getUsageSummary(user, reader({
      'infomaniak/qwen': { usedMicros: 2_000_000, heldMicros: 500_000 },
      'openai/gpt-5.5': { usedMicros: 0, heldMicros: 0 },
      user: { usedMicros: 2_000_000, heldMicros: 500_000 },
    }))

    expect(summary.enabled).toBe(true)
    expect(summary.currency).toBe('EUR')

    const qwen = summary.models.find((m) => m.id === 'qwen')!
    expect(qwen).toMatchObject({
      provider: 'infomaniak',
      usedMicros: 2_000_000,
      heldMicros: 500_000,
      budgetMicros: 5_000_000,
      remainingMicros: 2_500_000, // 5M - 2M - 0.5M
      pctUsed: 50, // (2M + 0.5M) / 5M
      resetsAt: PERIOD_END.toISOString(),
    })

    const gpt = summary.models.find((m) => m.id === 'gpt-5.5')!
    expect(gpt).toMatchObject({ usedMicros: 0, heldMicros: 0, remainingMicros: 10_000_000, pctUsed: 0 })

    expect(summary.aggregate).toMatchObject({
      id: '__all__',
      label: 'All models',
      budgetMicros: 20_000_000,
      remainingMicros: 17_500_000,
      pctUsed: 13, // round(2.5M / 20M * 100)
      resetsAt: PERIOD_END.toISOString(),
    })
  })

  it('omits the aggregate row when no aggregate cap is configured', async () => {
    const policy = userPolicy({ budgets: { monthlyEur: null, monthlyMicros: null } })
    const summary = await service(policy).getUsageSummary(user, reader({}))
    expect(summary.aggregate).toBeNull()
    expect(summary.models).toHaveLength(2)
  })

  it('caps pctUsed at 100 and never returns negative remaining when over budget', async () => {
    const summary = await service().getUsageSummary(user, reader({
      'infomaniak/qwen': { usedMicros: 6_000_000, heldMicros: 1_000_000 },
    }))
    const qwen = summary.models.find((m) => m.id === 'qwen')!
    expect(qwen.pctUsed).toBe(100)
    expect(qwen.remainingMicros).toBe(0)
  })

  it('treats a zero-budget grant as fully consumed with no room', async () => {
    const policy = userPolicy({
      models: [{ provider: 'infomaniak', id: 'qwen', monthlyBudgetEur: 0, monthlyBudgetMicros: 0 }],
      budgets: { monthlyEur: null, monthlyMicros: null },
    })
    const summary = await service(policy).getUsageSummary(user, reader({}))
    expect(summary.models[0]).toMatchObject({ budgetMicros: 0, remainingMicros: 0, pctUsed: 100 })
  })

  it('returns an empty summary when governance is disabled', async () => {
    const summary = await service(userPolicy(), false).getUsageSummary(user, reader({}))
    expect(summary).toEqual({
      enabled: false, currency: 'EUR', models: [], aggregate: null,
      role: null, aggregateCapMicros: null, companyContextAccess: 'none', companyContextRules: [],
    })
  })

  it('returns an empty enabled summary for an unknown / unverified caller', async () => {
    const summary = await service().getUsageSummary({ id: 'x', email: 'nobody@example.com', emailVerified: true }, reader({}))
    expect(summary).toEqual({
      enabled: true, currency: 'EUR', models: [], aggregate: null,
      role: null, aggregateCapMicros: null, companyContextAccess: 'none', companyContextRules: [],
    })
  })

  it('includes role, aggregate cap, and context access + rules for a governed user', async () => {
    const policy = userPolicy({ companyContext: { allow: ['company/**', 'shared/handbook.md'] } })
    const summary = await service(policy).getUsageSummary(user, reader({}))
    expect(summary.role).toBe('user')
    expect(summary.aggregateCapMicros).toBe(20_000_000)
    expect(summary.companyContextAccess).toBe('readonly')
    expect(summary.companyContextRules).toEqual(['company/**', 'shared/handbook.md'])
  })

  it('reports readwrite context access for an admin and null aggregate cap when unset', async () => {
    const policy = userPolicy({ role: 'admin', budgets: { monthlyEur: null, monthlyMicros: null } })
    const summary = await service(policy).getUsageSummary(user, reader({}))
    expect(summary.role).toBe('admin')
    expect(summary.aggregateCapMicros).toBeNull()
    expect(summary.companyContextAccess).toBe('readwrite')
  })

  it('derives resetsAt from the reader period boundary (not hardcoded)', async () => {
    const spendReader = reader({})
    const summary = await service().getUsageSummary(user, spendReader)
    for (const entry of [...summary.models, summary.aggregate!]) {
      expect(entry.resetsAt).toBe(PERIOD_END.toISOString())
    }
  })
})
