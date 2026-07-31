import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import type { RuntimeModeAdapter } from '../../runtime/mode'
import { createAgentHost } from '../createAgentHost'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import { sessionNamespaceForAgent } from '../sessionInventory'
import type {
  AgentEffectAdmission,
  AgentHostAgentSpec,
  CreateAgentHostOptions,
  RuntimeScopeIdentityMigrationAuthorization,
} from '../types'
import {
  createEnvironmentProvisioningFingerprint,
  createResolvedRuntimeScopeIdentity,
  createRuntimeScopeIdentityDiagnostic,
  type RuntimeScopeIdentityInput,
} from '../runtimeScopeIdentity'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function temporaryRoot() {
  const value = await mkdtemp(join(tmpdir(), 'runtime-scope-pin-'))
  roots.push(value)
  return value
}

const agent = {
  agentTypeId: 'alpha',
  definition: { instructions: 'alpha', label: 'Alpha' },
} as const satisfies AgentHostAgentSpec

function hostOptions(input: {
  sessionRoot: string
  runtimeIdentity: (scope: AuthorizedAgentScope) => string
  createRuntime?: RuntimeModeAdapter['create']
  effectAdmission?: AgentEffectAdmission
  migration?: RuntimeScopeIdentityMigrationAuthorization
  bindingIdentity?: string | ((scope: AuthorizedAgentScope) => string)
}): CreateAgentHostOptions {
  const baseMode = createTestRuntimeModeAdapter('direct')
  return {
    agents: [agent],
    fleetCompiler: { compile: async ({ agents }: { agents: readonly AgentHostAgentSpec[] }) => agents },
    scopeVerifier: {
      verify: async (scope: AuthorizedAgentScope) => ({
        workspaceScopeId: scope.workspaceScopeId,
        authSubjectId: scope.authSubjectId,
      }),
    },
    runtimeModeAdapter: {
      ...baseMode,
      create: input.createRuntime ?? vi.fn(baseMode.create.bind(baseMode)),
    },
    sessionRoot: input.sessionRoot,
    ...(input.effectAdmission ? { effectAdmission: input.effectAdmission } : {}),
    resolveRuntimeScope: async ({ scope }: { scope: AuthorizedAgentScope }) => ({
      identity: input.runtimeIdentity(scope),
      ...(input.bindingIdentity
        ? { bindingIdentity: typeof input.bindingIdentity === 'function' ? input.bindingIdentity(scope) : input.bindingIdentity }
        : {}),
      ...(input.migration ? { sessionIdentityMigrations: [input.migration] } : {}),
      environment: {
        placementIdentity: input.bindingIdentity
          ? typeof input.bindingIdentity === 'function' ? input.bindingIdentity(scope) : input.bindingIdentity
          : 'direct:workspace',
        workspaceRoot: input.sessionRoot,
        provisioningFingerprint: 'provider:generation-a',
      },
      sessionNamespace: 'sessions',
    }),
  }
}

const base: RuntimeScopeIdentityInput = {
  artifacts: [{ pluginId: 'macro', digest: 'artifact-a' }],
  validatedConfig: { currency: 'USD' },
  grants: ['data.read'],
  placementIdentity: 'direct:workspace',
  isolationMode: 'shared',
  toolContractDigests: ['tool-a'],
  provisioningGeneration: 'generation-a',
}

