export type TenantRole = 'admin' | 'user'

export interface GovernancePolicyFile {
  tenant?: {
    id?: unknown
    companyContextWorkspaceId?: unknown
    defaultMonthlyModelBudgetEur?: unknown
    perRunHoldEur?: unknown
  }
  users?: unknown
}

export interface GovernanceModelGrant {
  provider: string
  id: string
  monthlyBudgetEur: number
  monthlyBudgetMicros: number
}

export interface GovernanceUserPolicy {
  email: string
  role: TenantRole
  models: GovernanceModelGrant[]
  companyContext: {
    allow: string[]
  }
}

export interface GovernancePolicy {
  tenant: {
    id: string
    companyContextWorkspaceId: string | null
    defaultMonthlyModelBudgetEur: number
    perRunHoldEur: number
    perRunHoldMicros: number
  }
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
