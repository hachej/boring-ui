import type {
  GovernanceLoadResult,
  GovernanceModelGrant,
  GovernancePolicy,
  GovernancePolicyStatus,
  GovernanceUserLike,
  GovernanceUserPolicy,
  ServedModelLike,
  TenantRole,
} from './policyTypes.js'
import { normalizePolicyEmail } from './validatePolicy.js'
import type { GovernanceUsageEntry, GovernanceUsageSummary } from '../usageContract.js'

/**
 * Minimal read-only view over the budget reservation store used to compute the
 * usage summary. `PostgresBudgetReservationStore.getSpendSnapshot` satisfies
 * this shape structurally, so the summary reuses the exact same used/held
 * accounting the admission path applies during a reservation.
 */
export interface GovernanceUsageSpendReader {
  getSpendSnapshot(query:
    | { scope: 'user'; userId: string }
    | { scope: 'model'; userId: string; provider: string; model: string }
  ): Promise<{ usedMicros: number; heldMicros: number; periodEnd: Date }>
}

export type GovernancePolicyErrorCode = 'disabled' | 'invalid' | 'denied' | 'not_allowed'
export type CompanyContextAccess = 'none' | 'readonly' | 'readwrite'

export class GovernancePolicyError extends Error {
  constructor(message: string, readonly code: GovernancePolicyErrorCode) {
    super(message)
    this.name = 'GovernancePolicyError'
  }
}

export interface GovernanceMeResponse {
  enabled: boolean
  role: TenantRole | null
  admin: boolean
  policyStatus?: GovernancePolicyStatus
  tenant?: {
    id: string
    companyContextWorkspaceId: string | null
    defaultMonthlyModelBudgetEur: number
    perRunHoldEur: number
  }
  users?: Array<{
    email: string
    role: TenantRole
    modelCount: number
    monthlyBudgetEur: number | null
    contextRuleCount: number
  }>
  models?: Array<GovernanceModelGrant & { email: string }>
  companyContextRules?: Array<{ email: string; pattern: string }>
}

export class GovernanceService {
  constructor(private readonly loaded: GovernanceLoadResult) {}

  isEnabled(): boolean {
    return this.loaded.enabled
  }

  policyStatus(): GovernancePolicyStatus {
    return this.loaded.status
  }

  policy(): GovernancePolicy | null {
    return this.loaded.policy
  }

  private enabledPolicy(): GovernancePolicy | null {
    if (!this.loaded.enabled) return null
    if (!this.loaded.policy) return null
    return this.loaded.policy
  }

  private userPolicy(user: GovernanceUserLike | null | undefined): GovernanceUserPolicy | null {
    const policy = this.enabledPolicy()
    if (!policy || !user?.email || user.emailVerified !== true) return null
    return policy.usersByEmail.get(normalizePolicyEmail(user.email)) ?? null
  }

  roleForUser(user: GovernanceUserLike | null | undefined): TenantRole | null {
    return this.userPolicy(user)?.role ?? null
  }

  isAdmin(user: GovernanceUserLike | null | undefined): boolean {
    return this.roleForUser(user) === 'admin'
  }

  allowedModelsForUser<TModel extends ServedModelLike>(user: GovernanceUserLike, servedModels: readonly TModel[]): TModel[] {
    const userPolicy = this.userPolicy(user)
    if (!this.loaded.enabled) return [...servedModels]
    if (!userPolicy) return []
    const allowed = new Set(userPolicy.models.map((model) => `${model.provider}\u0000${model.id}`))
    return servedModels.filter((model) => allowed.has(`${model.provider}\u0000${model.id}`))
  }

  assertModelAllowed(user: GovernanceUserLike, model: ServedModelLike): void {
    if (!this.loaded.enabled) return
    const allowed = this.allowedModelsForUser(user, [model])
    if (allowed.length === 0) throw new GovernancePolicyError('model is not allowed by governance policy', 'not_allowed')
  }

  monthlyBudgetMicros(user: GovernanceUserLike, model: ServedModelLike): number | null {
    if (!this.loaded.enabled) return null
    const userPolicy = this.userPolicy(user)
    const grant = userPolicy?.models.find((entry) => entry.provider === model.provider && entry.id === model.id)
    return grant?.monthlyBudgetMicros ?? null
  }

  userMonthlyBudgetMicros(user: GovernanceUserLike): number | null {
    if (!this.loaded.enabled) return null
    return this.userPolicy(user)?.budgets.monthlyMicros ?? null
  }

  companyContextRules(user: GovernanceUserLike): string[] {
    if (!this.loaded.enabled) return []
    return this.userPolicy(user)?.companyContext.allow ?? []
  }

  companyContextAccessForUser(user: GovernanceUserLike | null | undefined): CompanyContextAccess {
    if (!this.loaded.enabled) return 'none'
    const policy = this.userPolicy(user)
    if (!policy) return 'none'
    if (policy.role === 'admin') return 'readwrite'
    return policy.companyContext.allow.length > 0 ? 'readonly' : 'none'
  }

  companyContextWorkspaceId(): string | null {
    return this.enabledPolicy()?.tenant.companyContextWorkspaceId ?? null
  }

