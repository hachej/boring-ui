import { access, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { AgentHostErrorCode } from '../agentHostPlan.js'
import { deriveAgentHostSecretRefsEnvelope, digestAgentHostDesired, createAgentHostDesiredSnapshot, type AgentHostDesiredSnapshotV1 } from '../agentHostRevisionCodec.js'
import { createAgentHostRuntimeInputsIdentity, type AgentHostRuntimeInputsAttestationV1 } from '../agentHostRuntimeInputs.js'
import {
  createAgentHostBindingSecretMaterializer,
  createAgentHostRuntimeInputsInspector,
  type AgentHostBindingSecretProvider,
  type AgentHostProvidedBindingInspectionV1,
  type AgentHostResolvedBindingSecretsV1,
} from '../agentHostSecretMaterializer.js'
import type { AgentHostStoredCandidateV1 } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const OWNER_UID = process.geteuid!()
const OWNER_GID = process.getegid!()
const APP_UID = OWNER_UID
const APP_GID = OWNER_GID
const TMPFS_PARENT = process.env.XDG_RUNTIME_DIR ?? `/run/user/${OWNER_UID}`

async function desired(secretRefs: readonly string[] = ['credential-ref', 'secondary-ref'], ids: readonly string[] = ['insurance'], hostId = 'host-1'): Promise<AgentHostDesiredSnapshotV1> {
  const bindings = []; const resolvedBindings = []
  for (const id of ids) {
    const snapshot = canonicalizeWorkspaceCompositionSnapshot({
      schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId: `workspace:${id}`,
      runtimeProfile: {
        ref: 'runsc-eu', id: 'runsc', version: '2026.07.12', contentDigest: sha('b'),
        isolationAttestationDigest: sha('c'), workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots',
      },
      hostAppImageDigest: sha('a'), serverPlugins: [], defaultPluginPackages: [], staticSystemPromptDigest: sha('e'),
      inventories: { capabilities: [], tools: [], skills: null, mcpServers: null }, provisioning: [], filesystemBindings: [],
      policies: { externalPlugins: false, pluginAuthoring: false },
    })
    const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
    const definition = { definitionId: `definition:${id}`, version: '1.0.0', digest: sha('f'), instructionsRef: 'instructions.md' }
    const deploymentInput = {
      deploymentId: `deployment:${id}`, version: '2026.07.12', agentId: 'default',
      definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
    }
    const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
    const resolvedDigest = await createResolvedAgentDigest({
      workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId,
      workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest,
    })
    bindings.push({
      bindingId: id, hostname: `${id}.example.test`, workspaceId: snapshot.workspaceId,
      defaultDeploymentId: deploymentInput.deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
      workspaceAllocationRef: `${id}-workspace-allocation`, sessionAllocationRef: `${id}-session-allocation`, ownerPrincipalRef: 'owner',
      landing: { title: id, summary: 'Compare policies.' }, environmentRef: 'production', secretRefs,
    })
    resolvedBindings.push({
      schemaVersion: 1 as const, bindingId: id, composition: { snapshot, digest: compositionDigest },
      workspace: { workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, compositionDigest },
      deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest },
      definition, resolvedDigest,
    })
  }
  return createAgentHostDesiredSnapshot({
    schemaVersion: 1, hostId, expectedHostRevision: null, hostAppImageDigest: sha('a'),
    runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots',
    sessionRootPolicyRef: 'session-roots', bindings,
  }, resolvedBindings)
}

