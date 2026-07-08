import type { PluginSkillAccess } from '@hachej/boring-agent/server'

export type TenantRole = 'admin' | 'user'
export type GovernanceSkillAccess = PluginSkillAccess

export interface GovernanceSkillGrant {
  plugin: string
  name: string
  access: GovernanceSkillAccess
}

export interface GovernancePolicyFile {
  tenant?: {
    id?: unknown
    companyContextWorkspaceId?: unknown
    defaultMonthlyModelBudgetEur?: unknown
    perRunHoldEur?: unknown
  }
  roles?: unknown
  users?: unknown
}

export interface GovernanceModelGrant {
  provider: string
  id: string
  monthlyBudgetEur: number
  monthlyBudgetMicros: number
}

export interface GovernanceUserBudgets {
  monthlyEur: number | null
  monthlyMicros: number | null
}

export interface GovernanceUserPolicy {
  email: string
  role: TenantRole
  budgets: GovernanceUserBudgets
  models: GovernanceModelGrant[]
  companyContext: {
    allow: string[]
  }
  skills: GovernanceSkillGrant[]
}

export interface GovernanceRolePolicy {
  skills: GovernanceSkillGrant[]
}

export interface GovernancePolicy {
  tenant: {
    id: string
    companyContextWorkspaceId: string | null
    defaultMonthlyModelBudgetEur: number
    perRunHoldEur: number
    perRunHoldMicros: number
  }
  roles: Record<TenantRole, GovernanceRolePolicy>
  users: GovernanceUserPolicy[]
  usersByEmail: Map<string, GovernanceUserPolicy>
}

export type GovernancePolicyStatus =
  | { state: 'disabled'; reason: 'missing-env' | 'missing-file'; path: string | null }
  | { state: 'active'; path: string; tenantId: string; userCount: number }
  | { state: 'invalid'; path: string; message: string }

export interface GovernanceLoadResult {
  enabled: boolean
  policy: GovernancePolicy | null
  status: GovernancePolicyStatus
}

export interface GovernanceUserLike {
  id?: string
  email: string
  emailVerified: boolean
}

export interface ServedModelLike {
  provider: string
  id: string
}
