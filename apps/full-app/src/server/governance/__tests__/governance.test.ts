import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { createGovernanceModelFilter } from '../index.js'
import { createGovernanceService } from '../governanceService.js'
import { loadGovernancePolicy, GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV } from '../loadPolicy.js'
import { governanceRoutes } from '../routes.js'
import { validateGovernancePolicy } from '../validatePolicy.js'

const configWithMail = { auth: { mail: { enabled: true } } } as any

async function writePolicy(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'boring-governance-'))
  const file = path.join(dir, 'policy.yaml')
  await writeFile(file, contents, 'utf8')
  return file
}

const VALID_POLICY = `
tenant:
  id: company
  companyContextWorkspaceId: company-ws
  defaultMonthlyModelBudgetEur: 0
  perRunHoldEur: 1
users:
  - email: Admin@Example.COM
    role: admin
    models:
      - provider: infomaniak
        id: qwen
        monthlyBudgetEur: 25
    companyContext:
      allow:
        - '^/.*'
  - email: user@example.com
    role: user
    models:
      - provider: infomaniak
        id: qwen
        monthlyBudgetEur: 5
    companyContext:
      allow:
        - '^/public/.*'
`

describe('governance policy loader', () => {
  it('returns disabled when no policy path is configured', async () => {
    const result = await loadGovernancePolicy({ env: {}, config: configWithMail })

    expect(result.enabled).toBe(false)
    expect(result.status).toMatchObject({ state: 'disabled', reason: 'missing-env' })
  })

  it('loads and normalizes a valid policy', async () => {
    const policyPath = await writePolicy(VALID_POLICY)
    const result = await loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      config: configWithMail,
    })

    expect(result.enabled).toBe(true)
    expect(result.policy?.users[0]?.email).toBe('admin@example.com')
    expect(result.policy?.users[0]?.models[0]?.monthlyBudgetMicros).toBe(25_000_000)
    expect(result.status).toMatchObject({ state: 'active', tenantId: 'company', userCount: 2 })
  })

  it('returns invalid in development for bad YAML and throws in production', async () => {
    const policyPath = await writePolicy('tenant: [')

    const dev = await loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      nodeEnv: 'development',
      config: configWithMail,
    })
    expect(dev.enabled).toBe(true)
    expect(dev.status.state).toBe('invalid')

    await expect(loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      nodeEnv: 'production',
      config: configWithMail,
    })).rejects.toThrow()
  })

  it('rejects duplicate users after lowercase trim normalization', () => {
    expect(() => validateGovernancePolicy({
      tenant: { id: 'company', perRunHoldEur: 1 },
      users: [
        { email: ' Admin@Example.com ', role: 'admin' },
        { email: 'admin@example.com', role: 'user' },
      ],
    })).toThrow(/duplicate user email/)
  })

  it('rejects invalid roles, budgets, and unsafe regexes', () => {
    expect(() => validateGovernancePolicy({
      tenant: { id: 'company', perRunHoldEur: 1 },
      users: [{ email: 'a@example.com', role: 'owner' }],
    })).toThrow(/role/)

    expect(() => validateGovernancePolicy({
      tenant: { id: 'company', perRunHoldEur: 1 },
      users: [{ email: 'a@example.com', role: 'user', models: [{ provider: 'p', id: 'm', monthlyBudgetEur: -1 }] }],
    })).toThrow(/monthlyBudgetEur/)

    expect(() => validateGovernancePolicy({
      tenant: { id: 'company', perRunHoldEur: 1 },
      users: [{ email: 'a@example.com', role: 'user', companyContext: { allow: ['(a+)+$'] } }],
    })).toThrow(/must start with/)
  })

  it('fails governance-enabled boot without email verification config unless dev override is set', async () => {
    const policyPath = await writePolicy(VALID_POLICY)

    await expect(loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      nodeEnv: 'production',
      config: { auth: {} } as any,
    })).rejects.toThrow(/email verification/)

    const dev = await loadGovernancePolicy({
      env: {
        BORING_GOVERNANCE_POLICY_PATH: policyPath,
        [GOVERNANCE_DEV_EMAIL_VERIFICATION_OVERRIDE_ENV]: '1',
      },
      nodeEnv: 'development',
      config: { auth: {} } as any,
    })
    expect(dev.enabled).toBe(true)
    expect(dev.status.state).toBe('active')
  })
})

