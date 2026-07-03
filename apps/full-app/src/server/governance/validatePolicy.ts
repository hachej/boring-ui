import type {
  GovernanceModelGrant,
  GovernancePolicy,
  GovernancePolicyFile,
  GovernanceUserPolicy,
  TenantRole,
} from './policyTypes.js'

const MICROS_PER_EUR = 1_000_000
const MAX_REGEX_LENGTH = 512
const MAX_CONTEXT_RULES_PER_USER = 128

function fail(message: string): never {
  throw new Error(message)
}

export function normalizePolicyEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`)
  }
  return value.trim()
}

function finiteNumber(value: unknown, path: string, opts: { min: number; allowZero: boolean }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`)
  }
  if (opts.allowZero ? value < opts.min : value <= opts.min) {
    fail(`${path} must be ${opts.allowZero ? '>=' : '>'} ${opts.min}`)
  }
  return value
}

function validateRegexPattern(value: unknown, path: string): string {
  const pattern = nonEmptyString(value, path)
  if (pattern.length > MAX_REGEX_LENGTH) fail(`${path} must be at most ${MAX_REGEX_LENGTH} characters`)
  // v1 safety subset: require anchored path-like allow rules and reject common catastrophic nested quantifier shapes.
  if (!pattern.startsWith('^/')) fail(`${path} must start with ^/`)
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
    fail(`${path} contains an unsafe nested quantifier`)
  }
  try {
    new RegExp(pattern)
  } catch (error) {
    fail(`${path} must compile as a JavaScript RegExp: ${error instanceof Error ? error.message : String(error)}`)
  }
  return pattern
}

function validateModels(value: unknown, userPath: string): GovernanceModelGrant[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${userPath}.models must be an array`)
  return value.map((entry, index) => {
    const path = `${userPath}.models[${index}]`
    if (!isRecord(entry)) fail(`${path} must be an object`)
    const provider = nonEmptyString(entry.provider, `${path}.provider`)
    const id = nonEmptyString(entry.id, `${path}.id`)
    const monthlyBudgetEur = finiteNumber(entry.monthlyBudgetEur, `${path}.monthlyBudgetEur`, {
      min: 0,
      allowZero: true,
    })
    return {
      provider,
      id,
      monthlyBudgetEur,
      monthlyBudgetMicros: Math.round(monthlyBudgetEur * MICROS_PER_EUR),
    }
  })
}

function validateCompanyContext(value: unknown, userPath: string): { allow: string[] } {
  if (value === undefined) return { allow: [] }
  if (!isRecord(value)) fail(`${userPath}.companyContext must be an object`)
  const allow = value.allow
  if (allow === undefined) return { allow: [] }
  if (!Array.isArray(allow)) fail(`${userPath}.companyContext.allow must be an array`)
  if (allow.length > MAX_CONTEXT_RULES_PER_USER) {
    fail(`${userPath}.companyContext.allow must contain at most ${MAX_CONTEXT_RULES_PER_USER} rules`)
  }
  return {
    allow: allow.map((pattern, index) => validateRegexPattern(pattern, `${userPath}.companyContext.allow[${index}]`)),
  }
}

function validateRole(value: unknown, path: string): TenantRole {
  if (value !== 'admin' && value !== 'user') fail(`${path} must be admin or user`)
  return value
}

export function validateGovernancePolicy(input: unknown): GovernancePolicy {
  if (!isRecord(input)) fail('policy must be an object')
  const candidate = input as GovernancePolicyFile
  if (!isRecord(candidate.tenant)) fail('tenant must be an object')
  const tenant = candidate.tenant
  const tenantId = nonEmptyString(tenant.id, 'tenant.id')
  const companyContextWorkspaceId = tenant.companyContextWorkspaceId === undefined || tenant.companyContextWorkspaceId === null
    ? null
    : nonEmptyString(tenant.companyContextWorkspaceId, 'tenant.companyContextWorkspaceId')
  const defaultMonthlyModelBudgetEur = tenant.defaultMonthlyModelBudgetEur === undefined
    ? 0
    : finiteNumber(tenant.defaultMonthlyModelBudgetEur, 'tenant.defaultMonthlyModelBudgetEur', { min: 0, allowZero: true })
  const perRunHoldEur = tenant.perRunHoldEur === undefined
    ? 1
    : finiteNumber(tenant.perRunHoldEur, 'tenant.perRunHoldEur', { min: 0, allowZero: false })

  if (!Array.isArray(candidate.users)) fail('users must be an array')
  const usersByEmail = new Map<string, GovernanceUserPolicy>()
  const users: GovernanceUserPolicy[] = candidate.users.map((entry, index) => {
    const path = `users[${index}]`
    if (!isRecord(entry)) fail(`${path} must be an object`)
    const email = normalizePolicyEmail(nonEmptyString(entry.email, `${path}.email`))
    if (!email.includes('@')) fail(`${path}.email must be an email address`)
    if (usersByEmail.has(email)) fail(`duplicate user email: ${email}`)
    const user: GovernanceUserPolicy = {
      email,
      role: validateRole(entry.role, `${path}.role`),
      models: validateModels(entry.models, path),
      companyContext: validateCompanyContext(entry.companyContext, path),
    }
    usersByEmail.set(email, user)
    return user
  })

  return {
    tenant: {
      id: tenantId,
      companyContextWorkspaceId,
      defaultMonthlyModelBudgetEur,
      perRunHoldEur,
      perRunHoldMicros: Math.round(perRunHoldEur * MICROS_PER_EUR),
    },
    users,
    usersByEmail,
  }
}
