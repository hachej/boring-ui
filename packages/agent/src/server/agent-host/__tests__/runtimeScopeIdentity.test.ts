import { appendFile, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
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
import type {
  AgentEffectAdmission,
  AgentHostAgentSpec,
  CreateAgentHostOptions,
  RuntimeScopeIdentityMigrationAuthorization,
} from '../types'
import {
  createEnvironmentProvisioningFingerprint,
  createLegacyRuntimeScopeIdentityV1,
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
  migration?: RuntimeScopeIdentityMigrationAuthorization
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
      ...(input.migration ? { sessionIdentityMigrations: [input.migration] } : {}),
      sessionNamespace: 'sessions',
    }),
  }
}

const base: RuntimeScopeIdentityInput = {
  artifacts: [{ pluginId: 'macro', digest: 'artifact-a' }],
  validatedConfig: { currency: 'USD' },
  grants: ['data.read'],
  placementClassIdentity: 'direct',
  placementIdentity: 'direct:workspace',
  isolationMode: 'shared',
  toolContractDigests: ['tool-a'],
  provisioningIdentity: 'provider-contract-a',
  provisioningGeneration: 'generation-a',
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

  it('keeps semantic identity stable when only physical placement and generation change', () => {
    expect(createResolvedRuntimeScopeIdentity({
      ...base,
      placementIdentity: '/checkout/one',
      provisioningGeneration: 'lease-one',
    })).toBe(createResolvedRuntimeScopeIdentity({
      ...base,
      placementIdentity: '/checkout/two',
      provisioningGeneration: 'lease-two',
    }))
    expect(createLegacyRuntimeScopeIdentityV1({
      ...base,
      placementIdentity: '/checkout/one',
      provisioningGeneration: 'lease-one',
    })).not.toBe(createLegacyRuntimeScopeIdentityV1({
      ...base,
      placementIdentity: '/checkout/two',
      provisioningGeneration: 'lease-two',
    }))
  })

  it('replaces only the header and preserves transcript tail bytes during a pin CAS', async () => {
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
    })
    const transcriptPath = await sessionFilePath(join(sessionRoot, 'header-cas'), created.id)
    await appendFile(transcriptPath, '{"type":"message","payload":"preserve spacing"}\r\n{malformed-tail\u0000bytes}\n', 'utf8')
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
    const header = JSON.parse(new TextDecoder().decode(after.subarray(0, after.indexOf(0x0a)))) as {
      boringSessionCtx: { runtimeScopeIdentity: string }
    }
    expect(header.boringSessionCtx.runtimeScopeIdentity).toBe(nextIdentity)
  })

  it('fails closed on malformed metadata and stale migration locks', async () => {
    const sessionRoot = await temporaryRoot()
    // Path-derived legacy store: the only store shape that can still resolve a
    // transcript whose header line no longer parses, reaching the migration body.
    const malformedStore = new PiSessionStore(sessionRoot, {
      sessionRoot,
      storageCwd: sessionRoot,
    })
    const malformedSession = await malformedStore.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: 'a'.repeat(64),
    })
    const malformedPath = await sessionFilePath(malformedStore.getSessionDir(), malformedSession.id)
    const malformed = '{malformed-header}\n{"tail":"unchanged"}\n'
    await writeFile(malformedPath, malformed, 'utf8')
    // An empty ctx reaches the migration body (tenancy cannot be read from a
    // malformed header), where the JSON parse failure itself must fail closed.
    await expect(malformedStore.migrateRuntimeScopeIdentity(
      {},
      malformedSession.id,
      { expectedIdentity: 'a'.repeat(64), nextIdentity: 'b'.repeat(64), evidenceDigest: 'c'.repeat(64) },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/Session metadata is malformed/),
      code: 'SESSION_TRANSCRIPT_UNREADABLE',
      // The original parse failure must survive as the cause, not be swallowed.
      cause: expect.objectContaining({ message: expect.stringMatching(/JSON/i) }),
    })
    expect(await readFile(malformedPath, 'utf8')).toBe(malformed)

    const lockedStore = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'locked-cas',
      storageCwd: sessionRoot,
    })
    const lockedSession = await lockedStore.create({
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: 'd'.repeat(64),
    })
    const lockedPath = await sessionFilePath(join(sessionRoot, 'locked-cas'), lockedSession.id)
    await writeFile(`${lockedPath}.runtime-identity.lock`, 'stale', { flag: 'wx' })
    const before = await readFile(lockedPath)
    await expect(lockedStore.migrateRuntimeScopeIdentity(
      { workspaceId: 'workspace-a' },
      lockedSession.id,
      { expectedIdentity: 'd'.repeat(64), nextIdentity: 'e'.repeat(64), evidenceDigest: 'f'.repeat(64) },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/migration is locked/),
      code: 'SESSION_LOCKED',
      statusCode: 409,
      retryable: true,
    })
    expect((await readFile(lockedPath)).equals(before)).toBe(true)
  })

  it('takes over a stale migration lock abandoned by a crashed holder', async () => {
    const sessionRoot = await temporaryRoot()
    const store = new PiSessionStore(sessionRoot, {
      sessionRoot,
      sessionNamespace: 'stale-lock-takeover',
      storageCwd: sessionRoot,
    })
    const oldIdentity = 'd'.repeat(64)
    const created = await store.create({ workspaceId: 'workspace-a', runtimeScopeIdentity: oldIdentity })
    const transcriptPath = await sessionFilePath(join(sessionRoot, 'stale-lock-takeover'), created.id)
    const lockPath = `${transcriptPath}.runtime-identity.lock`
    // A crashed holder leaves its lock file behind. Age it past the stale TTL.
    await writeFile(lockPath, 'crashed-holder', { flag: 'wx' })
    const staleTime = new Date(Date.now() - 5 * 60_000)
    await utimes(lockPath, staleTime, staleTime)

    await expect(store.migrateRuntimeScopeIdentity(
      { workspaceId: 'workspace-a' },
      created.id,
      { expectedIdentity: oldIdentity, nextIdentity: 'e'.repeat(64), evidenceDigest: 'f'.repeat(64) },
    )).resolves.toBe('migrated')
    const header = JSON.parse((await readFile(transcriptPath, 'utf8')).split('\n')[0]!) as {
      boringSessionCtx?: { runtimeScopeIdentity?: string }
    }
    expect(header.boringSessionCtx?.runtimeScopeIdentity).toBe('e'.repeat(64))
    // The takeover releases its own lock too.
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes conflicting migrations across independent stores', async () => {
    const sessionRoot = await temporaryRoot()
    const options = { sessionRoot, sessionNamespace: 'cross-store-cas', storageCwd: sessionRoot }
    const firstStore = new PiSessionStore(sessionRoot, options)
    const secondStore = new PiSessionStore(sessionRoot, options)
    const oldIdentity = '7'.repeat(64)
    const created = await firstStore.create({ workspaceId: 'workspace-a', runtimeScopeIdentity: oldIdentity })
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

  it('migrates one exact scoped pin after target preparation and remains writable after restart', async () => {
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
    const migratedPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
    const header = JSON.parse((await readFile(migratedPath, 'utf8')).split('\n')[0]!) as {
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

  it('fails closed without changing the pin when target preparation fails', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const oldIdentity = '1'.repeat(64)
    const newIdentity = '2'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => oldIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-prepare-failure' })
    await first.host.close()
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
    const before = await readFile(transcriptPath)

    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => newIdentity,
      migration: {
        schemaVersion: 1,
        agentTypeId: 'alpha',
        workspaceScopeId: 'workspace-a',
        sessionNamespace: 'sessions',
        fromIdentity: oldIdentity,
        toIdentity: newIdentity,
        evidenceDigest: '3'.repeat(64),
      },
      createRuntime: vi.fn(async () => { throw new Error('target unavailable') }),
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'prepare-must-fail',
      title: 'Must not change',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect((await readFile(transcriptPath)).equals(before)).toBe(true)
    await restarted.host.close()
  })

  it('never authorizes the historical guessed identity, even if supplied as migration input', async () => {
    const sessionRoot = await temporaryRoot()
    const scope = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const observedIdentity = '33293674ddb7f24bcc036f4b5bedbf2457ac3a639e2969353ccb0175d385d7fe'
    const newIdentity = 'e'.repeat(64)
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => observedIdentity }))
    const ref = await first.gateway.createSession({ scope, agentTypeId: 'alpha', requestId: 'create-observed-pin' })
    await first.host.close()
    const createRuntime = vi.fn(createTestRuntimeModeAdapter('direct').create)
    const restarted = await createAgentHost(hostOptions({
      sessionRoot,
      runtimeIdentity: () => newIdentity,
      migration: {
        schemaVersion: 1,
        agentTypeId: 'alpha',
        workspaceScopeId: 'workspace-a',
        sessionNamespace: 'sessions',
        fromIdentity: observedIdentity,
        toIdentity: newIdentity,
        evidenceDigest: 'f'.repeat(64),
      },
      createRuntime,
    }))
    await expect(restarted.gateway.renameSession({
      scope,
      ref,
      requestId: 'observed-pin-denied',
      title: 'Must stay closed',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
    expect(createRuntime).not.toHaveBeenCalled()
    await restarted.host.close()
  })

  it('fails a restarted mismatching actor closed before a second runtime binding or transcript effect', async () => {
    const sessionRoot = await temporaryRoot()
    const creator = { workspaceScopeId: 'workspace-a', authSubjectId: 'creator' } as AuthorizedAgentScope
    const other = { workspaceScopeId: 'workspace-a', authSubjectId: 'other' } as AuthorizedAgentScope
    const first = await createAgentHost(hostOptions({ sessionRoot, runtimeIdentity: () => 'runtime-creator' }))
    const ref = await first.gateway.createSession({ scope: creator, agentTypeId: 'alpha', requestId: 'create' })
    const namespace = sessionNamespaceForAgent(agent, 'workspace-a', 'sessions')!
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), ref.sessionId)
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
      .rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH })
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