function attestation(secretRefs: readonly string[], secretFingerprint = sha('4')): AgentHostRuntimeInputsAttestationV1 {
  return {
    environment: { versionFingerprint: sha('1') }, workspaceAllocation: { versionFingerprint: sha('2') },
    sessionAllocation: { versionFingerprint: sha('3') },
    secrets: secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: secretFingerprint })),
  }
}
async function fixture(secretRefs: readonly string[] = ['credential-ref', 'secondary-ref'], ids: readonly string[] = ['insurance'], hostId = 'host-1') {
  const snapshot = await desired(secretRefs, ids, hostId)
  const candidate: AgentHostStoredCandidateV1 = {
    revisionId: 'r0000000001', desired: snapshot, desiredStateDigest: await digestAgentHostDesired(snapshot),
    secretRefs: deriveAgentHostSecretRefsEnvelope(snapshot),
  }
  const expected = await Promise.all(snapshot.plan.bindings.map((binding) => createAgentHostRuntimeInputsIdentity(binding, attestation(secretRefs))))
  return { snapshot, candidate, expected }
}
function provided(secretRefs: readonly string[], bytes = (ref: string) => new TextEncoder().encode(`value:${ref}`), bindingId = 'insurance') {
  const values = secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: sha('4'), value: bytes(secretRef) })).reverse()
  const inspection: AgentHostProvidedBindingInspectionV1 = {
    bindingId, environmentVersionFingerprint: sha('1'), workspaceAllocationVersionFingerprint: sha('2'),
    sessionAllocationVersionFingerprint: sha('3'),
    secrets: values.map(({ secretRef, providerVersionFingerprint }) => ({ secretRef, providerVersionFingerprint })),
  }
  const resolved: AgentHostResolvedBindingSecretsV1 = { bindingId, secrets: values }
  return { inspection, resolved, values: values.map((entry) => entry.value) }
}
function provider(input: ReturnType<typeof provided>): AgentHostBindingSecretProvider {
  return { inspect: async () => input.inspection, resolveSecrets: async () => input.resolved }
}
async function tmpfsRoot() { return mkdtemp(path.join(TMPFS_PARENT, 'boring-agent-host-secrets-')) }
function materializer(root: string, provider: AgentHostBindingSecretProvider, fault?: (point: 'before-final-rename' | 'after-final-rename') => void | Promise<void>) {
  return createAgentHostBindingSecretMaterializer({ root, ownerUid: OWNER_UID, appUid: APP_UID, appGid: APP_GID, provider, fault })
}

