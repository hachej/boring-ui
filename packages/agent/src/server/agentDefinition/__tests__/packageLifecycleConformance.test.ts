import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'

import { createAgentHost } from '../../agent-host/createAgentHost'
import { LEGACY_DEFAULT_AGENT_FLEET } from '../resolveDefaultAgentFleet'
import { loadConfiguredAgentFleet, type DiscoveredAgentPackageDescriptor } from '../loadConfiguredAgentFleet'
import type { AuthorizedAgentScope } from '../../../shared/gateway/types'
import { ErrorCode } from '../../../shared/error-codes'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const MODEL_TIERS = [
  'models:',
  '  tiers:',
  '    T3:',
  '      - provider: openai',
  '        id: gpt-5.6-sol',
  '        envVar: OPENAI_API_KEY',
].join('\n')

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-package-lifecycle-'))
  roots.push(root)
  const packageRoot = join(root, 'package')
  const fleetConfigPath = join(root, 'fleet.yaml')
  await mkdir(packageRoot, { recursive: true })
  const writePackage = async (version: string, instructions: string) => {
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@fixture/lifecycle',
      version,
      boring: { agent: { definitionId: 'fixture-lifecycle', version, label: 'Lifecycle', instructionsRef: 'instructions.md' } },
      pi: { skills: [] },
    }))
    await writeFile(join(packageRoot, 'instructions.md'), instructions)
  }
  const writeSeated = async (seated: boolean) => {
    await writeFile(fleetConfigPath, `${MODEL_TIERS}\n${seated
      ? 'seats:\n  - seat: lifecycle\n    agentTypeId: fixture-lifecycle\n    skills: []\n'
      : 'seats: []\n'}`)
  }
  const descriptor = (version: string): DiscoveredAgentPackageDescriptor => ({
    rootDir: packageRoot,
    manifest: {
      boring: { agent: { definitionId: 'fixture-lifecycle', version, label: 'Lifecycle', instructionsRef: 'instructions.md' } },
      pi: { skills: [] },
    },
    preflight: { ok: true },
  })
  return { root, packageRoot, fleetConfigPath, writePackage, writeSeated, descriptor }
}

async function boot(input: {
  root: string
  fleetConfigPath: string
  discoveredPackages: readonly DiscoveredAgentPackageDescriptor[]
}) {
  const loaded = await loadConfiguredAgentFleet({
    discoveredPackages: input.discoveredPackages,
    workspaceRoot: input.root,
    fleetConfigPath: input.fleetConfigPath,
    policyPath: join(input.root, 'policy.yaml'),
    skillsRoot: join(input.root, 'skills'),
    env: {},
  })
  const sessionRoot = join(input.root, `sessions-${Math.random().toString(16).slice(2)}`)
  const host = await createAgentHost({
    agents: [...LEGACY_DEFAULT_AGENT_FLEET, ...loaded.agents],
    fleetCompiler: { compile: async ({ agents }) => agents },
    scopeVerifier: { verify: async (scope) => ({ workspaceScopeId: scope.workspaceScopeId, authSubjectId: scope.authSubjectId }) },
    runtimeModeAdapter: createTestRuntimeModeAdapter('direct'),
    sessionRoot,
    resolveAuthorizedEnvironmentScope: async () => ({
      placementIdentity: 'direct',
      workspaceRoot: input.root,
      provisioningFingerprint: 'lifecycle',
    }),
    resolveAuthorizedAgentRuntimeScope: async ({ agentTypeId }) => ({
      identity: `runtime:${agentTypeId}`,
      physicalBindingIdentity: `runtime:${agentTypeId}`,
      resourceInputDigest: `runtime:${agentTypeId}`,
      sessionNamespace: agentTypeId,
    }),
  })
  const scope = { workspaceScopeId: 'workspace', authSubjectId: 'owner' } as AuthorizedAgentScope
  return { loaded, host, catalog: await host.gateway.listAgents({ scope }), description: await host.host.describe() }
}

describe('repo/local Agent package lifecycle conformance', () => {
  test('discover → seat → restart activation → update → rollback → unseat/remove preserves exact version and digest inventory', async () => {
    const fixture = await createFixture()
    await fixture.writePackage('1.0.0', 'Version one.\n')
    await fixture.writeSeated(false)

    const discovered = await boot({ ...fixture, discoveredPackages: [fixture.descriptor('1.0.0')] })
    expect(discovered.loaded.diagnostics).toContainEqual(expect.objectContaining({
      agentTypeId: 'fixture-lifecycle',
      code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
    }))
    expect(discovered.catalog.map((agent) => agent.agentTypeId)).toEqual(['default'])
    await discovered.host.host.close()

    await fixture.writeSeated(true)
    const installed = await boot({ ...fixture, discoveredPackages: [fixture.descriptor('1.0.0')] })
    const v1 = installed.catalog.find((agent) => agent.agentTypeId === 'fixture-lifecycle')
    expect(v1?.definition).toEqual({
      version: '1.0.0',
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })
    expect(installed.description.agents).toContainEqual(expect.objectContaining({
      agentTypeId: 'fixture-lifecycle',
      definitionVersion: '1.0.0',
      definitionDigest: v1?.definition?.digest,
    }))
    const v1Digest = v1?.definition?.digest
    await installed.host.host.close()

    await fixture.writePackage('2.0.0', 'Version two.\n')
    const updated = await boot({ ...fixture, discoveredPackages: [fixture.descriptor('2.0.0')] })
    const v2 = updated.catalog.find((agent) => agent.agentTypeId === 'fixture-lifecycle')
    expect(v2?.definition?.version).toBe('2.0.0')
    expect(v2?.definition?.digest).not.toBe(v1Digest)
    await updated.host.host.close()

    await fixture.writePackage('1.0.0', 'Version one.\n')
    const rolledBack = await boot({ ...fixture, discoveredPackages: [fixture.descriptor('1.0.0')] })
    expect(rolledBack.catalog.find((agent) => agent.agentTypeId === 'fixture-lifecycle')?.definition).toEqual({
      version: '1.0.0',
      digest: v1Digest,
    })
    await rolledBack.host.host.close()

    await fixture.writeSeated(false)
    const unseated = await boot({ ...fixture, discoveredPackages: [fixture.descriptor('1.0.0')] })
    expect(unseated.catalog.map((agent) => agent.agentTypeId)).toEqual(['default'])
    await unseated.host.host.close()

    const removed = await boot({ ...fixture, discoveredPackages: [] })
    expect(removed.catalog.map((agent) => agent.agentTypeId)).toEqual(['default'])
    await removed.host.host.close()
  })
})