  /**
   * Per-model consumed/remaining usage for the caller, plus an aggregate row
   * when an aggregate (per-user) cap is configured. `used`/`held` are read from
   * the same store accounting the admission path uses; `resetsAt` is the store's
   * period boundary (never hardcoded).
   */
  async getUsageSummary(
    user: GovernanceUserLike | null | undefined,
    reader: GovernanceUsageSpendReader,
  ): Promise<GovernanceUsageSummary> {
    if (!this.loaded.enabled) return { ...this.usageSummaryMeta(user), currency: 'EUR', models: [], aggregate: null }
    const userPolicy = this.userPolicy(user)
    const userId = user?.id
    if (!userPolicy || !userId) return { ...this.usageSummaryMeta(user), currency: 'EUR', models: [], aggregate: null }

    const models: GovernanceUsageEntry[] = []
    for (const grant of userPolicy.models) {
      const snapshot = await reader.getSpendSnapshot({ scope: 'model', userId, provider: grant.provider, model: grant.id })
      models.push(buildUsageEntry({
        provider: grant.provider,
        id: grant.id,
        label: grant.id,
        budgetMicros: grant.monthlyBudgetMicros,
        snapshot,
      }))
    }

    let aggregate: GovernanceUsageEntry | null = null
    const aggregateBudgetMicros = userPolicy.budgets.monthlyMicros
    if (aggregateBudgetMicros !== null) {
      const snapshot = await reader.getSpendSnapshot({ scope: 'user', userId })
      aggregate = buildUsageEntry({
        provider: '',
        id: '__all__',
        label: 'All models',
        budgetMicros: aggregateBudgetMicros,
        snapshot,
      })
    }

    return { ...this.usageSummaryMeta(user), currency: 'EUR', models, aggregate }
  }

  /**
   * Non per-model summary fields (role, aggregate cap, company-context access +
   * rules) shared by every getUsageSummary return path and by the plugin route's
   * empty fallback. Reuses the existing policy accessors so the panel and the
   * admission path can never disagree.
   */
  usageSummaryMeta(user: GovernanceUserLike | null | undefined): {
    enabled: boolean
    role: TenantRole | null
    aggregateCapMicros: number | null
    companyContextAccess: CompanyContextAccess
    companyContextRules: string[]
  } {
    return {
      enabled: this.loaded.enabled,
      role: this.roleForUser(user),
      aggregateCapMicros: user ? this.userMonthlyBudgetMicros(user) : null,
      companyContextAccess: this.companyContextAccessForUser(user),
      companyContextRules: user ? this.companyContextRules(user) : [],
    }
  }

  me(user: GovernanceUserLike | null | undefined): GovernanceMeResponse {
    const role = this.roleForUser(user)
    const admin = role === 'admin'
    const base: GovernanceMeResponse = {
      enabled: this.loaded.enabled,
      role,
      admin,
    }
    if (!this.loaded.enabled) return base
    const policy = this.loaded.policy
    if (!policy) {
      return { ...base, policyStatus: this.loaded.status }
    }
    if (!admin) return base
    return {
      ...base,
      policyStatus: this.loaded.status,
      tenant: {
        id: policy.tenant.id,
        companyContextWorkspaceId: policy.tenant.companyContextWorkspaceId,
        defaultMonthlyModelBudgetEur: policy.tenant.defaultMonthlyModelBudgetEur,
        perRunHoldEur: policy.tenant.perRunHoldEur,
      },
      users: policy.users.map((entry) => ({
        email: entry.email,
        role: entry.role,
        modelCount: entry.models.length,
        monthlyBudgetEur: entry.budgets.monthlyEur,
        contextRuleCount: entry.companyContext.allow.length,
      })),
      models: policy.users.flatMap((entry) => entry.models.map((model) => ({ ...model, email: entry.email }))),
      companyContextRules: policy.users.flatMap((entry) => (
        entry.companyContext.allow.map((pattern) => ({ email: entry.email, pattern }))
      )),
    }
  }
}

function buildUsageEntry(args: {
  provider: string
  id: string
  label: string
  budgetMicros: number | null
  snapshot: { usedMicros: number; heldMicros: number; periodEnd: Date }
}): GovernanceUsageEntry {
  const { provider, id, label, budgetMicros, snapshot } = args
  const usedMicros = Math.max(0, snapshot.usedMicros)
  const heldMicros = Math.max(0, snapshot.heldMicros)
  const consumedMicros = usedMicros + heldMicros
  const base = { provider, id, label, usedMicros, heldMicros, resetsAt: snapshot.periodEnd.toISOString() }
  if (budgetMicros === null) {
    // No cap configured: report usage but no percentage/bar.
    return { ...base, budgetMicros: null, remainingMicros: null, pctUsed: null }
  }
  if (budgetMicros <= 0) {
    // Zero budget: no room; treat as fully consumed.
    return { ...base, budgetMicros, remainingMicros: 0, pctUsed: 100 }
  }
  return {
    ...base,
    budgetMicros,
    remainingMicros: Math.max(0, budgetMicros - consumedMicros),
    pctUsed: Math.min(100, Math.round((consumedMicros / budgetMicros) * 100)),
  }
}

export function createGovernanceService(result: GovernanceLoadResult): GovernanceService {
  return new GovernanceService(result)
}
