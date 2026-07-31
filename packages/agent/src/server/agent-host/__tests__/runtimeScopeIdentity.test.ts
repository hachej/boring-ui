import { appendFile, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  it('replaces only the header and preserves a malformed transcript tail byte-for-byte', async () => {
    const sessionRoot = await temporaryRoot()
    const store = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'header-cas',
      storageCwd: sessionRoot,
    })
    const oldIdentity = '4'.repeat(64)
    const nextIdentity = '5'.repeat(64)
    const created = await store.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: oldIdentity,
    } as Parameters<PiSessionStore['create']>[0])
    const transcriptPath = join(sessionRoot, 'header-cas', `${created.id}.jsonl`)
    const malformedTail = '{"type":"message","payload":"preserve spacing"}\r\n{malformed-tail\u0000bytes}\n'
    await appendFile(transcriptPath, malformedTail, 'utf8')
    await appendFile(transcriptPath, new Uint8Array([0xff, 0xfe, 0x00]))
    const before = await readFile(transcriptPath)
    const beforeTail = before.subarray(before.indexOf(0x0a))

    await expect(store.migrateRuntimeScopeIdentity(
      { workspaceId: 'workspace-a' },
      created.id,
      { expectedIdentity: oldIdentity, nextIdentity, evidenceDigest: '6'.repeat(64) },
    )).resolves.toBe('migrated')

    const after = await readFile(transcriptPath)
    expect(after.subarray(after.indexOf(0x0a)).equals(beforeTail)).toBe(true)
    const header = new TextDecoder().decode(after.subarray(0, after.indexOf(0x0a)))
    expect(JSON.parse(header).boringSessionCtx.runtimeScopeIdentity).toBe(nextIdentity)
  })

  it('fails closed on a malformed authoritative header', async () => {
    const sessionRoot = await temporaryRoot()
    const store = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'malformed-header-cas',
      storageCwd: sessionRoot,
    })
    const created = await store.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: 'a'.repeat(64),
    } as Parameters<PiSessionStore['create']>[0])
    const transcriptPath = join(sessionRoot, 'malformed-header-cas', `${created.id}.jsonl`)
    const malformed = '{malformed-header}\n{"tail":"unchanged"}\n'
    await writeFile(transcriptPath, malformed, 'utf8')
    await expect(store.migrateRuntimeScopeIdentity(
      { workspaceId: 'workspace-a' },
      created.id,
      { expectedIdentity: 'a'.repeat(64), nextIdentity: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64) },
    )).rejects.toThrow(/Session (?:metadata is malformed|not found)/)
    expect(await readFile(transcriptPath, 'utf8')).toBe(malformed)
  })

  it('fails closed after a bounded wait on a stale filesystem lock', async () => {
    const sessionRoot = await temporaryRoot()
    const store = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'stale-lock-cas',
      storageCwd: sessionRoot,
    })
    const oldIdentity = 'd'.repeat(64)
    const created = await store.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: oldIdentity,
    } as Parameters<PiSessionStore['create']>[0])
    const transcriptPath = join(sessionRoot, 'stale-lock-cas', `${created.id}.jsonl`)
    await writeFile(`${transcriptPath}.runtime-identity.lock`, 'stale', { flag: 'wx' })
    const before = await readFile(transcriptPath)
    await expect(store.migrateRuntimeScopeIdentity(
      { workspaceId: 'workspace-a' },
      created.id,
      { expectedIdentity: oldIdentity, nextIdentity: 'e'.repeat(64), evidenceDigest: 'f'.repeat(64) },
    )).rejects.toThrow(/migration is locked/)
    expect((await readFile(transcriptPath)).equals(before)).toBe(true)
  })

  it('serializes conflicting migrations across independent stores', async () => {
    const sessionRoot = await temporaryRoot()
    const options = { sessionRoot, sessionNamespace: 'cross-store-cas', storageCwd: sessionRoot }
    const firstStore = new PiSessionStore(sessionRoot, options)
    const secondStore = new PiSessionStore(sessionRoot, options)
    const oldIdentity = '7'.repeat(64)
    const created = await firstStore.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: oldIdentity,
    } as Parameters<PiSessionStore['create']>[0])
    const results = await Promise.all([
      firstStore.migrateRuntimeScopeIdentity(
        { workspaceId: 'workspace-a' },
        created.id,
        { expectedIdentity: oldIdentity, nextIdentity: '8'.repeat(64), evidenceDigest: 'a'.repeat(64) },
      ),
      secondStore.migrateRuntimeScopeIdentity(
        { workspaceId: 'workspace-a' },
        created.id,
        { expectedIdentity: oldIdentity, nextIdentity: '9'.repeat(64), evidenceDigest: 'b'.repeat(64) },
      ),
    ])
    expect(results.filter((result) => result === 'migrated')).toHaveLength(1)
    expect(results.filter((result) => result === 'mismatch')).toHaveLength(1)
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

  it('rejects an explicitly empty physical binding identity', async () => {
    const sessionRoot = await temporaryRoot()
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const host = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'semantic-runtime',
      bindingIdentity: '   ',
      createRuntime,
    }))
    await expect(host.gateway.createSession({
      scope: { workspaceScopeId: 'workspace-a', authSubjectId: 'subject' } as AuthorizedAgentScope,
      agentTypeId: 'alpha',
      requestId: 'empty-binding',
    })).rejects.toThrow(/binding identity must be non-empty/)
    expect(createRuntime).not.toHaveBeenCalled()
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

  it('accepts an exact authorized raw legacy scope key', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const rawLegacyIdentity = JSON.stringify(['direct', 'workspace-a', '/historical/checkout', null])
    const newIdentity = 'c'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => rawLegacyIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-raw-v1' })
    await first.host.close()
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => newIdentity,
      migration: {
        schemaVersion: 1,
        agentTypeId: 'alpha',
        workspaceScopeId: 'workspace-a',
        sessionNamespace: 'sessions',
        fromIdentity: rawLegacyIdentity,
        toIdentity: newIdentity,
        evidenceDigest: 'd'.repeat(64),
      },
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'migrate-raw-v1',
      title: 'Raw v1 migrated',
    })).resolves.toMatchObject({ title: 'Raw v1 migrated' })
    await restarted.host.close()
  })

  it('keeps the observed legacy pin fail-closed without exact authorization evidence', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const observedIdentity = '33293674ddb7f24bcc036f4b5bedbf2457ac3a639e2969353ccb0175d385d7fe'
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => observedIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-observed-pin' })
    await first.host.close()
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => 'e'.repeat(64),
      createRuntime,
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'observed-remains-locked',
      title: 'Must remain locked',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(createRuntime).not.toHaveBeenCalled()
    await restarted.host.close()
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

  it('leaves the old pin untouched when the authorized target binding cannot be prepared', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const oldIdentity = '0'.repeat(64)
    const newIdentity = '1'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-target-failure' })
    await first.host.close()
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = join(sessionRoot, namespace, `${ref.sessionId}.jsonl`)
    const before = await readFile(transcriptPath, 'utf8')
    const createRuntime = vi.fn(async () => { throw new Error('target binding failed') })
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
        evidenceDigest: '2'.repeat(64),
      },
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'target-binding-failure',
      title: 'Must not change',
    })).rejects.toThrow(/target binding failed/)
    expect(createRuntime).toHaveBeenCalledOnce()
    expect(await readFile(transcriptPath, 'utf8')).toBe(before)
    await restarted.host.close()

    const oldRuntime = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    await expect(oldRuntime.gateway.renameSession({
      scope,
      ref,
      requestId: 'old-runtime-still-usable',
      title: 'Old runtime still works',
    })).resolves.toMatchObject({ title: 'Old runtime still works' })
    await oldRuntime.host.close()
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
    const admit = vi.fn(async () => ({ type: 'accepted' as const, admissionReceipt: 'accepted' }))
    await chmod(sessionDir, 0o500)
    try {
      const restarted = await createAgentHost(hostOptions({
        sessionRoot,
        runtimeIdentity: () => newIdentity,
        createRuntime,
        effectAdmission: { admit },
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
      expect(createRuntime).toHaveBeenCalledOnce()
      expect(admit).not.toHaveBeenCalled()
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
