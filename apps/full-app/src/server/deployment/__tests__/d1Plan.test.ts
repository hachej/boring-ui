import { describe, expect, it } from 'vitest'

import { D1HostErrorCode, parseD1HostPlan } from '../d1Plan.js'

const digest = `sha256:${'a'.repeat(64)}`

function binding(id: string, overrides: Record<string, unknown> = {}) {
  return {
    bindingId: id,
    hostname: `${id}.example.test`,
    workspaceId: `workspace-${id}`,
    defaultDeploymentId: `deployment-${id}`,
    bundleRef: `bundle-${id}`,
    deploymentRef: `deployment-ref-${id}`,
    workspaceAllocationRef: `workspace-allocation-${id}`,
    sessionAllocationRef: `session-allocation-${id}`,
    ownerPrincipalRef: `owner-${id}`,
    landing: { title: `Agent ${id}`, summary: 'A bounded landing.' },
    environmentRef: `environment-${id}`,
    secretRefs: [`secret-${id}-z`, `secret-${id}-a`],
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    hostId: 'eu-host-1',
    expectedHostRevision: null,
    hostAppImageDigest: digest,
    runtimeProfileRef: 'runsc-eu-1',
    databaseRef: 'postgres-eu-1',
    workspaceRootPolicyRef: 'workspace-roots-eu-1',
    sessionRootPolicyRef: 'session-roots-eu-1',
    bindings: [binding('z'), binding('a')],
    ...overrides,
  }
}

describe('parseD1HostPlan', () => {
  it('strictly validates and freezes a canonical lexical plan', () => {
    const parsed = parseD1HostPlan(plan({ bindings: [
      binding('z'),
      binding('a', { workspaceId: 'espace:éclair', defaultDeploymentId: 'assurance:eu' }),
    ] }))

    expect(parsed.bindings.map((entry) => entry.bindingId)).toEqual(['a', 'z'])
    expect(parsed.bindings[0].secretRefs).toEqual(['secret-a-a', 'secret-a-z'])
    expect(parsed.bindings[0]).toMatchObject({ workspaceId: 'espace:éclair', defaultDeploymentId: 'assurance:eu' })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.bindings)).toBe(true)
    expect(Object.isFrozen(parsed.bindings[0].landing)).toBe(true)
  })

  it.each([
    ['raw path ref', plan({ databaseRef: '/srv/postgres' }), 'databaseRef'],
    ['URL ref', plan({ runtimeProfileRef: 'https://profiles.test/runsc' }), 'runtimeProfileRef'],
    ['environment assignment', plan({ databaseRef: 'TOKEN=value' }), 'databaseRef'],
    ['unknown secret field', { ...plan(), databasePassword: 'do-not-echo' }, 'databasePassword'],
    ['duplicate workspace', plan({ bindings: [binding('a'), binding('b', { workspaceId: 'workspace-a' })] }), 'bindings.workspaceId'],
  ])('rejects %s without echoing input', (_name, input, field) => {
    try {
      parseD1HostPlan(input)
      throw new Error('expected plan rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: D1HostErrorCode.PLAN_INVALID, details: { field } })
      expect(JSON.stringify(error)).not.toContain('do-not-echo')
      expect(JSON.stringify(error)).not.toContain('/srv/postgres')
    }
  })

  it.each(['192.168.1.1', '127.1', '127.0.0.01', '0127.0.0.1', '0x7f.0.0.1'])(
    'rejects IP-like hostname %s',
    (hostname) => {
      expect(() => parseD1HostPlan(plan({ bindings: [binding('a', { hostname })] })))
        .toThrow(expect.objectContaining({
          code: D1HostErrorCode.PLAN_INVALID,
          details: { field: 'bindings[0].hostname' },
        }))
    },
  )

  it('admits only binding ids whose .env filename fits NAME_MAX', () => {
    const longest = 'a'.repeat(251)
    expect(parseD1HostPlan(plan({ bindings: [{ ...binding('a'), bindingId: longest }] })).bindings[0].bindingId).toBe(longest)
    expect(() => parseD1HostPlan(plan({ bindings: [{ ...binding('a'), bindingId: `${longest}a` }] })))
      .toThrow(expect.objectContaining({ code: D1HostErrorCode.PLAN_INVALID, details: { field: 'bindings[0].bindingId' } }))
  })

  it('admits only host ids that fit one filesystem path component', () => {
    expect(parseD1HostPlan(plan({ hostId: 'a'.repeat(250) })).hostId).toBe('a'.repeat(250))
    expect(() => parseD1HostPlan(plan({ hostId: 'a'.repeat(251) })))
      .toThrow(expect.objectContaining({ code: D1HostErrorCode.PLAN_INVALID, details: { field: 'hostId' } }))
  })
})