describe('runtime scope identity', () => {
  it.each([
    ['artifact digest', { artifacts: [{ pluginId: 'macro', digest: 'artifact-b' }] }],
    ['validated config', { validatedConfig: { currency: 'EUR' } }],
    ['grant', { grants: ['data.read', 'data.write'] }],
    ['placement', { placementIdentity: 'sandbox:workspace' }],
    ['isolation', { isolationMode: 'dedicated' }],
    ['tool contract', { toolContractDigests: ['tool-b'] }],
    ['provisioning generation', { provisioningGeneration: 'generation-b' }],
  ] satisfies readonly [string, Partial<RuntimeScopeIdentityInput>][])('changes for %s', (_name, change) => {
    expect(createResolvedRuntimeScopeIdentity({ ...base, ...change }))
      .not.toBe(createResolvedRuntimeScopeIdentity(base))
  })

  it('emits separate v1 and versioned v2 identities for offline diagnostics', () => {
    const diagnostic = createRuntimeScopeIdentityDiagnostic(base)
    expect(diagnostic.legacyV1Identity).toMatch(/^[a-f0-9]{64}$/)
    expect(diagnostic.semanticV2Identity).toMatch(/^[a-f0-9]{64}$/)
    expect(diagnostic.semanticV2Identity).not.toBe(diagnostic.legacyV1Identity)
  })

  it('keeps semantic identity stable when only the physical binding changes', () => {
    const semantic = {
      ...base,
      placementClassIdentity: 'direct',
      provisioningIdentity: 'generation-a',
    }
    expect(createResolvedRuntimeScopeIdentity({
      ...semantic,
      placementIdentity: '/checkout/one',
      provisioningGeneration: '/checkout/one/.runtime',
    })).toBe(createResolvedRuntimeScopeIdentity({
      ...semantic,
      placementIdentity: '/checkout/two',
      provisioningGeneration: '/checkout/two/.runtime',
    }))
  })

  it('is stable across ordering-only changes', () => {
    const first = createResolvedRuntimeScopeIdentity({
      ...base,
      artifacts: [{ pluginId: 'b', digest: '2' }, { pluginId: 'a', digest: '1' }],
      grants: ['z', 'a'],
      toolContractDigests: ['2', '1'],
    })
    const second = createResolvedRuntimeScopeIdentity({
      ...base,
      artifacts: [{ pluginId: 'a', digest: '1' }, { pluginId: 'b', digest: '2' }],
      grants: ['a', 'z'],
      toolContractDigests: ['1', '2'],
    })
    expect(first).toBe(second)
  })

  it('uses physical binding identity for cache separation without changing persisted identity', async () => {
    const sessionRoot = await temporaryRoot()
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const host = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'semantic-runtime',
      bindingIdentity: (scope) => `physical:${scope.authSubjectId}`,
      createRuntime,
    }))
    for (const authSubjectId of ['subject-a', 'subject-b']) {
      await host.gateway.createSession({
        scope: { workspaceScopeId: 'workspace-a', authSubjectId } as AuthorizedAgentScope,
        agentTypeId: 'alpha',
        requestId: `create-${authSubjectId}`,
      })
    }
    expect(createRuntime).toHaveBeenCalledTimes(2)
    await host.host.close()
  })

  it('persists a creation pin and rehydrates the matching runtime after Host cache loss', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const collaborator = { workspaceScopeId: 'workspace-a', authSubjectId: 'collaborator' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-shared' }))
    const ref = await first.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'create-pinned',
      title: 'Pinned session',
    })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = join(sessionRoot, namespace, `${ref.sessionId}.jsonl`)
    const header = JSON.parse((await readFile(transcriptPath, 'utf8')).split('\n')[0]!) as {
      boringSessionCtx?: { runtimeScopeIdentity?: string }
    }
    expect(header.boringSessionCtx?.runtimeScopeIdentity).toBe('runtime-shared')
    await first.host.close()

    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'runtime-shared',
      createRuntime,
    }))
    await expect(restarted.gateway.renameSession({
      scope: collaborator,
      ref,
      requestId: 'matching-mutation',
      title: 'Reused safely',
    })).resolves.toMatchObject({ ref, title: 'Reused safely' })
    await expect(restarted.gateway.readSessionState({ scope: collaborator, ref })).resolves.toMatchObject({
      ref,
      summary: { title: 'Reused safely' },
    })
    expect(createRuntime).toHaveBeenCalledOnce()
    await restarted.host.close()
  })

  it('migrates one exact scoped v1 pin before binding and survives a restart without authorization', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const oldIdentity = 'a'.repeat(64)
    const newIdentity = 'b'.repeat(64)
    const evidenceDigest = 'c'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-migration' })
    await first.host.close()

    const migration: RuntimeScopeIdentityMigrationAuthorization = {
      schemaVersion: 1,
      agentTypeId: 'alpha',
      workspaceScopeId: 'workspace-a',
      sessionNamespace: 'sessions',
      fromIdentity: oldIdentity,
      toIdentity: newIdentity,
      evidenceDigest,
    }
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => newIdentity,
      migration,
      createRuntime,
    }))
    await Promise.all([
      restarted.gateway.renameSession({ scope, ref, requestId: 'migration-a', title: 'Migrated A' }),
      restarted.gateway.renameSession({ scope, ref, requestId: 'migration-b', title: 'Migrated B' }),
    ])
    expect(createRuntime).toHaveBeenCalledOnce()
    await restarted.host.close()

    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const header = JSON.parse((await readFile(join(sessionRoot, namespace, `${ref.sessionId}.jsonl`), 'utf8')).split('\n')[0]!) as {
      boringSessionCtx?: {
        runtimeScopeIdentity?: string
        runtimeScopeIdentityMigration?: { fromIdentity?: string; evidenceDigest?: string }
      }
    }
    expect(header.boringSessionCtx).toMatchObject({
      runtimeScopeIdentity: newIdentity,
      runtimeScopeIdentityMigration: { fromIdentity: oldIdentity, evidenceDigest },
    })

    const secondRestart = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => newIdentity }))
    await expect(secondRestart.gateway.renameSession({
      scope,
      ref,
      requestId: 'post-migration',
      title: 'Still writable',
    })).resolves.toMatchObject({ title: 'Still writable' })
    await secondRestart.host.close()
  })

  it('fails a wrong-scope migration closed before binding or transcript mutation', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const oldIdentity = 'd'.repeat(64)
    const newIdentity = 'e'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-wrong-scope' })
    await first.host.close()
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = join(sessionRoot, namespace, `${ref.sessionId}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => newIdentity,
      createRuntime,
      migration: {
        schemaVersion: 1,
        agentTypeId: 'alpha',
        workspaceScopeId: 'workspace-other',
        sessionNamespace: 'sessions',
        fromIdentity: oldIdentity,
        toIdentity: newIdentity,
        evidenceDigest: 'f'.repeat(64),
      },
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'must-not-migrate',
      title: 'Must not change',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    await restarted.host.close()
  })

  it('fails a migration write closed before binding or transcript mutation', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const oldIdentity = '1'.repeat(64)
    const newIdentity = '2'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-write-failure' })
    await first.host.close()
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const sessionDir = join(sessionRoot, namespace)
    const transcriptPath = join(sessionDir, `${ref.sessionId}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    await chmod(sessionDir, 0o500)
    try {
      const restarted = await createAgentHost(hostOptions({
        sessionRoot,
        runtimeIdentity: () => newIdentity,
        createRuntime,
        migration: {
          schemaVersion: 1,
          agentTypeId: 'alpha',
          workspaceScopeId: 'workspace-a',
          sessionNamespace: 'sessions',
          fromIdentity: oldIdentity,
          toIdentity: newIdentity,
          evidenceDigest: '3'.repeat(64),
        },
      }))
      await expect(restarted.gateway.renameSession({
        scope,
        ref,
        requestId: 'migration-write-failure',
        title: 'Must not change',
      })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
      expect(createRuntime).not.toHaveBeenCalled()
      expect(await readFile(transcriptPath, 'utf8')).toBe(before)
      await restarted.host.close()
    } finally {
      await chmod(sessionDir, 0o700)
    }
  })

  it('fails a restarted mismatching actor closed before a second runtime binding or transcript effect', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const other = { workspaceScopeId: 'workspace-a', authSubjectId: 'other' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-creator' }))
    const ref = await first.gateway.createSession({ scope: creator, agentTypeId: 'alpha', requestId: 'create' })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = join(sessionRoot, namespace, `${ref.sessionId}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    await first.host.close()

    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const admit = vi.fn(async () => ({ type: 'accepted' as const, admissionReceipt: 'accepted' }))
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: (scope) => scope.authSubjectId === 'creator' ? 'runtime-creator' : 'runtime-other',
      createRuntime,
      effectAdmission: { admit },
    }))
    await expect(restarted.gateway.renameSession({
      scope: other,
      ref,
      requestId: 'must-not-mutate',
      title: 'Must not change',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    await restarted.host.close()
  })

  it('uses the first Host-lifetime compatibility runtime for a pre-AH0 unpinned transcript', async () => {
    const sessionRoot = await temporaryRoot()
    const firstReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'legacy-reader-a' } as AuthorizedAgentScope
    const laterReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'legacy-reader-b' } as AuthorizedAgentScope
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const store = new PiSessionStore(sessionRoot, { sessionRoot, sessionNamespace: namespace })
    const legacy = await store.create({ workspaceId: 'workspace-a' }, { title: 'Legacy' })
    const transcriptPath = join(sessionRoot, namespace, `${legacy.id}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    expect(before).not.toContain('runtimeScopeIdentity')

    const runtimeIdentity = vi.fn((scope: AuthorizedAgentScope) => (
      scope.authSubjectId === firstReader.authSubjectId ? 'runtime-first' : 'runtime-later'
    ))
    const restarted = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity }))
    const resolution = vi.fn()
    ;(restarted.gateway as EmbeddedAgentGateway).setSessionRuntimeResolutionObserverForTesting(resolution)
    const ref = { agentTypeId: 'alpha', sessionId: legacy.id }

    await expect(restarted.gateway.readSessionState({ scope: firstReader, ref })).resolves.toMatchObject({ ref })
    await expect(restarted.gateway.readSessionState({ scope: firstReader, ref })).resolves.toMatchObject({ ref })
    expect(resolution).toHaveBeenCalledTimes(2)
    expect(resolution).toHaveBeenNthCalledWith(1, {
      source: 'pre-ah0-compatibility-fallback',
      runtimeScopeIdentity: 'runtime-first',
    })
    expect(resolution).toHaveBeenNthCalledWith(2, {
      source: 'pre-ah0-compatibility-fallback',
      runtimeScopeIdentity: 'runtime-first',
    })

    await expect(restarted.gateway.readSessionState({ scope: laterReader, ref }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(resolution).toHaveBeenCalledTimes(2)
    expect(runtimeIdentity).toHaveBeenCalledTimes(3)
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    await restarted.host.close()
  })

  it('uses a persisted post-AH0 runtime pin without the compatibility fallback when another runtime exists', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const pinnedReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'pinned-reader' } as AuthorizedAgentScope
    const currentReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'current-reader' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-pinned' }))
    const pinnedRef = await first.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'create-persisted-pin',
      title: 'Persisted pin',
    })
    await first.host.close()

    const runtimeIdentity = vi.fn((scope: AuthorizedAgentScope) => (
      scope.authSubjectId === currentReader.authSubjectId ? 'runtime-current' : 'runtime-pinned'
    ))
    const restarted = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity }))
    const resolution = vi.fn()
    ;(restarted.gateway as EmbeddedAgentGateway).setSessionRuntimeResolutionObserverForTesting(resolution)

    const currentRef = await restarted.gateway.createSession({
      scope: currentReader,
      agentTypeId: 'alpha',
      requestId: 'create-current-runtime',
      title: 'Current runtime',
    })
    expect(currentRef).not.toEqual(pinnedRef)
    await expect(restarted.gateway.readSessionState({ scope: pinnedReader, ref: pinnedRef }))
      .resolves.toMatchObject({ ref: pinnedRef })
    await expect(restarted.gateway.readSessionState({ scope: pinnedReader, ref: pinnedRef }))
      .resolves.toMatchObject({ ref: pinnedRef })

    expect(resolution).toHaveBeenCalledTimes(2)
    expect(resolution).toHaveBeenNthCalledWith(1, {
      source: 'persisted-runtime-pin',
      runtimeScopeIdentity: 'runtime-pinned',
    })
    expect(resolution).toHaveBeenNthCalledWith(2, {
      source: 'persisted-runtime-pin',
      runtimeScopeIdentity: 'runtime-pinned',
    })
    expect(resolution.mock.calls).not.toContainEqual([expect.objectContaining({
      source: 'pre-ah0-compatibility-fallback',
    })])
    expect(runtimeIdentity.mock.results.map(({ value }) => value)).toContain('runtime-current')
    await restarted.host.close()
  })

  it('keeps grant-only changes out of the Environment fingerprint', () => {
    const environment = {
      placementIdentity: 'direct:workspace',
      providerDigest: 'provider-a',
      provisioningArtifactDigests: ['python-a'],
      provisioningGeneration: 'generation-a',
    }
    expect(createEnvironmentProvisioningFingerprint(environment)).toBe(
      createEnvironmentProvisioningFingerprint({ ...environment }),
    )
    expect(createResolvedRuntimeScopeIdentity({ ...base, grants: ['data.write'] }))
      .not.toBe(createResolvedRuntimeScopeIdentity(base))
  })
})
