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

export type GovernancePolicyErrorCode = 'disabled' | 'invalid' | 'denied' | 'not_allowed'

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

  companyContextRules(user: GovernanceUserLike): string[] {
    if (!this.loaded.enabled) return []
    return this.userPolicy(user)?.companyContext.allow ?? []
  }

  companyContextWorkspaceId(): string | null {
    return this.enabledPolicy()?.tenant.companyContextWorkspaceId ?? null
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
        contextRuleCount: entry.companyContext.allow.length,
      })),
      models: policy.users.flatMap((entry) => entry.models.map((model) => ({ ...model, email: entry.email }))),
      companyContextRules: policy.users.flatMap((entry) => (
        entry.companyContext.allow.map((pattern) => ({ email: entry.email, pattern }))
      )),
    }
  }
}

export function createGovernanceService(result: GovernanceLoadResult): GovernanceService {
  return new GovernanceService(result)
}
