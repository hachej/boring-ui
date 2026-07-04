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

function uuidString(value: unknown, path: string): string {
  const id = nonEmptyString(value, path)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    fail(`${path} must be a UUID workspace id`)
  }
  return id
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

const LITERAL_REGEX_ESCAPES = new Set(['\\', '/', '.', '-', '^', '$', '+', '*', '?', '(', ')', '[', ']', '{', '}', '|'])

function literalPathPrefix(pattern: string): { prefix: string; consumed: number; unsafeEscape: boolean } {
  let prefix = ''
  let index = '^/'.length
  let unsafeEscape = false
  while (index < pattern.length) {
    const char = pattern[index]
    if (!char) break
    if (char === '\\') {
      const escaped = pattern[index + 1]
      if (!escaped) break
      if (!LITERAL_REGEX_ESCAPES.has(escaped)) {
        unsafeEscape = true
        break
      }
      prefix += escaped
      index += 2
      continue
    }
    if ('^$.+*?()[]{}|'.includes(char)) break
    prefix += char
    index += 1
  }
  return { prefix, consumed: index - '^/'.length, unsafeEscape }
}

function hasTopLevelAlternation(pattern: string): boolean {
  let escaped = false
  let inCharacterClass = false
  let groupDepth = 0
  for (const char of pattern) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (inCharacterClass) {
      if (char === ']') inCharacterClass = false
      continue
    }
    if (char === '[') {
      inCharacterClass = true
      continue
    }
    if (char === '(') {
      groupDepth += 1
      continue
    }
    if (char === ')') {
      groupDepth = Math.max(0, groupDepth - 1)
      continue
    }
    if (char === '|' && groupDepth === 0) return true
  }
  return false
}

function validateSegmentSafePattern(pattern: string, path: string): void {
  const { prefix, consumed, unsafeEscape } = literalPathPrefix(pattern)
  if (unsafeEscape) fail(`${path} must use only literal regex escapes before the path-segment boundary`)
  if (!prefix) {
    const remainder = pattern.slice('^/'.length)
    if (remainder.startsWith('.*') || remainder.startsWith('$')) return
    fail(`${path} must start with a literal path segment or ^/.*`)
  }
  const remainder = pattern.slice('^/'.length + consumed)
  if (prefix.endsWith('/')) {
    if (/^[?*+{]/.test(remainder)) fail(`${path} must not make the path-segment boundary slash optional`)
    return
  }
  if (remainder.startsWith('$')) return
  for (const guard of ['(?:/|$)', '(?:$|/)', '(/|$)', '($|/)']) {
    if (!remainder.startsWith(guard)) continue
    if (/^[?*+{]/.test(remainder.slice(guard.length))) {
      fail(`${path} must not make the path-segment boundary guard optional`)
    }
    return
  }
  fail(`${path} must make literal path-prefix grants segment-safe with /, $, or (?:/|$)`)
}

function validateRegexPattern(value: unknown, path: string): string {
  const pattern = nonEmptyString(value, path)
  if (pattern.length > MAX_REGEX_LENGTH) fail(`${path} must be at most ${MAX_REGEX_LENGTH} characters`)
  // v1 safety subset: require anchored path-like allow rules and reject common catastrophic nested quantifier shapes.
  if (!pattern.startsWith('^/')) fail(`${path} must start with ^/`)
  if (hasTopLevelAlternation(pattern)) fail(`${path} must not use top-level regex alternation; add separate allow rules instead`)
  validateSegmentSafePattern(pattern, path)
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

function validateModels(value: unknown, userPath: string, defaultMonthlyModelBudgetEur: number): GovernanceModelGrant[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${userPath}.models must be an array`)
  return value.map((entry, index) => {
    const path = `${userPath}.models[${index}]`
    if (!isRecord(entry)) fail(`${path} must be an object`)
    const provider = nonEmptyString(entry.provider, `${path}.provider`)
    const id = nonEmptyString(entry.id, `${path}.id`)
    const monthlyBudgetEur = entry.monthlyBudgetEur === undefined
      ? defaultMonthlyModelBudgetEur
      : finiteNumber(entry.monthlyBudgetEur, `${path}.monthlyBudgetEur`, {
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
    : uuidString(tenant.companyContextWorkspaceId, 'tenant.companyContextWorkspaceId')
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
      models: validateModels(entry.models, path, defaultMonthlyModelBudgetEur),
      companyContext: validateCompanyContext(entry.companyContext, path),
    }
    usersByEmail.set(email, user)
    return user
  })

  const companyContextEnforced = users.some((user) => user.companyContext.allow.length > 0)
  if (companyContextEnforced && !companyContextWorkspaceId) {
    fail('tenant.companyContextWorkspaceId is required when company-context rules are configured')
  }

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