describe('governance service and route', () => {
  it('denies all policy-derived privileges for unverified users', async () => {
    const policyPath = await writePolicy(VALID_POLICY)
    const loaded = await loadGovernancePolicy({ env: { BORING_GOVERNANCE_POLICY_PATH: policyPath }, config: configWithMail })
    const service = createGovernanceService(loaded)
    const user = { email: 'admin@example.com', emailVerified: false }

    expect(service.roleForUser(user)).toBeNull()
    expect(service.isAdmin(user)).toBe(false)
    expect(service.allowedModelsForUser(user, [{ provider: 'infomaniak', id: 'qwen' }])).toEqual([])
    expect(service.monthlyBudgetMicros(user, { provider: 'infomaniak', id: 'qwen' })).toBeNull()
    expect(service.companyContextRules(user)).toEqual([])
  })

  it('returns safe /api/v1/governance/me payloads for admin and normal users', async () => {
    const policyPath = await writePolicy(VALID_POLICY)
    const service = createGovernanceService(await loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      config: configWithMail,
    }))
    const app = Fastify()
    app.addHook('preHandler', async (request) => {
      const email = request.headers['x-test-email'] as string
      request.user = { id: email, email, name: null, emailVerified: request.headers['x-test-verified'] === '1' }
    })
    await app.register(governanceRoutes(service))

    const admin = await app.inject({ method: 'GET', url: '/api/v1/governance/me', headers: { 'x-test-email': 'admin@example.com', 'x-test-verified': '1' } })
    expect(admin.statusCode).toBe(200)
    expect(admin.json()).toMatchObject({ enabled: true, role: 'admin', admin: true, tenant: { id: 'company' } })

    const normal = await app.inject({ method: 'GET', url: '/api/v1/governance/me', headers: { 'x-test-email': 'user@example.com', 'x-test-verified': '1' } })
    expect(normal.statusCode).toBe(200)
    expect(normal.json()).toEqual({ enabled: true, role: 'user', admin: false })

    await app.close()
  })

  it('filters exact models and removes denied default', async () => {
    const policyPath = await writePolicy(VALID_POLICY)
    const service = createGovernanceService(await loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      config: configWithMail,
    }))
    const filter = createGovernanceModelFilter(service)!
    const request = {
      user: { id: 'user-1', email: 'user@example.com', name: null, emailVerified: true },
      workspaceContext: { workspaceId: 'ws-a' },
    } as any

    const result = await filter(
      { request, workspaceId: 'ws-a' },
      [
        { provider: 'infomaniak', id: 'qwen', label: 'Qwen', available: true },
        { provider: 'openai', id: 'gpt', label: 'GPT', available: true },
      ],
      { provider: 'openai', id: 'gpt' },
    )

    expect(result.models).toEqual([{ provider: 'infomaniak', id: 'qwen', label: 'Qwen', available: true }])
    expect(result.defaultModel).toBeUndefined()
  })

  it('returns no models for unverified users when governance is enabled', async () => {
    const policyPath = await writePolicy(VALID_POLICY)
    const service = createGovernanceService(await loadGovernancePolicy({
      env: { BORING_GOVERNANCE_POLICY_PATH: policyPath },
      config: configWithMail,
    }))
    const filter = createGovernanceModelFilter(service)!
    const request = {
      user: { id: 'admin', email: 'admin@example.com', name: null, emailVerified: false },
      workspaceContext: { workspaceId: 'ws-a' },
    } as any

    const result = await filter(
      { request, workspaceId: 'ws-a' },
      [{ provider: 'infomaniak', id: 'qwen', label: 'Qwen', available: true }],
      { provider: 'infomaniak', id: 'qwen' },
    )

    expect(result.models).toEqual([])
    expect(result.defaultModel).toBeUndefined()
  })

  it('surfaces invalid dev policy status because no policy-derived admin exists', async () => {
    const service = createGovernanceService({
      enabled: true,
      policy: null,
      status: { state: 'invalid', path: '/tmp/policy.yaml', message: 'bad yaml' },
    })
    const app = Fastify()
    app.addHook('preHandler', async (request) => {
      request.user = { id: 'user-1', email: 'user@example.com', name: null, emailVerified: true }
    })
    await app.register(governanceRoutes(service))

    const response = await app.inject({ method: 'GET', url: '/api/v1/governance/me' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      enabled: true,
      role: null,
      admin: false,
      policyStatus: { state: 'invalid', message: 'bad yaml' },
    })
    await app.close()
  })
})
