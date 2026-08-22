import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { SessionManager } from '@mariozechner/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { sessionFilePath } from '../../harness/pi-coding-agent/__tests__/fixtures/sessionFiles'
import type { RuntimeModeAdapter } from '../../runtime/mode'
import { createAgentHost } from '../createAgentHost'
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
  it('keeps a manual title authoritative across native auto-title, reconnect, restart, and scoped projections', async () => {
    const sessionRoot = await temporaryRoot()
    const userA = { workspaceScopeId: 'workspace-a', authSubjectId: 'user-a' } as AuthorizedAgentScope
    const userB = { workspaceScopeId: 'workspace-b', authSubjectId: 'user-b' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-shared' }))
    const refA = await first.gateway.createSession({ scope: userA, agentTypeId: 'alpha', requestId: 'create-a' })
    const refB = await first.gateway.createSession({ scope: userB, agentTypeId: 'alpha', requestId: 'create-b' })

    const pathFor = async (scope: AuthorizedAgentScope, sessionId: string) => {
      const namespace = sessionNamespaceForAgent(agent, scope.workspaceScopeId, 'sessions')!
      return { namespace, path: await sessionFilePath(join(sessionRoot, namespace), sessionId) }
    }
    const a = await pathFor(userA, refA.sessionId)
    const b = await pathFor(userB, refB.sessionId)
    const appendTurnAndAutoTitle = (path: string, namespace: string, prompt: string, title: string) => {
      const manager = SessionManager.open(path, join(sessionRoot, namespace), sessionRoot)
      manager.appendMessage({ role: 'user', content: prompt } as never)
      manager.appendMessage({ role: 'assistant', content: 'reply' } as never)
      manager.appendSessionInfo(title)
    }
    appendTurnAndAutoTitle(a.path, a.namespace, 'prompt a', 'Auto title A')
    appendTurnAndAutoTitle(b.path, b.namespace, 'prompt b', 'Legacy auto title B')

    await expect(first.gateway.listSessions({ scope: userA })).resolves.toMatchObject({ sessions: [
      expect.objectContaining({ ref: refA, title: 'Auto title A', nativeSessionId: refA.sessionId }),
    ] })
    await expect(first.gateway.renameSession({
      scope: userA, ref: refA, requestId: 'rename-a', title: 'Manual title A',
    })).resolves.toMatchObject({ ref: refA, title: 'Manual title A', nativeSessionId: refA.sessionId })

    // Reproduce the conflict: native Pi writes a newer session_info after the user rename.
    SessionManager.open(a.path, join(sessionRoot, a.namespace), sessionRoot)
      .appendSessionInfo('Auto overwrite attempt')
    await expect(first.gateway.listSessions({ scope: userA })).resolves.toMatchObject({ sessions: [
      expect.objectContaining({ ref: refA, title: 'Manual title A', nativeSessionId: refA.sessionId }),
    ] })
    await expect(first.gateway.readSessionState({ scope: userA, ref: refA })).resolves.toMatchObject({
      ref: refA, summary: { title: 'Manual title A', nativeSessionId: refA.sessionId },
    })
    const connection = await first.gateway.connectSession({ scope: userA, ref: refA })
    await connection.close()
    await expect(first.gateway.readSessionState({ scope: userA, ref: refA })).resolves.toMatchObject({
      summary: { title: 'Manual title A' },
    })
    await first.host.close()

    const restarted = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-shared' }))
    await expect(restarted.gateway.listSessions({ scope: userA })).resolves.toMatchObject({ sessions: [
      expect.objectContaining({ ref: refA, title: 'Manual title A', nativeSessionId: refA.sessionId }),
    ] })
    await expect(restarted.gateway.readSessionState({ scope: userA, ref: refA })).resolves.toMatchObject({
      summary: { title: 'Manual title A', nativeSessionId: refA.sessionId },
    })
    await expect(restarted.gateway.listSessions({ scope: userB })).resolves.toMatchObject({ sessions: [
      expect.objectContaining({ ref: refB, title: 'Legacy auto title B', nativeSessionId: refB.sessionId }),
    ] })
    await expect(restarted.gateway.readSessionState({ scope: userB, ref: refA }))
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND })
    await restarted.host.close()
  }, 30_000)

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

  it('continues one session after its live runtime identity changes', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'owner' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-old' }))
    const ref = await first.gateway.createSession({
      scope,
      agentTypeId: 'alpha',
      requestId: 'create-before-restart',
      title: 'Continuing session',
    })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
    expect(await readFile(transcriptPath, 'utf8')).not.toContain('runtimeScopeIdentity')
    await first.host.close()

    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'runtime-new',
      createRuntime,
    }))
    await expect(restarted.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({
      ref,
      summary: { title: 'Continuing session' },
    })
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'rename-after-restart',
      title: 'Still the same session',
    })).resolves.toMatchObject({ ref, title: 'Still the same session' })
    const connection = await restarted.gateway.connectSession({ scope, ref })
    await expect(connection.interrupt({ requestId: 'interrupt-after-restart' })).resolves.toMatchObject({ accepted: true })
    await expect(connection.stop({ requestId: 'stop-after-restart' })).resolves.toMatchObject({ accepted: true })
    await connection.close()
    await expect(restarted.gateway.readSessionState({
      scope: { workspaceScopeId: 'workspace-b', authSubjectId: 'owner' } as AuthorizedAgentScope,
      ref,
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND })
    expect(createRuntime).toHaveBeenCalledOnce()
    await restarted.host.close()
  }, 30_000)

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
