import { access, appendFile, chmod, cp, mkdtemp, mkdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAgentAssetDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { D1HostErrorCode } from '../d1Plan.js'
import {
  canonicalizeD1AuditRecord,
  createD1DesiredSnapshot,
  type D1AuditRecordV1,
  type D1DesiredSnapshotV1,
} from '../d1RevisionCodec.js'
import { D1ActivePublishError, createHostRevisionStore, type D1HostRevisionStore } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const OWNER_UID = process.geteuid!()

async function desired(): Promise<D1DesiredSnapshotV1> {
  const snapshot = canonicalizeWorkspaceCompositionSnapshot({
    schemaVersion: 1,
    domain: 'boring-workspace-composition:v1',
    workspaceId: 'workspace:eclair',
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
  const definition = { definitionId: 'definition:eclair', version: '1.0.0', digest: digest('f'), instructionsRef: 'instructions.md' }
  const deploymentInput = {
    deploymentId: 'deployment:eclair', version: '2026.07.12', agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
  }
  const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId,
    workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest,
  })
  return createD1DesiredSnapshot({
    schemaVersion: 1, hostId: 'host-1', expectedHostRevision: 'r0000000042', hostAppImageDigest: digest('a'),
    runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots',
    sessionRootPolicyRef: 'session-roots', bindings: [{
      bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: snapshot.workspaceId,
      defaultDeploymentId: deploymentInput.deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
      workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation',
      ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Compare policies.' },
      environmentRef: 'production', secretRefs: ['credential-ref'],
    }],
  }, [{
    schemaVersion: 1, bindingId: 'insurance', composition: { snapshot, digest: compositionDigest },
    workspace: { workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, compositionDigest },
    deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest },
    definition, resolvedDigest,
  }])
}

async function harness(fault?: () => void) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-store-'))
  const root = path.join(parent, 'state')
  return { parent, root, store: createHostRevisionStore({ root, ownerUid: OWNER_UID, fault }) }
}
function observation(value: D1DesiredSnapshotV1, ready = true) {
  return {
    schemaVersion: 1 as const, domain: 'boring-d1-observed:v1' as const,
    bindings: value.resolvedBindings.map((binding) => ({ bindingId: binding.bindingId, ready, resolvedDigest: binding.resolvedDigest })),
  }
}
async function complete(store: D1HostRevisionStore) {
  const value = await desired()
  const revisionId = await store.reserveRevisionId('host-1')
  await store.writeCandidate('host-1', revisionId, value)
  await store.writeObservation('host-1', revisionId, observation(value))
  const completed = await store.writeComplete('host-1', revisionId)
  return { value, revisionId, completed }
}
function audit(completed: Awaited<ReturnType<typeof complete>>['completed'], outcome: 'COMPLETE' | 'FAILED' = 'COMPLETE'): D1AuditRecordV1 {
  return canonicalizeD1AuditRecord({
    schemaVersion: 1, domain: 'boring-d1-audit:v1', revisionId: completed.revisionId,
    desiredStateDigest: completed.desiredStateDigest, outcome, phase: outcome === 'COMPLETE' ? 'AUDIT' : 'READINESS',
    ...(outcome === 'COMPLETE' ? { completionDigest: completed.completion.completionDigest } : {}),
    at: '2026-07-12T00:00:00.000Z', operator: { uid: 1000, effectiveUser: 'Julien', invocationId: 'deploy:1' },
  })
}

