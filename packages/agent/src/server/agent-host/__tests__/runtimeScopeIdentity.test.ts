import { appendFile, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { sessionFilePath } from '../../harness/pi-coding-agent/__tests__/fixtures/sessionFiles'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import type { RuntimeModeAdapter } from '../../runtime/mode'
import { createAgentHost } from '../createAgentHost'
import { EmbeddedAgentGateway } from '../embeddedGateway'
import { sessionNamespaceForAgent } from '../sessionInventory'
import type { AgentEffectAdmission, AgentHostAgentSpec, CreateAgentHostOptions } from '../types'
import {
  createEnvironmentProvisioningFingerprint,
  createResolvedRuntimeScopeIdentity,
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
  runtimePhysicalIdentity?: (scope: AuthorizedAgentScope) => string
  provisioningFingerprint?: (scope: AuthorizedAgentScope) => string
  environmentPlacementIdentity?: (scope: AuthorizedAgentScope) => string
  createRuntime?: RuntimeModeAdapter['create']
  effectAdmission?: AgentEffectAdmission
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
    resolveAuthorizedEnvironmentScope: async ({ authorizedScope: scope }: { authorizedScope: AuthorizedAgentScope }) => ({
      placementIdentity: input.environmentPlacementIdentity?.(scope) ?? 'direct:workspace',
      workspaceRoot: input.sessionRoot,
      provisioningFingerprint: input.provisioningFingerprint?.(scope) ?? 'provider:generation-a',
    }),
    resolveAuthorizedAgentRuntimeScope: async ({ authorizedScope: scope }: { authorizedScope: AuthorizedAgentScope }) => ({
      identity: input.runtimeIdentity(scope),
      physicalBindingIdentity: input.runtimePhysicalIdentity?.(scope) ?? input.runtimeIdentity(scope),
      resourceInputDigest: input.runtimeIdentity(scope),
      sessionNamespace: 'sessions',
    }),
  }
}

const base: RuntimeScopeIdentityInput = {
  artifacts: [{ pluginId: 'macro', digest: 'artifact-a' }],
  validatedConfig: { currency: 'USD' },
  grants: ['data.read'],
  placementClassIdentity: 'direct',
  isolationMode: 'shared',
  toolContractDigests: ['tool-a'],
  provisioningIdentity: 'provider-contract-a',
}

