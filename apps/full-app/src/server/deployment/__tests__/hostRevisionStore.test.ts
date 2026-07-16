import { access, appendFile, chmod, cp, link, mkdtemp, mkdir, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAgentAssetDigest, createAgentDefinitionDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { AgentHostErrorCode } from '../agentHostPlan.js'
import {
  canonicalizeAgentHostAuditRecord,
  canonicalizeAgentHostDesiredSnapshot,
  createAgentHostDesiredSnapshot,
  type AgentHostAuditRecordV1,
  type AgentHostDesiredSnapshotV1,
} from '../agentHostRevisionCodec.js'
import { AgentHostActivePublishError, createHostRevisionStore, type AgentHostRevisionStore } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'
import { createAgentHostRuntimeInputsIdentity } from '../agentHostRuntimeInputs.js'
import type { AgentHostLoadedAgentArtifact } from '../agentHostAgentArtifactSnapshot.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const OWNER_UID = process.geteuid!()
const OWNER_GID = process.getegid!()
const APP_GID = OWNER_GID || 10001

async function desired(id = 'insurance'): Promise<AgentHostDesiredSnapshotV1> {
  const refSuffix = id === 'insurance' ? '' : `-${id}`
  const snapshot = canonicalizeWorkspaceCompositionSnapshot({
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: `workspace:${id}`,
    runtimeProfile: {
      ref: 'runsc-eu', id: 'runsc', version: '2026.07.12', contentDigest: digest('b'),
      isolationAttestationDigest: digest('c'), workspaceRootPolicyRef: 'workspace-roots',
      sessionRootPolicyRef: 'session-roots',
    },
    hostAppImageDigest: digest('a'),
    serverPlugins: [{ id: 'plugin', version: '1.0.0', contentDigest: digest('d') }],
    defaultPluginPackages: [], staticSystemPromptDigest: digest('e'),
    inventories: { capabilities: [], tools: [], skills: null, mcpServers: null },
    provisioning: [], filesystemBindings: [], policies: { externalPlugins: false, pluginAuthoring: false },
  })
  const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
  const instructions = { path: 'instructions.md', content: `Compare ${id} policies.`, digest: await createAgentAssetDigest(`Compare ${id} policies.`) }
  const compiledDefinition = { schemaVersion: 1 as const, definitionId: `definition:${id}`, version: '1.0.0', instructionsRef: instructions.path }
  const definition = { definitionId: compiledDefinition.definitionId, version: compiledDefinition.version, instructionsRef: compiledDefinition.instructionsRef,
    digest: await createAgentDefinitionDigest({ definition: compiledDefinition, assets: [instructions] }) }
  const deploymentInput = {
    deploymentId: `deployment:${id}`, version: '2026.07.12', agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
  }
  const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId,
    workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest,
  })
  return createAgentHostDesiredSnapshot({
    schemaVersion: 1, hostId: 'host-1', expectedHostRevision: 'r0000000042', hostAppImageDigest: digest('a'),
    runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots',
    sessionRootPolicyRef: 'session-roots', bindings: [{
      bindingId: id, hostname: `${id}.example.test`, workspaceId: snapshot.workspaceId,
      defaultDeploymentId: deploymentInput.deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
      workspaceAllocationRef: `workspace-allocation${refSuffix}`, sessionAllocationRef: `session-allocation${refSuffix}`,
      ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Compare policies.' },
      environmentRef: 'production', secretRefs: ['credential-ref'],
    }],
  }, [{
    schemaVersion: 1, bindingId: id, composition: { snapshot, digest: compositionDigest },
    workspace: { workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, compositionDigest },
    deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest },
    definition, resolvedDigest,
  }])
}

async function artifact(value: AgentHostDesiredSnapshotV1, index = 0): Promise<AgentHostLoadedAgentArtifact> {
  const binding = value.plan.bindings[index]!; const expected = value.resolvedBindings[index]!
  const content = `Compare ${binding.bindingId} policies.`
  const asset = { path: expected.definition.instructionsRef, content, digest: await createAgentAssetDigest(content) }
  const definition = { schemaVersion: 1 as const, definitionId: expected.definition.definitionId, version: expected.definition.version, instructionsRef: asset.path }
  const bundle = { definition, definitionDigest: await createAgentDefinitionDigest({ definition, assets: [asset] }), assets: [asset] }
  const deployment = { deploymentId: expected.deployment.deploymentId, version: expected.deployment.version, agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: bundle.definitionDigest } }
  return { envelope: { schemaVersion: 1, domain: 'boring-agent-host-agent-artifact:v1', hostId: value.plan.hostId,
    bindingId: binding.bindingId, bundleRef: binding.bundleRef, deploymentRef: binding.deploymentRef,
    workspaceAllocationRef: binding.workspaceAllocationRef, workspaceCompositionDigest: expected.composition.digest, bundle, deployment } }
}