describe('D1 host revision store', () => {
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
    expect(JSON.parse(files[0])).toMatchObject({ schemaVersion: 1, domain: 'boring-d1-plan:v1' })
    expect(JSON.parse(files[1])).toMatchObject({ schemaVersion: 1, domain: 'boring-d1-resolved:v1' })
    expect(JSON.parse(files[2])).toMatchObject({ bindings: [{ secretRefs: ['credential-ref'] }] })
    for (const managed of [h.root, path.join(h.root, 'host-1'), path.join(h.root, 'host-1', 'revisions'), directory]) {
      expect((await stat(managed)).mode & 0o777).toBe(0o700)
    }
    for (const artifact of ['desired.json', 'resolved.json', 'secret-refs.json', 'desired.sha256']) {
      expect((await stat(path.join(directory, artifact))).mode & 0o777).toBe(0o400)
    }
  })

  it('enforces durable monotonic reservation, permits gaps, and rejects bypass and corruption', async () => {
    const h = await harness()
    const value = await desired()
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000001')
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000002')
    await expect(h.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(h.store.writeCandidate('host-1', 'r0000000003', value)).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await h.store.writeCandidate('host-1', 'r0000000002', value)
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000003')
    expect(await h.store.reserveRevisionId('host-1')).toBe('r0000000004')
    const sequence = path.join(h.root, 'host-1', 'sequence')
    await chmod(sequence, 0o600); await writeFile(sequence, 'corrupt\n')
    await expect(h.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT, details: { field: 'sequence' } })

    const exhausted = await harness(); await exhausted.store.reserveRevisionId('host-1')
    const exhaustedSequence = path.join(exhausted.root, 'host-1', 'sequence')
    await chmod(exhaustedSequence, 0o600); await writeFile(exhaustedSequence, '9999999999\n'); await chmod(exhaustedSequence, 0o400)
    await expect(exhausted.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    expect(await readFile(exhaustedSequence, 'utf8')).toBe('9999999999\n')
  })

  it('rejects root, parent, host, revision, artifact, and active symlinks', async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-target-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-parent-'))
    const rootLink = path.join(parent, 'root-link'); await symlink(target, rootLink)
    await expect(createHostRevisionStore({ root: rootLink, ownerUid: OWNER_UID }).reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    const parentLink = path.join(parent, 'parent-link'); await symlink(target, parentLink)
    await expect(createHostRevisionStore({ root: path.join(parentLink, 'root'), ownerUid: OWNER_UID }).reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(access(path.join(target, 'root'))).rejects.toMatchObject({ code: 'ENOENT' })
    const ancestorTarget = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-ancestor-target-'))
    const ancestorParent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-ancestor-parent-'))
    await mkdir(path.join(ancestorTarget, 'nested'), { mode: 0o700 })
    await symlink(ancestorTarget, path.join(ancestorParent, 'alias'))
    await expect(createHostRevisionStore({ root: path.join(ancestorParent, 'alias', 'nested', 'root'), ownerUid: OWNER_UID }).reserveRevisionId('host-1'))
      .rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(access(path.join(ancestorTarget, 'nested', 'root'))).rejects.toMatchObject({ code: 'ENOENT' })

    const host = await harness(); await mkdir(host.root, { mode: 0o700 }); await symlink(target, path.join(host.root, 'host-1'))
    await expect(host.store.reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(host.store.readActive('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    const revisionsLink = await harness(); await mkdir(revisionsLink.root, { mode: 0o700 }); await mkdir(path.join(revisionsLink.root, 'host-1'), { mode: 0o700 })
    await symlink(target, path.join(revisionsLink.root, 'host-1', 'revisions'))
    await expect(revisionsLink.store.readCandidate('host-1', 'r0000000001')).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_TARGET_INVALID })
    const revision = await harness(); const value = await desired(); await revision.store.reserveRevisionId('host-1')
    await symlink(target, path.join(revision.root, 'host-1', 'revisions', 'r0000000001'))
    await expect(revision.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })

    const active = await harness(); const done = await complete(active.store)
    const desiredFile = path.join(active.root, 'host-1', 'revisions', done.revisionId, 'desired.json')
    await rename(desiredFile, `${desiredFile}.moved`); await symlink(`${desiredFile}.moved`, desiredFile)
    await expect(active.store.readCandidate('host-1', done.revisionId)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_TARGET_INVALID })
    const activeLink = await harness(); const linked = await complete(activeLink.store)
    await symlink(path.join(activeLink.root, 'host-1', 'revisions', linked.revisionId, 'completion.json'), path.join(activeLink.root, 'host-1', 'active'))
    await expect(activeLink.store.readActive('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('rejects regular preexisting revision targets and append-once artifacts', async () => {
    const value = await desired()
    const directoryTarget = await harness(); await directoryTarget.store.reserveRevisionId('host-1')
    await mkdir(path.join(directoryTarget.root, 'host-1', 'revisions', 'r0000000001'), { mode: 0o700 })
    await expect(directoryTarget.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    const fileTarget = await harness(); await fileTarget.store.reserveRevisionId('host-1')
    await writeFile(path.join(fileTarget.root, 'host-1', 'revisions', 'r0000000001'), 'occupied')
    await expect(fileTarget.store.writeCandidate('host-1', 'r0000000001', value)).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    const artifact = await harness(); const revisionId = await artifact.store.reserveRevisionId('host-1')
    await artifact.store.writeCandidate('host-1', revisionId, value)
    await writeFile(path.join(artifact.root, 'host-1', 'revisions', revisionId, 'observed.json'), 'occupied')
    await expect(artifact.store.writeObservation('host-1', revisionId, observation(value))).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY })
  })

  it('rejects a valid revision tree copied under a different host identity', async () => {
    const h = await harness(); const done = await complete(h.store)
    const host2 = path.join(h.root, 'host-2'); await mkdir(host2, { mode: 0o700 }); await mkdir(path.join(host2, 'revisions'), { mode: 0o700 })
    await cp(path.join(h.root, 'host-1', 'revisions', done.revisionId), path.join(host2, 'revisions', done.revisionId), { recursive: true })
    await expect(h.store.readCandidate('host-2', done.revisionId)).rejects.toMatchObject({
      code: D1HostErrorCode.ROLLBACK_TARGET_INVALID, details: { field: 'targetRevision' },
    })
  })

  it('rejects cross-binding observations and incomplete readiness', async () => {
    const h = await harness(); const value = await desired(); const revisionId = await h.store.reserveRevisionId('host-1')
    await h.store.writeCandidate('host-1', revisionId, value)
    await expect(h.store.writeObservation('host-1', revisionId, {
      ...observation(value), bindings: [{ ...observation(value).bindings[0], bindingId: 'other' }],
    })).rejects.toMatchObject({ code: D1HostErrorCode.PLAN_INVALID })
    await h.store.writeObservation('host-1', revisionId, observation(value, false))
    await expect(h.store.writeComplete('host-1', revisionId)).rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY })
  })

  it('recomputes COMPLETE and rejects tampered or missing immutable artifacts', async () => {
    const h = await harness(); const done = await complete(h.store)
    expect(await h.store.readComplete('host-1', done.revisionId)).toEqual(done.completed)
    for (const artifact of ['observed.json', 'completion.json']) {
      expect((await stat(path.join(h.root, 'host-1', 'revisions', done.revisionId, artifact))).mode & 0o777).toBe(0o400)
    }
    const digestFile = path.join(h.root, 'host-1', 'revisions', done.revisionId, 'desired.sha256')
    await chmod(digestFile, 0o600); await writeFile(digestFile, `${digest('0')}\n`)
    await expect(h.store.readComplete('host-1', done.revisionId)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_TARGET_INVALID })
    const missing = await harness(); const missingDone = await complete(missing.store)
    const resolved = path.join(missing.root, 'host-1', 'revisions', missingDone.revisionId, 'resolved.json')
    await rename(resolved, `${resolved}.moved`)
    await expect(missing.store.readComplete('host-1', missingDone.revisionId)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_TARGET_INVALID })
  })

  it('reports the exact active commit boundary and never rewinds after rename', async () => {
    const before = await harness(); const value = await desired(); const revisionId = await before.store.reserveRevisionId('host-1')
    await before.store.writeCandidate('host-1', revisionId, value)
    await expect(before.store.publishActive('host-1', revisionId)).rejects.toMatchObject({ committed: false })
    expect(await before.store.readActive('host-1')).toBeNull()

    const mismatch = await harness(); const mismatchDone = await complete(mismatch.store)
    const completionFile = path.join(mismatch.root, 'host-1', 'revisions', mismatchDone.revisionId, 'completion.json')
    const completionJson = JSON.parse(await readFile(completionFile, 'utf8'))
    await chmod(completionFile, 0o600); await writeFile(completionFile, JSON.stringify({ ...completionJson, desiredStateDigest: digest('0') }))
    await expect(mismatch.store.publishActive('host-1', mismatchDone.revisionId)).rejects.toMatchObject({ committed: false })
    expect(await mismatch.store.readActive('host-1')).toBeNull()

    const after = await harness(() => { throw new Error('/private/root secret-value') }); const done = await complete(after.store)
    const error = await after.store.publishActive('host-1', done.revisionId).catch((caught) => caught)
    expect(error).toBeInstanceOf(D1ActivePublishError)
    expect(error).toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED, committed: true, details: { field: 'active' } })
    expect(JSON.stringify(error)).not.toMatch(/private|secret-value/)
    expect(await after.store.readActive('host-1')).toEqual({ schemaVersion: 1, revisionId: done.revisionId, desiredStateDigest: done.completed.desiredStateDigest })
    expect((await stat(path.join(after.root, 'host-1', 'active'))).mode & 0o777).toBe(0o400)
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
    await chmod(file, 0o400)
    await expect(orphan.store.readActive('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    const extra = await harness(); await extra.store.reserveRevisionId('host-1')
    const extraFile = path.join(extra.root, 'host-1', 'active')
    await writeFile(extraFile, JSON.stringify({ schemaVersion: 1, revisionId: 'r0000000001', desiredStateDigest: digest('a'), extra: true }))
    await chmod(extraFile, 0o400)
    await expect(extra.store.readActive('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('repairs only a torn audit tail and matches terminals against actual COMPLETE', async () => {
    const absent = await harness()
    expect(await absent.store.readAuditRecords('host-1')).toEqual([])
    await expect(access(path.join(absent.root, 'host-1'))).rejects.toMatchObject({ code: 'ENOENT' })

    const h = await harness(); const done = await complete(h.store); const active = await h.store.publishActive('host-1', done.revisionId)
    await h.store.appendAudit('host-1', audit(done.completed, 'FAILED'))
    await h.store.appendAudit('host-1', canonicalizeD1AuditRecord({
      ...audit(done.completed, 'FAILED'), phase: 'PUBLICATION', completionDigest: done.completed.completion.completionDigest,
    }))
    const wrong = canonicalizeD1AuditRecord({
      ...audit(done.completed), outcome: 'RECOVERY_REQUIRED', phase: 'RECOVERY', completionDigest: digest('0'),
    })
    await expect(h.store.appendAudit('host-1', wrong)).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'audit' } })
    expect(await h.store.hasTerminalAudit('host-1', active)).toBe(false)
    const auditFile = path.join(h.root, 'host-1', 'audit.jsonl')
    await appendFile(auditFile, '{"torn":true')
    const tornBytes = await readFile(auditFile, 'utf8')
    expect(await h.store.readAuditRecords('host-1')).toHaveLength(2)
    expect(await readFile(auditFile, 'utf8')).toBe(tornBytes)
    await h.store.appendAudit('host-1', audit(done.completed))
    expect(await readFile(auditFile, 'utf8')).not.toContain('"torn"')
    expect((await stat(auditFile)).mode & 0o777).toBe(0o600)
    expect(await h.store.hasTerminalAudit('host-1', active)).toBe(true)

    const corrupt = await harness(); await corrupt.store.reserveRevisionId('host-1')
    const corruptFile = path.join(corrupt.root, 'host-1', 'audit.jsonl'); await writeFile(corruptFile, 'not-json\n{"torn":true', { mode: 0o600 })
    const corruptBytes = await readFile(corruptFile, 'utf8')
    await expect(corrupt.store.readAuditRecords('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'audit' } })
    expect(await readFile(corruptFile, 'utf8')).toBe(corruptBytes)
    const preCompleteFailure = canonicalizeD1AuditRecord({
      schemaVersion: 1, domain: 'boring-d1-audit:v1', revisionId: 'r0000000001', desiredStateDigest: digest('a'),
      outcome: 'FAILED', phase: 'READINESS', at: '2026-07-12T00:00:00.000Z',
      operator: { uid: 1000, effectiveUser: 'Julien', invocationId: 'deploy:corrupt' },
    })
    await expect(corrupt.store.appendAudit('host-1', preCompleteFailure)).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    expect(await readFile(corruptFile, 'utf8')).toBe(corruptBytes)
  })

  it('admits terminal audits only for the current published COMPLETE revision', async () => {
    const h = await harness(); const first = await complete(h.store); const firstTerminal = audit(first.completed)
    await expect(h.store.appendAudit('host-1', firstTerminal)).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    const firstActive = await h.store.publishActive('host-1', first.revisionId)
    await expect(h.store.appendAudit('host-1', firstTerminal)).resolves.toBeUndefined()
    const second = await complete(h.store); const secondActive = await h.store.publishActive('host-1', second.revisionId)
    await expect(h.store.appendAudit('host-1', firstTerminal)).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    await expect(h.store.appendAudit('host-1', audit(second.completed))).resolves.toBeUndefined()
    expect(await h.store.hasTerminalAudit('host-1', firstActive)).toBe(false)
    expect(await h.store.hasTerminalAudit('host-1', secondActive)).toBe(true)
  })

  it('requires an explicit safe owner policy before filesystem side effects', async () => {
    expect(() => createHostRevisionStore({ root: '/unused', ownerUid: -1 })).toThrow(expect.objectContaining({ code: D1HostErrorCode.PLAN_INVALID }))
    const wrongParent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-wrong-owner-'))
    const wrongRoot = path.join(wrongParent, 'state')
    const wrongOwner = createHostRevisionStore({ root: wrongRoot, ownerUid: OWNER_UID + 1 })
    await expect(wrongOwner.reserveRevisionId('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(access(wrongRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const writableParent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-writable-parent-'))
    await chmod(writableParent, 0o770)
    const writableRoot = path.join(writableParent, 'state')
    await expect(createHostRevisionStore({ root: writableRoot, ownerUid: OWNER_UID }).reserveRevisionId('host-1'))
      .rejects.toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    await expect(access(writableRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const h = await harness(); const done = await complete(h.store)
    const wrongReader = createHostRevisionStore({ root: h.root, ownerUid: OWNER_UID + 1 })
    await expect(wrongReader.readCandidate('host-1', done.revisionId)).rejects.toMatchObject({ code: D1HostErrorCode.ROLLBACK_TARGET_INVALID })
    await expect(wrongReader.readActive('host-1')).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('redacts OS failures even when configured paths contain secret-like text', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'secret-value-root-'))
    const root = path.join(parent, 'private-root'); await writeFile(root, 'not-a-directory')
    const error = await createHostRevisionStore({ root, ownerUid: OWNER_UID }).reserveRevisionId('host-1').catch((caught) => caught)
    expect(error).toMatchObject({ code: D1HostErrorCode.REVISION_CONFLICT })
    expect(JSON.stringify(error)).not.toMatch(/secret-value|private-root|ENOTDIR/)
  })
})
