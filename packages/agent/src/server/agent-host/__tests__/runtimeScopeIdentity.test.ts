import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { AgentGatewayErrorCode, type AuthorizedAgentScope } from '../../../shared/index'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
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
    resolveRuntimeScope: async ({ scope }: { scope: AuthorizedAgentScope }) => ({
      identity: input.runtimeIdentity(scope),
      environment: {
        placementIdentity: 'direct:workspace',
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

  it('opens a pre-AH0 unpinned transcript with the current runtime without rewriting history', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'legacy-reader' } as AuthorizedAgentScope
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const store = new PiSessionStore(sessionRoot, { sessionRoot, sessionNamespace: namespace })
    const legacy = await store.create({ workspaceId: 'workspace-a' }, { title: 'Legacy' })
    const transcriptPath = join(sessionRoot, namespace, `${legacy.id}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    expect(before).not.toContain('runtimeScopeIdentity')

    const restarted = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-current' }))
    const ref = { agentTypeId: 'alpha', sessionId: legacy.id }
    await expect(restarted.gateway.readSessionState({ scope, ref })).resolves.toMatchObject({ ref })
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
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