async function harness(fault?: () => void) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-store-'))
  const root = path.join(parent, 'state')
  const base = createHostRevisionStore({ root, ownerUid: OWNER_UID, appGid: APP_GID, fault })
  const store = { ...base, async writeCandidate(host: string, revision: string, value: AgentHostDesiredSnapshotV1,
    artifacts?: readonly AgentHostLoadedAgentArtifact[]) { return base.writeCandidate(host, revision, value,
      artifacts ?? await Promise.all(value.plan.bindings.map((_binding, index) => artifact(value, index)))) } }
  return { parent, root, store }
}
async function observation(value: AgentHostDesiredSnapshotV1, ready = true) {
  return {
    schemaVersion: 1 as const, domain: 'boring-agent-host-observed:v1' as const,
    bindings: await Promise.all(value.resolvedBindings.map(async (binding) => {
      const planned = value.plan.bindings.find((entry) => entry.bindingId === binding.bindingId)!
      return {
        bindingId: binding.bindingId, ready, resolvedDigest: binding.resolvedDigest,
        runtimeInputs: await createAgentHostRuntimeInputsIdentity(planned, {
          environment: { versionFingerprint: digest('6') }, workspaceAllocation: { versionFingerprint: digest('7') },
          sessionAllocation: { versionFingerprint: digest('8') },
          secrets: planned.secretRefs.map((secretRef) => ({ secretRef, providerVersionFingerprint: digest('9') })),
        }),
      }
    })),
  }
}
async function complete(store: AgentHostRevisionStore) {
  const value = await desired()
  const revisionId = await store.reserveRevisionId('host-1')
  await store.writeCandidate('host-1', revisionId, value, [await artifact(value)])
  await store.writeObservation('host-1', revisionId, await observation(value))
  const completed = await store.writeComplete('host-1', revisionId)
  return { value, revisionId, completed }
}
function audit(completed: Awaited<ReturnType<typeof complete>>['completed'], outcome: 'COMPLETE' | 'FAILED' = 'COMPLETE'): AgentHostAuditRecordV1 {
  return canonicalizeAgentHostAuditRecord({
    schemaVersion: 1, domain: 'boring-agent-host-audit:v1', revisionId: completed.revisionId,
    desiredStateDigest: completed.desiredStateDigest, outcome, phase: outcome === 'COMPLETE' ? 'AUDIT' : 'READINESS',
    ...(outcome === 'COMPLETE' ? { completionDigest: completed.completion.completionDigest } : {}),
    at: '2026-07-12T00:00:00.000Z', operator: { uid: 1000, effectiveUser: 'Julien', invocationId: 'deploy:1' },
  })
}