describe('AgentHost binding secret materializer', () => {
  it('publishes a canonical redacted manifest and ordinal secret files with exact metadata', async () => {
    const root = await tmpfsRoot(); const f = await fixture(); const p = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const inspected = await materializer(root, provider(p))(f.candidate, f.expected)
    expect(inspected).toEqual([{ bindingId: 'insurance', attestation: attestation(['credential-ref', 'secondary-ref']) }])
    for (const value of p.values) expect([...value].every((byte) => byte === 0)).toBe(true)

    const revision = path.join(root, 'host-1', 'revisions', 'r0000000001')
    expect((await readdir(revision)).sort()).toEqual(['bindings', 'manifest.json'])
    const manifestText = await readFile(path.join(revision, 'manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestText)
    expect(manifest).toEqual({
      schemaVersion: 1, domain: 'boring-agent-host-binding-secrets:v1', hostId: 'host-1', revisionId: 'r0000000001',
      desiredStateDigest: f.candidate.desiredStateDigest, bindings: [{
        bindingId: 'insurance', runtimeInputsDigest: f.expected[0]!.digest, secrets: [
          { secretRef: 'credential-ref', providerVersionFingerprint: sha('4'), file: 'bindings/insurance/0000' },
          { secretRef: 'secondary-ref', providerVersionFingerprint: sha('4'), file: 'bindings/insurance/0001' },
        ],
      }],
    })
    expect(manifestText).not.toMatch(/value:credential|value:secondary|\/run\/|active|pending/)
    expect(await readFile(path.join(revision, 'bindings/insurance/0000'), 'utf8')).toBe('value:credential-ref')
    expect(await readFile(path.join(revision, 'bindings/insurance/0001'), 'utf8')).toBe('value:secondary-ref')
    for (const directory of [path.join(root, 'host-1'), path.join(root, 'host-1/revisions'), revision, path.join(revision, 'bindings'), path.join(revision, 'bindings/insurance')]) {
      expect(await stat(directory)).toMatchObject({ uid: OWNER_UID, gid: APP_GID, mode: expect.any(Number) })
      expect((await stat(directory)).mode & 0o7777).toBe(0o710)
    }
    expect(await stat(path.join(revision, 'manifest.json'))).toMatchObject({ uid: OWNER_UID, gid: APP_GID, nlink: 1 })
    expect((await stat(path.join(revision, 'manifest.json'))).mode & 0o7777).toBe(0o440)
    for (const name of ['0000', '0001']) {
      expect(await stat(path.join(revision, 'bindings/insurance', name))).toMatchObject({ uid: APP_UID, gid: APP_GID, nlink: 1 })
      expect((await stat(path.join(revision, 'bindings/insurance', name))).mode & 0o7777).toBe(0o400)
    }
    await expect(access(path.join(root, 'host-1', 'active'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('compares exact runtime identity before creating a stage and redacts failures', async () => {
    const root = await tmpfsRoot(); const f = await fixture(); const p = provided(f.snapshot.plan.bindings[0]!.secretRefs); let resolved = false
    const wrong = [await createAgentHostRuntimeInputsIdentity(f.snapshot.plan.bindings[0]!, attestation(['credential-ref', 'secondary-ref'], sha('5')))]
    const error = await materializer(root, {
      inspect: async () => p.inspection,
      resolveSecrets: async () => { resolved = true; return p.resolved },
    })(f.candidate, wrong).catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, details: { field: 'runtimeInputs' } })
    await expect(access(path.join(root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.stringify(error)).not.toMatch(/value:|credential-ref|\/run\//)
    expect(resolved).toBe(false)
    expect(p.values.some((value) => value.some((byte) => byte !== 0))).toBe(true)
  })

  it('inspects canonical metadata without resolving secret values', async () => {
    const f = await fixture(); const p = provided(f.snapshot.plan.bindings[0]!.secretRefs); let resolved = false
    const inspected = await createAgentHostRuntimeInputsInspector({
      inspect: async () => p.inspection,
      resolveSecrets: async () => { resolved = true; return p.resolved },
    })(f.snapshot)
    expect(inspected).toEqual([{ bindingId: 'insurance', attestation: attestation(['credential-ref', 'secondary-ref']) }])
    expect(resolved).toBe(false)
    expect(p.values.some((value) => value.some((byte) => byte !== 0))).toBe(true)
  })

  it('fails closed for provider omissions, extras, malformed values, and resource bounds', async () => {
    const valid = provided(['credential-ref'])
    const missing = provided([]); const extra = provided(['credential-ref', 'extra-ref'])
    const oversized = provided(['credential-ref'], () => new Uint8Array(64 * 1024 + 1))
    const empty = provided(['credential-ref'], () => new Uint8Array())
    const cases: Array<{ source: AgentHostBindingSecretProvider; code: string }> = [
      { source: provider(missing), code: AgentHostErrorCode.SECRET_UNAVAILABLE },
      { source: provider(extra), code: AgentHostErrorCode.COLLECTION_NOT_READY },
      {
        source: { ...provider(valid), inspect: async () => ({ ...valid.inspection, unexpected: true }) as AgentHostProvidedBindingInspectionV1 },
        code: AgentHostErrorCode.COLLECTION_NOT_READY,
      },
      { source: provider(oversized), code: AgentHostErrorCode.SECRET_UNAVAILABLE },
      { source: provider(empty), code: AgentHostErrorCode.SECRET_UNAVAILABLE },
      {
        source: { ...provider(valid), resolveSecrets: async () => ({ ...valid.resolved, secrets: [{ ...valid.resolved.secrets[0]!, providerVersionFingerprint: sha('5') }] }) },
        code: AgentHostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED,
      },
    ]
    for (const testCase of cases) {
      const root = await tmpfsRoot(); const f = await fixture(['credential-ref'])
      const error = await materializer(root, testCase.source)(f.candidate, f.expected).catch((caught) => caught)
      expect(error).toMatchObject({ code: testCase.code })
      await expect(access(path.join(root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.stringify(error)).not.toMatch(/credential-ref|extra-ref|\/run\//)
    }
  })

  it('rejects non-tmpfs, unsafe, and symlinked runtime roots before touching the provider', async () => {
    const regular = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-secrets-'))
    const unsafe = await tmpfsRoot(); await chmod(unsafe, 0o755)
    const real = await tmpfsRoot(); const linked = `${real}-link`; await symlink(real, linked)
    for (const root of [regular, unsafe, linked]) {
      const f = await fixture(); const p = provided(f.snapshot.plan.bindings[0]!.secretRefs); let calls = 0
      const source: AgentHostBindingSecretProvider = {
        inspect: async () => { calls += 1; return p.inspection },
        resolveSecrets: async () => { calls += 1; return p.resolved },
      }
      const error = await materializer(root, source)(f.candidate, f.expected).catch((caught) => caught)
      expect(error).toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY, details: { field: 'materialize' } })
      expect(calls).toBe(0)
      expect(p.values.some((value) => value.some((byte) => byte !== 0))).toBe(true)
    }
  })

  it('keeps writes anchored if the validated root path is replaced during provider inspection', async () => {
    const root = await tmpfsRoot(); const moved = `${root}-moved`; const replacement = await tmpfsRoot()
    const f = await fixture(); const p = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const source: AgentHostBindingSecretProvider = {
      inspect: async () => { await rename(root, moved); await symlink(replacement, root); return p.inspection },
      resolveSecrets: async () => p.resolved,
    }
    await expect(materializer(root, source)(f.candidate, f.expected)).resolves.toHaveLength(1)
    expect(await readdir(replacement)).toEqual([])
    expect(await readdir(path.join(moved, 'host-1/revisions'))).toEqual(['r0000000001'])
  })

  it('rejects aliased provider buffers before copying and zeroes the transfer', async () => {
    const root = await tmpfsRoot(); const f = await fixture(['credential-ref', 'secondary-ref'])
    const p = provided(f.snapshot.plan.bindings[0]!.secretRefs); const shared = new Uint8Array([1, 2, 3])
    const source: AgentHostBindingSecretProvider = {
      inspect: async () => p.inspection,
      resolveSecrets: async () => ({
        bindingId: 'insurance', secrets: p.resolved.secrets.map((secret) => ({ ...secret, value: shared })),
      }),
    }
    await expect(materializer(root, source)(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.SECRET_UNAVAILABLE })
    expect([...shared]).toEqual([0, 0, 0])
    await expect(access(path.join(root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects provider buffer reuse across bindings before staging', async () => {
    const root = await tmpfsRoot(); const f = await fixture(['credential-ref'], ['claims', 'insurance'])
    const shared = new Uint8Array([8]); const inputs = new Map(f.snapshot.plan.bindings.map((binding) => [
      binding.bindingId, provided(['credential-ref'], () => shared, binding.bindingId),
    ]))
    const source: AgentHostBindingSecretProvider = {
      inspect: async (binding) => inputs.get(binding.bindingId)!.inspection,
      resolveSecrets: async (binding) => inputs.get(binding.bindingId)!.resolved,
    }
    await expect(materializer(root, source)(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.SECRET_UNAVAILABLE })
    expect([...shared]).toEqual([0])
    await expect(access(path.join(root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('captures only data properties and zeroes through the Uint8Array builtin', async () => {
    class HostileBytes extends Uint8Array { override fill(_value: number, _start?: number, _end?: number): this { throw new Error('overridden') } }
    const root = await tmpfsRoot(); const f = await fixture(['credential-ref']); const p = provided(['credential-ref'], () => new HostileBytes([7]))
    await materializer(root, provider(p))(f.candidate, f.expected)
    expect([...p.values[0]!]).toEqual([0])

    const malformedRoot = await tmpfsRoot(); const malformedFixture = await fixture(['credential-ref', 'secondary-ref'])
    const first = new Uint8Array([9]); let getterReads = 0; const metadata = provided(['credential-ref', 'secondary-ref'])
    const accessor = {
      secretRef: 'secondary-ref', providerVersionFingerprint: sha('4'),
      get value() { getterReads += 1; throw new Error('getter') },
    }
    const source: AgentHostBindingSecretProvider = {
      inspect: async () => metadata.inspection,
      resolveSecrets: async () => ({
        bindingId: 'insurance',
        secrets: [{ secretRef: 'credential-ref', providerVersionFingerprint: sha('4'), value: first }, accessor],
      }) as unknown as AgentHostResolvedBindingSecretsV1,
    }
    await expect(materializer(malformedRoot, source)(malformedFixture.candidate, malformedFixture.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect(getterReads).toBe(0); expect([...first]).toEqual([0])

    const extraRoot = await tmpfsRoot(); const extraFixture = await fixture(['credential-ref']); const extra = new Uint8Array([6])
    const extraMetadata = provided(['credential-ref'])
    await expect(materializer(extraRoot, {
      inspect: async () => extraMetadata.inspection,
      resolveSecrets: async () => ({
        bindingId: 'insurance', secrets: [{ secretRef: 'credential-ref', providerVersionFingerprint: sha('4'), value: extra, unexpected: true }],
      }) as unknown as AgentHostResolvedBindingSecretsV1,
    })(extraFixture.candidate, extraFixture.expected)).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect([...extra]).toEqual([0])

    for (const mutate of [
      (resolved: AgentHostResolvedBindingSecretsV1) => ({ ...resolved, unexpected: true }),
      (resolved: AgentHostResolvedBindingSecretsV1) => ({ ...resolved, bindingId: '../invalid' }),
    ]) {
      const outerRoot = await tmpfsRoot(); const outer = provided(['credential-ref'], () => new Uint8Array([5]))
      await expect(materializer(outerRoot, {
        inspect: async () => outer.inspection,
        resolveSecrets: async () => mutate(outer.resolved) as AgentHostResolvedBindingSecretsV1,
      })(extraFixture.candidate, extraFixture.expected)).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
      expect([...outer.values[0]!]).toEqual([0])
    }
  })

  it('enforces collection file-count and aggregate-byte caps before staging', async () => {
    for (const { count, bytes, transferred } of [{ count: 1025, bytes: 1, transferred: false }, { count: 129, bytes: 64 * 1024, transferred: true }]) {
      const refs = Array.from({ length: count }, (_value, index) => `secret-${String(index).padStart(4, '0')}`)
      const root = await tmpfsRoot(); const f = await fixture(refs); const p = provided(refs, () => new Uint8Array(bytes).fill(7))
      await expect(materializer(root, provider(p))(f.candidate, f.expected))
        .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
      await expect(access(path.join(root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })
      for (const value of p.values) expect(value.every((byte) => byte === 0)).toBe(transferred)
    }
    const root = await tmpfsRoot(); const f = await fixture(['credential-ref']); const metadata = provided(['credential-ref'])
    const values = Array.from({ length: 1025 }, (_value, index) => new Uint8Array([index % 255 + 1]))
    await expect(materializer(root, {
      inspect: async () => metadata.inspection,
      resolveSecrets: async () => ({ bindingId: 'insurance', secrets: values.map((value) => ({ secretRef: 'credential-ref', providerVersionFingerprint: sha('4'), value })) }),
    })(f.candidate, f.expected)).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    for (const value of values) expect([...value]).toEqual([0])
  })

  it('materializes a maximum-length host id without exceeding stage NAME_MAX', async () => {
    const hostId = 'h'.repeat(250); const root = await tmpfsRoot(); const f = await fixture(['credential-ref'], ['insurance'], hostId)
    const p = provided(['credential-ref'])
    await materializer(root, provider(p))(f.candidate, f.expected)
    const manifest = JSON.parse(await readFile(path.join(root, hostId, 'revisions/r0000000001/manifest.json'), 'utf8'))
    expect(manifest.hostId).toBe(hostId)
  })

  it('leaves a hidden stage on pre-rename failure and adopts an exact post-rename retry', async () => {
    const beforeRoot = await tmpfsRoot(); const f = await fixture(); const before = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const beforeError = await materializer(beforeRoot, provider(before), (point) => {
      if (point === 'before-final-rename') throw new Error('/private/canary')
    })(f.candidate, f.expected).catch((caught) => caught)
    expect(beforeError).toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    const revisions = path.join(beforeRoot, 'host-1/revisions')
    expect(await readdir(revisions)).toEqual([])
    const stages = (await readdir(beforeRoot)).filter((entry) => entry.startsWith('.r0000000001.'))
    expect(stages).toHaveLength(1)
    expect(path.dirname(path.join(beforeRoot, stages[0]!))).toBe(beforeRoot)
    expect((await stat(beforeRoot)).mode & 0o7777).toBe(0o700)
    await expect(access(path.join(revisions, 'r0000000001'))).rejects.toMatchObject({ code: 'ENOENT' })

    const afterRoot = await tmpfsRoot(); const after = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const afterError = await materializer(afterRoot, provider(after), (point) => {
      if (point === 'after-final-rename') throw new Error('/private/canary')
    })(f.candidate, f.expected).catch((caught) => caught)
    expect(afterError).toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    const retry = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await expect(materializer(afterRoot, provider(retry))(f.candidate, f.expected)).resolves.toEqual([
      { bindingId: 'insurance', attestation: attestation(['credential-ref', 'secondary-ref']) },
    ])
    expect(JSON.stringify(afterError)).not.toMatch(/private|canary|\/run\//)
  })

  it('uses no-clobber publication and adopts only an exact collision', async () => {
    const exactRoot = await tmpfsRoot(); const f = await fixture(); const exact = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const exactTarget = path.join(exactRoot, 'host-1/revisions/r0000000001')
    await expect(materializer(exactRoot, provider(exact), async () => {
      const stage = (await readdir(exactRoot)).find((entry) => entry.startsWith('.r0000000001.'))!
      await cp(path.join(exactRoot, stage), exactTarget, { recursive: true })
    })(f.candidate, f.expected)).resolves.toHaveLength(1)
    expect((await readdir(exactRoot)).some((entry) => entry.startsWith('.r0000000001.'))).toBe(true)

    const emptyRoot = await tmpfsRoot(); const empty = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    const emptyTarget = path.join(emptyRoot, 'host-1/revisions/r0000000001')
    await expect(materializer(emptyRoot, provider(empty), async () => { await mkdir(emptyTarget, { mode: 0o710 }) })(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect(await readdir(emptyTarget)).toEqual([])
    expect((await readdir(emptyRoot)).some((entry) => entry.startsWith('.r0000000001.'))).toBe(true)
  })

  it('never overwrites or adopts a mismatched existing revision', async () => {
    const root = await tmpfsRoot(); const f = await fixture(); const first = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await materializer(root, provider(first))(f.candidate, f.expected)
    const secret = path.join(root, 'host-1/revisions/r0000000001/bindings/insurance/0000')
    await chmod(secret, 0o600); await writeFile(secret, 'tampered'); await chmod(secret, 0o400)
    const second = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await expect(materializer(root, provider(second))(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect(await readFile(secret, 'utf8')).toBe('tampered')
    for (const value of second.values) expect([...value].every((byte) => byte === 0)).toBe(true)
    expect((await lstat(path.join(root, 'host-1/revisions/r0000000001'))).isDirectory()).toBe(true)
  })

  it('rejects an existing revision whose root metadata is not exact', async () => {
    const root = await tmpfsRoot(); const f = await fixture(); const first = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await materializer(root, provider(first))(f.candidate, f.expected)
    const revision = path.join(root, 'host-1/revisions/r0000000001'); await chmod(revision, 0o755)
    const retry = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await expect(materializer(root, provider(retry))(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect((await stat(revision)).mode & 0o7777).toBe(0o755)

    const linkedRoot = await tmpfsRoot(); const linkedFirst = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await materializer(linkedRoot, provider(linkedFirst))(f.candidate, f.expected)
    const linkedRevision = path.join(linkedRoot, 'host-1/revisions/r0000000001'); const backing = `${linkedRevision}.backing`
    await rename(linkedRevision, backing); await symlink(backing, linkedRevision)
    const linkedRetry = provided(f.snapshot.plan.bindings[0]!.secretRefs)
    await expect(materializer(linkedRoot, provider(linkedRetry))(f.candidate, f.expected))
      .rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
    expect((await lstat(linkedRevision)).isSymbolicLink()).toBe(true)
  })
})