describe('runtime scope identity', () => {
  it.each([
    ['artifact digest', { artifacts: [{ pluginId: 'macro', digest: 'artifact-b' }] }],
    ['validated config', { validatedConfig: { currency: 'EUR' } }],
    ['grant', { grants: ['data.read', 'data.write'] }],
    ['placement class', { placementClassIdentity: 'sandbox' }],
    ['isolation', { isolationMode: 'dedicated' }],
    ['tool contract', { toolContractDigests: ['tool-b'] }],
    ['provisioning contract', { provisioningIdentity: 'provider-contract-b' }],
  ] satisfies readonly [string, Partial<RuntimeScopeIdentityInput>][])('changes for %s', (_name, change) => {
    expect(createResolvedRuntimeScopeIdentity({ ...base, ...change }))
      .not.toBe(createResolvedRuntimeScopeIdentity(base))
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
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
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

  it('rejects a mismatched persisted pin even when its old binding is still published', async () => {
    const sessionRoot = await temporaryRoot()
    const oldIdentity = 'a'.repeat(64)
    const currentIdentity = 'b'.repeat(64)
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const currentActor = { workspaceScopeId: 'workspace-a', authSubjectId: 'current' } as AuthorizedAgentScope
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const admit = vi.fn(async () => ({ type: 'accepted' as const, admissionReceipt: 'accepted' }))
    const created = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: (scope) => scope.authSubjectId === 'creator' ? oldIdentity : currentIdentity,
      createRuntime,
      effectAdmission: { admit },
    }))
    const ref = await created.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'create-old-binding',
    })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
    const before = await readFile(transcriptPath)
    createRuntime.mockClear()
    admit.mockClear()

    await expect(created.gateway.renameSession({
      scope: currentActor,
      ref,
      requestId: 'published-old-binding-must-not-bypass-cut',
      title: 'Must not change',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect((await readFile(transcriptPath)).equals(before)).toBe(true)
    await created.host.close()
  })

  it('serves a mismatched transcript read-only while every write remains pin-rejected', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const other = { workspaceScopeId: 'workspace-a', authSubjectId: 'other' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-creator' }))
    const ref = await first.gateway.createSession({ scope: creator, agentTypeId: 'alpha', requestId: 'create' })
    await expect(first.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'cannot-fork-current',
      forkSessionId: ref.sessionId,
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    let transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
    await appendFile(transcriptPath, [
      { type: 'message', id: 'user-1', parentId: null, timestamp: '2026-08-17T00:00:00.000Z', message: { role: 'user', content: 'inspect frozen chat', timestamp: 1 } },
      { type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp: '2026-08-17T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } }], timestamp: 2 } },
      { type: 'message', id: 'tool-1', parentId: 'assistant-1', timestamp: '2026-08-17T00:00:02.000Z', message: { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'frozen result' }], timestamp: 3 } },
      { type: 'ui_snapshot', id: 'snapshot-1', timestamp: '2026-08-17T00:00:03.000Z', messages: [{ role: 'user', content: 'legacy duplicate' }] },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    await first.host.close()
    const legacyWrapperPath = join(sessionRoot, namespace, `${ref.sessionId}.jsonl`)
    await rename(transcriptPath, legacyWrapperPath)
    transcriptPath = legacyWrapperPath
    const before = await readFile(transcriptPath, 'utf8')

    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const admit = vi.fn(async () => ({ type: 'accepted' as const, admissionReceipt: 'accepted' }))
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: (scope) => scope.authSubjectId === 'creator' ? 'runtime-creator' : 'runtime-other',
      createRuntime,
      effectAdmission: { admit },
    }))
    const frozen = await restarted.gateway.readSessionState({ scope: other, ref })
    expect(frozen.state.messages).toEqual([
      expect.objectContaining({ role: 'user', parts: [expect.objectContaining({ text: 'inspect frozen chat' })] }),
      expect.objectContaining({
        role: 'assistant',
        parts: [expect.objectContaining({
          type: 'tool-call',
          id: 'call-1',
          toolName: 'read',
          state: 'output-available',
          output: [{ type: 'text', text: 'frozen result' }],
        })],
      }),
    ])
    await expect(restarted.gateway.renameSession({
      scope: other,
      ref,
      requestId: 'must-not-mutate',
      title: 'Must not change',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    await expect(restarted.gateway.connectSession({ scope: other, ref }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    await expect(restarted.gateway.readSessionState({
      scope: { workspaceScopeId: 'workspace-b', authSubjectId: 'other' } as AuthorizedAgentScope,
      ref,
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)

    ;(restarted.gateway as EmbeddedAgentGateway).setActivityForTesting('workspace-a', ref, 'running')
    await expect(restarted.gateway.createSession({
      scope: other,
      agentTypeId: 'alpha',
      requestId: 'cannot-fork-active',
      forkSessionId: ref.sessionId,
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE })
    ;(restarted.gateway as EmbeddedAgentGateway).setActivityForTesting('workspace-a', ref, 'idle')

    const forkInput = {
      scope: other,
      agentTypeId: 'alpha',
      requestId: 'fork-current-runtime',
      forkSessionId: ref.sessionId,
    }
    const fork = await restarted.gateway.createSession(forkInput)
    expect(await restarted.gateway.createSession(forkInput)).toEqual(fork)
    expect(fork).not.toEqual(ref)
    const continued = await restarted.gateway.readSessionState({ scope: other, ref: fork })
    expect(continued.state.messages).toEqual(frozen.state.messages)
    const forkPath = await sessionFilePath(join(sessionRoot, namespace), fork.sessionId)
    const forkHeader = JSON.parse((await readFile(forkPath, 'utf8')).split('\n')[0]!) as {
      id: string
      parentSession?: string
      boringSessionCtx?: { workspaceId?: string; runtimeScopeIdentity?: string }
    }
    expect(forkHeader).toMatchObject({
      id: fork.sessionId,
      parentSession: transcriptPath,
      boringSessionCtx: { workspaceId: 'workspace-a', runtimeScopeIdentity: 'runtime-other' },
    })
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    expect(createRuntime).toHaveBeenCalledOnce()
    expect(admit).toHaveBeenCalledTimes(2)
    await restarted.host.close()
  })

  it('uses the first Host-lifetime runtime for a pre-AH0 unpinned transcript', async () => {
    const sessionRoot = await temporaryRoot()
    const firstReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'legacy-reader-a' } as AuthorizedAgentScope
    const laterReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'legacy-reader-b' } as AuthorizedAgentScope
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const store = new PiSessionStore(sessionRoot, { sessionRoot, sessionNamespace: namespace })
    const legacy = await store.create({ workspaceId: 'workspace-a' }, { title: 'Legacy' })
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), legacy.id)
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
      source: 'unpinned-session-fallback',
      runtimeScopeIdentity: 'runtime-first',
    })
    expect(resolution).toHaveBeenNthCalledWith(2, {
      source: 'unpinned-session-fallback',
      runtimeScopeIdentity: 'runtime-first',
    })

    await expect(restarted.gateway.readSessionState({ scope: laterReader, ref }))
      .resolves.toMatchObject({ ref })
    expect(resolution).toHaveBeenCalledTimes(2)
    expect(runtimeIdentity).toHaveBeenCalled()
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    await restarted.host.close()
  })

  it('uses a persisted post-AH0 runtime pin without the unpinned fallback when another runtime exists', async () => {
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
      source: 'unpinned-session-fallback',
    })])
    expect(runtimeIdentity.mock.results.map(({ value }) => value)).toContain('runtime-current')
    await restarted.host.close()
  })

  it('does not publish a historical pinned binding as current when it is accessed first', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const pinnedReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'pinned-reader' } as AuthorizedAgentScope
    const currentReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'current-reader' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-pinned' }))
    const pinnedRef = await first.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'create-historical-pin',
      title: 'Historical pin',
    })
    await first.host.close()

    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: (scope) => (
        scope.authSubjectId === currentReader.authSubjectId ? 'runtime-current' : 'runtime-pinned'
      ),
    }))
    await expect(restarted.gateway.readSessionState({ scope: pinnedReader, ref: pinnedRef }))
      .resolves.toMatchObject({ ref: pinnedRef })

    const currentRef = await restarted.gateway.createSession({
      scope: currentReader,
      agentTypeId: 'alpha',
      requestId: 'create-after-historical-pin',
      title: 'Canonical current',
    })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), currentRef.sessionId)
    const header = JSON.parse((await readFile(transcriptPath, 'utf8')).split('\n')[0]!) as {
      boringSessionCtx?: { runtimeScopeIdentity?: string }
    }
    expect(header.boringSessionCtx?.runtimeScopeIdentity).toBe('runtime-current')
    await restarted.host.close()
  })

  it('does not promote a pinned binding with the same semantic identity but a different generation', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const pinnedReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'pinned-reader' } as AuthorizedAgentScope
    const currentReader = { workspaceScopeId: 'workspace-a', authSubjectId: 'current-reader' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'runtime-shared',
      runtimePhysicalIdentity: () => 'physical-pinned',
      provisioningFingerprint: () => 'fingerprint-pinned',
    }))
    const pinnedRef = await first.gateway.createSession({
      scope: creator,
      agentTypeId: 'alpha',
      requestId: 'create-same-identity-pin',
      title: 'Same identity pin',
    })
    await first.host.close()

    const baseMode = createTestRuntimeModeAdapter('direct')
    const createRuntime = vi.fn(baseMode.create.bind(baseMode))
    const isCurrent = (scope: AuthorizedAgentScope) => scope.authSubjectId === currentReader.authSubjectId
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'runtime-shared',
      runtimePhysicalIdentity: (scope) => isCurrent(scope) ? 'physical-current' : 'physical-pinned',
      provisioningFingerprint: (scope) => isCurrent(scope) ? 'fingerprint-current' : 'fingerprint-pinned',
      environmentPlacementIdentity: (scope) => isCurrent(scope) ? 'direct:current' : 'direct:pinned',
      createRuntime,
    }))
    await expect(restarted.gateway.readSessionState({ scope: pinnedReader, ref: pinnedRef }))
      .resolves.toMatchObject({ ref: pinnedRef })
    await expect(restarted.gateway.createSession({
      scope: currentReader,
      agentTypeId: 'alpha',
      requestId: 'create-same-identity-current',
      title: 'Same identity current',
    })).resolves.toMatchObject({ agentTypeId: 'alpha' })
    expect(createRuntime).toHaveBeenCalledTimes(2)
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