describe('AgentHost host revision store', () => {
  it('snapshots validated agent artifacts inside the atomic revision', async () => {
    const h = await harness(); const value = await desired(); const revisionId = await h.store.reserveRevisionId('host-1')
    const loaded = await artifact(value)
    await h.store.writeCandidate('host-1', revisionId, value, [loaded])
    expect(await h.store.readAgentArtifact('host-1', revisionId, 'insurance')).toEqual(loaded.envelope)
    const file = path.join(h.root, 'host-1', 'revisions', revisionId, 'agent-artifacts', 'insurance.json')
    expect(await stat(file)).toMatchObject({ uid: OWNER_UID, gid: APP_GID, nlink: 1 })
    expect((await stat(file)).mode & 0o777).toBe(0o440)

    const otherValue = await desired('travel'); const other = await artifact(otherValue)
    const otherRevision = await h.store.reserveRevisionId('host-1')
    await h.store.writeCandidate('host-1', otherRevision, otherValue, [other])
    expect(await h.store.readAgentArtifact('host-1', revisionId, 'insurance')).toEqual(loaded.envelope)
    expect(await h.store.readAgentArtifact('host-1', otherRevision, 'travel')).toEqual(other.envelope)

    const mismatch = { ...loaded, envelope: { ...loaded.envelope, bundleRef: 'other' } }
    const next = await h.store.reserveRevisionId('host-1')
    await expect(h.store.writeCandidate('host-1', next, value, [mismatch])).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    await expect(access(path.join(h.root, 'host-1', 'revisions', next))).rejects.toThrow()
  })

  it('round-trips canonical split envelopes without CAS, paths, prompts, or secret values', async () => {
    const h = await harness()
    const value = await desired()
    expect(await h.store.readCandidate('host-1', 'r0000000001')).toBeNull()
    expect(await h.store.readComplete('host-1', 'r0000000001')).toBeNull()
    const revisionId = await h.store.reserveRevisionId('host-1')
    const stored = await h.store.writeCandidate('host-1', revisionId, value)
    expect(await h.store.readCandidate('host-1', revisionId)).toEqual(stored)
    expect(await h.store.readComplete('host-1', revisionId)).toBeNull()
    const directory = path.join(h.root, 'host-1', 'revisions', revisionId)
    const files = await Promise.all(['desired.json', 'resolved.json', 'secret-refs.json', 'desired.sha256']
      .map((file) => readFile(path.join(directory, file), 'utf8')))
    expect(files.join('')).not.toMatch(/expectedHostRevision|\/srv\/|secret-value|raw-system-prompt|"instructions":/)
    expect(JSON.parse(files[0])).toMatchObject({ schemaVersion: 1, domain: 'boring-agent-host-plan:v1' })
    expect(JSON.parse(files[1])).toMatchObject({ schemaVersion: 1, domain: 'boring-agent-host-resolved:v1' })
    expect(JSON.parse(files[2])).toMatchObject({ bindings: [{ secretRefs: ['credential-ref'] }] })
    const bindingsDirectory = path.join(directory, 'bindings')
    const bindingFile = path.join(bindingsDirectory, 'insurance.env')
    expect(await readFile(bindingFile, 'utf8')).toBe([
      'BORING_AGENT_HOST_BINDING_ENV_SCHEMA=1', 'BORING_AGENT_HOST_BINDING_ID=insurance',
      'BORING_AGENT_HOST_ENVIRONMENT_REF=production', 'BORING_AGENT_HOST_WORKSPACE_ALLOCATION_REF=workspace-allocation',
      'BORING_AGENT_HOST_SESSION_ALLOCATION_REF=session-allocation',
    ].join('\n') + '\n')
    expect(await readFile(bindingFile, 'utf8')).not.toMatch(/credential-ref|secret-value|\/srv\/|prompt/)
    expect(await stat(h.root)).toMatchObject({ uid: OWNER_UID, gid: OWNER_GID })
    expect((await stat(h.root)).mode & 0o777).toBe(0o700)
    for (const managed of [path.join(h.root, 'host-1'), path.join(h.root, 'host-1', 'revisions'), directory, bindingsDirectory]) {
      expect(await stat(managed)).toMatchObject({ uid: OWNER_UID, gid: APP_GID })
      expect((await stat(managed)).mode & 0o777).toBe(0o710)
    }
    for (const artifact of ['desired.json', 'resolved.json', 'secret-refs.json', 'desired.sha256', 'bindings/insurance.env']) {
      expect(await stat(path.join(directory, artifact))).toMatchObject({ uid: OWNER_UID, gid: APP_GID, nlink: 1 })
      expect((await stat(path.join(directory, artifact))).mode & 0o777).toBe(0o440)
    }
    const sequence = await stat(path.join(h.root, 'host-1', 'sequence'))
    expect(sequence).toMatchObject({ uid: OWNER_UID, gid: OWNER_GID, nlink: 1 })
    expect(sequence.mode & 0o777).toBe(0o400)
  })

  it('writes the exact lexical filename set from out-of-order bindings', async () => {
    const insurance = await desired('insurance'); const claims = await desired('claims')
    const shuffled = await canonicalizeAgentHostDesiredSnapshot({
      schemaVersion: 1, domain: 'boring-agent-host-desired:v1',
      plan: { ...insurance.plan, bindings: [insurance.plan.bindings[0], claims.plan.bindings[0]] },
      resolvedBindings: [insurance.resolvedBindings[0], claims.resolvedBindings[0]],
    })
    const h = await harness(); const revisionId = await h.store.reserveRevisionId('host-1')
    await h.store.writeCandidate('host-1', revisionId, shuffled)
    const files = (await readdir(path.join(h.root, 'host-1', 'revisions', revisionId, 'bindings'))).sort()
    expect(files).toEqual(['claims.env', 'insurance.env'])
    expect((await h.store.readCandidate('host-1', revisionId))?.desired.plan.bindings.map((entry) => entry.bindingId))
      .toEqual(['claims', 'insurance'])
  })

  it('rejects missing, extra, linked, non-private, and noncanonical binding artifacts', async () => {
    async function written() {
      const h = await harness(); const value = await desired(); const revisionId = await h.store.reserveRevisionId('host-1')
      await h.store.writeCandidate('host-1', revisionId, value)
      const directory = path.join(h.root, 'host-1', 'revisions', revisionId, 'bindings')
      return { h, revisionId, directory, file: path.join(directory, 'insurance.env') }
    }
    for (const mutate of [
      async ({ file }: Awaited<ReturnType<typeof written>>) => { await rename(file, `${file}.missing`) },
      async ({ directory }: Awaited<ReturnType<typeof written>>) => { await writeFile(path.join(directory, 'extra.env'), 'EXTRA=1\n', { mode: 0o440 }) },
      async ({ h, file }: Awaited<ReturnType<typeof written>>) => { const backing = path.join(h.root, 'binding.backing'); await rename(file, backing); await symlink(backing, file) },
      async ({ h, file }: Awaited<ReturnType<typeof written>>) => { await link(file, path.join(h.root, 'binding.hardlink')) },
      async ({ file }: Awaited<ReturnType<typeof written>>) => { await chmod(file, 0o600) },
      async ({ file }: Awaited<ReturnType<typeof written>>) => { await chmod(file, 0o2440) },
      async ({ directory }: Awaited<ReturnType<typeof written>>) => { await chmod(directory, 0o755) },
      async ({ file }: Awaited<ReturnType<typeof written>>) => { const content = await readFile(file, 'utf8'); await chmod(file, 0o600); await writeFile(file, `# noncanonical\n${content}`); await chmod(file, 0o440) },
    ]) {
      const target = await written(); await mutate(target)
      const error = await target.h.store.readCandidate('host-1', target.revisionId).catch((caught) => caught)
      expect(error).toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID, details: { field: 'targetRevision' } })
      expect(JSON.stringify(error)).not.toMatch(/binding\.backing|noncanonical|EXTRA/)
    }
  })

  it('enforces durable monotonic reservation, permits gaps, and rejects bypass and corruption', async () => {
    const h = await harness()
    const value = await desired()
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000001')
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000002')
    await expect(h.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(h.store.writeCandidate('host-1', 'r0000000003', value)).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await h.store.writeCandidate('host-1', 'r0000000002', value)
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000003')
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000004')
    const sequence = path.join(h.root, 'host-1', 'sequence')
    await chmod(sequence, 0o600); await writeFile(sequence, 'corrupt\n')
    await expect(h.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT, details: { field: 'sequence' } })

    const exhausted = await harness(); await exhausted.store.reserveRevisionId('host-1')
    const exhaustedSequence = path.join(exhausted.root, 'host-1', 'sequence')
    await chmod(exhaustedSequence, 0o600); await writeFile(exhaustedSequence, '9999999999\n'); await chmod(exhaustedSequence, 0o400)
    await expect(exhausted.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    expect(await readFile(exhaustedSequence, 'utf8')).toBe('9999999999\n')
  })

  it('rejects root, parent, host, revision, artifact, and active symlinks', async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-target-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-parent-'))
    const rootLink = path.join(parent, 'root-link'); await symlink(target, rootLink)
    await expect(createHostRevisionStore({ root: rootLink, ownerUid: OWNER_UID, appGid: APP_GID }).reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    const parentLink = path.join(parent, 'parent-link'); await symlink(target, parentLink)
    await expect(createHostRevisionStore({ root: path.join(parentLink, 'root'), ownerUid: OWNER_UID, appGid: APP_GID }).reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(access(path.join(target, 'root'))).rejects.toMatchObject({ code: 'ENOENT' })
    const ancestorTarget = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-ancestor-target-'))
    const ancestorParent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-ancestor-parent-'))
    await mkdir(path.join(ancestorTarget, 'nested'), { mode: 0o700 })
    await symlink(ancestorTarget, path.join(ancestorParent, 'alias'))
    await expect(createHostRevisionStore({ root: path.join(ancestorParent, 'alias', 'nested', 'root'), ownerUid: OWNER_UID, appGid: APP_GID }).reserveRevisionId('host-1'))
      .rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(access(path.join(ancestorTarget, 'nested', 'root'))).rejects.toMatchObject({ code: 'ENOENT' })

    const host = await harness(); await mkdir(host.root, { mode: 0o700 }); await symlink(target, path.join(host.root, 'host-1'))
    await expect(host.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(host.store.readActive('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    const revisionsLink = await harness(); await mkdir(revisionsLink.root, { mode: 0o700 }); await mkdir(path.join(revisionsLink.root, 'host-1'), { mode: 0o710 })
    await symlink(target, path.join(revisionsLink.root, 'host-1', 'revisions'))
    await expect(revisionsLink.store.readCandidate('host-1', 'r0000000001')).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    const revision = await harness(); const value = await desired(); await revision.store.reserveRevisionId('host-1')
    await symlink(target, path.join(revision.root, 'host-1', 'revisions', 'r0000000001'))
    await expect(revision.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })

    const active = await harness(); const done = await complete(active.store)
    const desiredFile = path.join(active.root, 'host-1', 'revisions', done.revisionId, 'desired.json')
    await rename(desiredFile, `${desiredFile}.moved`); await symlink(`${desiredFile}.moved`, desiredFile)
    await expect(active.store.readCandidate('host-1', done.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    const activeLink = await harness(); const linked = await complete(activeLink.store)
    await symlink(path.join(activeLink.root, 'host-1', 'revisions', linked.revisionId, 'completion.json'), path.join(activeLink.root, 'host-1', 'active'))
    await expect(activeLink.store.readActive('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('rejects regular preexisting revision targets and append-once artifacts', async () => {
    const value = await desired()
    const directoryTarget = await harness(); await directoryTarget.store.reserveRevisionId('host-1')
    await mkdir(path.join(directoryTarget.root, 'host-1', 'revisions', 'r0000000001'), { mode: 0o700 })
    await expect(directoryTarget.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    const fileTarget = await harness(); await fileTarget.store.reserveRevisionId('host-1')
    await writeFile(path.join(fileTarget.root, 'host-1', 'revisions', 'r0000000001'), 'occupied')
    await expect(fileTarget.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    const artifact = await harness(); const revisionId = await artifact.store.reserveRevisionId('host-1')
    await artifact.store.writeCandidate('host-1', revisionId, value)
    await writeFile(path.join(artifact.root, 'host-1', 'revisions', revisionId, 'observed.json'), 'occupied')
    await expect(artifact.store.writeObservation('host-1', revisionId, await observation(value))).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
  })

  it('rejects a valid revision tree copied under a different host identity', async () => {
    const h = await harness(); const done = await complete(h.store)
    const host2 = path.join(h.root, 'host-2'); await mkdir(host2, { mode: 0o710 }); await mkdir(path.join(host2, 'revisions'), { mode: 0o710 })
    await cp(path.join(h.root, 'host-1', 'revisions', done.revisionId), path.join(host2, 'revisions', done.revisionId), { recursive: true })
    await expect(h.store.readCandidate('host-2', done.revisionId)).rejects.toMatchObject({
      code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID, details: { field: 'targetRevision' },
    })
  })

  it('rejects cross-binding observations and incomplete readiness', async () => {
    const h = await harness(); const value = await desired(); const revisionId = await h.store.reserveRevisionId('host-1')
    await h.store.writeCandidate('host-1', revisionId, value)
    const observed = await observation(value)
    await expect(h.store.writeObservation('host-1', revisionId, {
      ...observed, bindings: [{ ...observed.bindings[0], bindingId: 'other' }],
    })).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID })
    await h.store.writeObservation('host-1', revisionId, await observation(value, false))
    await expect(h.store.writeComplete('host-1', revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.COLLECTION_NOT_READY })
  })

  it('recomputes COMPLETE and rejects tampered or missing immutable artifacts', async () => {
    const h = await harness(); const done = await complete(h.store)
    expect(await h.store.readComplete('host-1', done.revisionId)).toEqual(done.completed)
    const observedFile = path.join(h.root, 'host-1', 'revisions', done.revisionId, 'observed.json')
    expect(await readFile(observedFile, 'utf8')).not.toMatch(/secret-value|\/srv\/private|raw-version|runtimeHandle/)
    for (const artifact of ['observed.json', 'completion.json']) {
      const info = await stat(path.join(h.root, 'host-1', 'revisions', done.revisionId, artifact))
      expect(info).toMatchObject({ uid: OWNER_UID, gid: APP_GID, nlink: 1 })
      expect(info.mode & 0o777).toBe(0o440)
    }
    type MutableObservation = { bindings: Array<{ runtimeInputs: { environment: { versionFingerprint: string }; secrets: Array<{ providerVersionFingerprint: string }> } }> }
    for (const mutate of [
      (raw: MutableObservation) => { raw.bindings[0].runtimeInputs.environment.versionFingerprint = digest('0') },
      (raw: MutableObservation) => { raw.bindings[0].runtimeInputs.secrets[0].providerVersionFingerprint = digest('0') },
    ]) {
      const tampered = await harness(); const tamperedDone = await complete(tampered.store)
      const file = path.join(tampered.root, 'host-1', 'revisions', tamperedDone.revisionId, 'observed.json')
      const raw = JSON.parse(await readFile(file, 'utf8')) as MutableObservation; mutate(raw)
      await chmod(file, 0o600); await writeFile(file, JSON.stringify(raw)); await chmod(file, 0o440)
      await expect(tampered.store.readComplete('host-1', tamperedDone.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    }
    const digestFile = path.join(h.root, 'host-1', 'revisions', done.revisionId, 'desired.sha256')
    await chmod(digestFile, 0o600); await writeFile(digestFile, `${digest('0')}\n`); await chmod(digestFile, 0o440)
    await expect(h.store.readComplete('host-1', done.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    const missing = await harness(); const missingDone = await complete(missing.store)
    const resolved = path.join(missing.root, 'host-1', 'revisions', missingDone.revisionId, 'resolved.json')
    await rename(resolved, `${resolved}.moved`)
    await expect(missing.store.readComplete('host-1', missingDone.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
  })

  it('reports the exact active commit boundary and never rewinds after rename', async () => {
    const before = await harness(); const value = await desired(); const revisionId = await before.store.reserveRevisionId('host-1')
    await before.store.writeCandidate('host-1', revisionId, value)
    await expect(before.store.publishActive('host-1', revisionId)).rejects.toMatchObject({ committed: false })
    expect(await before.store.readActive('host-1')).toBeNull()

    const mismatch = await harness(); const mismatchDone = await complete(mismatch.store)
    const completionFile = path.join(mismatch.root, 'host-1', 'revisions', mismatchDone.revisionId, 'completion.json')
    const completionJson = JSON.parse(await readFile(completionFile, 'utf8'))
    await chmod(completionFile, 0o600); await writeFile(completionFile, JSON.stringify({ ...completionJson, desiredStateDigest: digest('0') })); await chmod(completionFile, 0o440)
    await expect(mismatch.store.publishActive('host-1', mismatchDone.revisionId)).rejects.toMatchObject({ committed: false })
    expect(await mismatch.store.readActive('host-1')).toBeNull()

    const after = await harness(() => { throw new Error('/private/root secret-value') }); const done = await complete(after.store)
    const error = await after.store.publishActive('host-1', done.revisionId).catch((caught) => caught)
    expect(error).toBeInstanceOf(AgentHostActivePublishError)
    expect(error).toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED, committed: true, details: { field: 'active' } })
    expect(JSON.stringify(error)).not.toMatch(/private|secret-value/)
    expect(await after.store.readActive('host-1')).toEqual({ schemaVersion: 1, revisionId: done.revisionId, desiredStateDigest: done.completed.desiredStateDigest })
    const activeInfo = await stat(path.join(after.root, 'host-1', 'active'))
    expect(activeInfo).toMatchObject({ uid: OWNER_UID, gid: APP_GID, nlink: 1 })
    expect(activeInfo.mode & 0o777).toBe(0o440)
    expect(Object.keys(JSON.parse(await readFile(path.join(after.root, 'host-1', 'active'), 'utf8'))).sort())
      .toEqual(['desiredStateDigest', 'revisionId', 'schemaVersion'])
  })

  it('publishes only forward revisions and treats the current revision as a strict no-op', async () => {
    let publicationRenames = 0
    const h = await harness(() => { publicationRenames += 1 })
    const first = await complete(h.store); const firstActive = await h.store.publishActive('host-1', first.revisionId)
    expect(publicationRenames).toBe(1)
    expect(await h.store.publishActive('host-1', first.revisionId)).toEqual(firstActive)
    expect(publicationRenames).toBe(1)
    const second = await complete(h.store); const secondActive = await h.store.publishActive('host-1', second.revisionId)
    expect(publicationRenames).toBe(2)
    await expect(h.store.publishActive('host-1', first.revisionId)).rejects.toMatchObject({ committed: false })
    expect(await h.store.readActive('host-1')).toEqual(secondActive)
  })

  it('rejects orphan and extra-key active pointers', async () => {
    const orphan = await harness(); await orphan.store.reserveRevisionId('host-1')
    const file = path.join(orphan.root, 'host-1', 'active')
    await writeFile(file, JSON.stringify({ schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a') }))
    await chmod(file, 0o440)
    await expect(orphan.store.readActive('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    const extra = await harness(); await extra.store.reserveRevisionId('host-1')
    const extraFile = path.join(extra.root, 'host-1', 'active')
    await writeFile(extraFile, JSON.stringify({ schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a'), extra: true }))
    await chmod(extraFile, 0o440)
    await expect(extra.store.readActive('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
  })

  it('repairs only a torn audit tail and matches terminals against actual COMPLETE', async () => {
    const absent = await harness()
    expect(await absent.store.readAuditRecords('host-1')).toEqual([])
    await expect(access(path.join(absent.root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })

    const h = await harness(); const done = await complete(h.store); const active = await h.store.publishActive('host-1', done.revisionId)
    await h.store.appendAudit('host-1', audit(done.completed, 'FAILED'))
    await h.store.appendAudit('host-1', canonicalizeAgentHostAuditRecord({
      ...audit(done.completed, 'FAILED'), phase: 'PUBLICATION', completionDigest: done.completed.completion.completionDigest,
    }))
    const wrong = canonicalizeAgentHostAuditRecord({
      ...audit(done.completed), outcome: 'RECOVERY_REQUIRED', phase: 'RECOVERY', completionDigest: digest('0'),
    })
    await expect(h.store.appendAudit('host-1', wrong)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED, details: { field: 'audit' } })
    expect(await h.store.hasTerminalAudit('host-1', active)).toBe(false)
    const auditFile = path.join(h.root, 'host-1', 'audit.jsonl')
    await appendFile(auditFile, '{"torn":true')
    const tornBytes = await readFile(auditFile, 'utf8')
    expect(await h.store.readAuditRecords('host-1')).toHaveLength(2)
    expect(await readFile(auditFile, 'utf8')).toBe(tornBytes)
    await h.store.appendAudit('host-1', audit(done.completed))
    expect(await readFile(auditFile, 'utf8')).not.toContain('"torn"')
    const auditInfo = await stat(auditFile)
    expect(auditInfo).toMatchObject({ uid: OWNER_UID, gid: OWNER_GID, nlink: 1 })
    expect(auditInfo.mode & 0o777).toBe(0o600)
    expect(await h.store.hasTerminalAudit('host-1', active)).toBe(true)

    const corrupt = await harness(); await corrupt.store.reserveRevisionId('host-1')
    const corruptFile = path.join(corrupt.root, 'host-1', 'audit.jsonl'); await writeFile(corruptFile, 'not-json\n{"torn":true', { mode: 0o600 })
    const corruptBytes = await readFile(corruptFile, 'utf8')
    await expect(corrupt.store.readAuditRecords('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED, details: { field: 'audit' } })
    expect(await readFile(corruptFile, 'utf8')).toBe(corruptBytes)
    const preCompleteFailure = canonicalizeAgentHostAuditRecord({
      schemaVersion: 1, domain: 'boring-agent-host-audit:v1', revisionId: 'r0000000001', desiredStateDigest: digest('a'),
      outcome: 'FAILED', phase: 'READINESS', at: '2026-07-12T00:00:00.000Z',
      operator: { uid: 1000, effectiveUser: 'Julien', invocationId: 'deploy:corrupt' },
    })
    await expect(corrupt.store.appendAudit('host-1', preCompleteFailure)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    expect(await readFile(corruptFile, 'utf8')).toBe(corruptBytes)
  })

  it('admits terminal audits only for the current published COMPLETE revision', async () => {
    const h = await harness(); const first = await complete(h.store); const firstTerminal = audit(first.completed)
    await expect(h.store.appendAudit('host-1', firstTerminal)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    const firstActive = await h.store.publishActive('host-1', first.revisionId)
    await expect(h.store.appendAudit('host-1', firstTerminal)).resolves.toBeUndefined()
    const second = await complete(h.store); const secondActive = await h.store.publishActive('host-1', second.revisionId)
    await expect(h.store.appendAudit('host-1', firstTerminal)).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })
    await expect(h.store.appendAudit('host-1', audit(second.completed))).resolves.toBeUndefined()
    expect(await h.store.hasTerminalAudit('host-1', firstActive)).toBe(false)
    expect(await h.store.hasTerminalAudit('host-1', secondActive)).toBe(true)
  })

  it('requires an explicit safe owner policy before filesystem side effects', async () => {
    expect(() => createHostRevisionStore({ root: '/unused', ownerUid: -1, appGid: APP_GID })).toThrow(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID }))
    expect(() => createHostRevisionStore({ root: '/unused', ownerUid: OWNER_UID, appGid: 0 })).toThrow(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID }))
    await expect(createHostRevisionStore({ root: '/unused', ownerUid: OWNER_UID, appGid: APP_GID }).readActive('a'.repeat(251)))
      .rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'hostId' } })
    const wrongParent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-wrong-owner-'))
    const wrongRoot = path.join(wrongParent, 'state')
    const wrongOwner = createHostRevisionStore({ root: wrongRoot, ownerUid: OWNER_UID + 1, appGid: APP_GID })
    await expect(wrongOwner.reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(access(wrongRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const writableParent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-writable-parent-'))
    await chmod(writableParent, 0o770)
    const writableRoot = path.join(writableParent, 'state')
    await expect(createHostRevisionStore({ root: writableRoot, ownerUid: OWNER_UID, appGid: APP_GID }).reserveRevisionId('host-1'))
      .rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    await expect(access(writableRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const h = await harness(); const done = await complete(h.store)
    const wrongReader = createHostRevisionStore({ root: h.root, ownerUid: OWNER_UID + 1, appGid: APP_GID })
    await expect(wrongReader.readCandidate('host-1', done.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    await expect(wrongReader.readActive('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.PUBLICATION_FAILED })

    const hostRoot = path.join(h.root, 'host-1'); const before = await stat(hostRoot)
    const wrongAppReader = createHostRevisionStore({ root: h.root, ownerUid: OWNER_UID, appGid: APP_GID + 1 })
    await expect(wrongAppReader.readCandidate('host-1', done.revisionId)).rejects.toMatchObject({ code: AgentHostErrorCode.ROLLBACK_TARGET_INVALID })
    expect(await stat(hostRoot)).toMatchObject({ uid: before.uid, gid: before.gid, mode: before.mode })

    const oldParent = await mkdtemp(path.join(os.tmpdir(), 'boring-agent-host-old-tree-')); const oldRoot = path.join(oldParent, 'state')
    await mkdir(oldRoot, { mode: 0o700 }); await mkdir(path.join(oldRoot, 'host-1'), { mode: 0o700 }); await mkdir(path.join(oldRoot, 'host-1', 'revisions'), { mode: 0o700 })
    const oldStore = createHostRevisionStore({ root: oldRoot, ownerUid: OWNER_UID, appGid: APP_GID })
    await expect(oldStore.reserveRevisionId('host-1')).rejects.toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    expect((await stat(path.join(oldRoot, 'host-1'))).mode & 0o777).toBe(0o700)
    await expect(access(path.join(oldRoot, 'host-1', 'sequence'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('redacts OS failures even when configured paths contain secret-like text', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'secret-value-root-'))
    const root = path.join(parent, 'private-root'); await writeFile(root, 'not-a-directory')
    const error = await createHostRevisionStore({ root, ownerUid: OWNER_UID, appGid: APP_GID }).reserveRevisionId('host-1').catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.REVISION_CONFLICT })
    expect(JSON.stringify(error)).not.toMatch(/secret-value|private-root|ENOTDIR/)
  })
})
