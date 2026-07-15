import { execFile } from 'node:child_process'
import { chmod, link, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { createAgentAssetDigest, createAgentDefinitionDigest, createAgentDeploymentDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { createResolvedAgentDigest } from '@hachej/boring-agent/server'
import { describe, expect, it } from 'vitest'

import { createD1ActiveCollectionReader } from '../activeCollectionReader.js'
import { D1HostErrorCode } from '../d1Plan.js'
import { createD1DesiredSnapshot, type D1DesiredSnapshotV1 } from '../d1RevisionCodec.js'
import { createD1RuntimeInputsIdentity } from '../d1RuntimeInputs.js'
import { createHostRevisionStore } from '../hostRevisionStore.js'
import { canonicalizeWorkspaceCompositionSnapshot } from '../workspaceComposition.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const OWNER_UID = process.geteuid!()
const APP_GID = process.getegid!() || 10001
const run = promisify(execFile)

async function desired(content = 'Compare policies.'): Promise<D1DesiredSnapshotV1> {
  const snapshot = canonicalizeWorkspaceCompositionSnapshot({
    schemaVersion: 1, domain: 'boring-workspace-composition:v1', workspaceId: 'workspace:insurance',
    runtimeProfile: {
      ref: 'runsc-eu', id: 'runsc', version: '2026.07.12', contentDigest: digest('b'),
      isolationAttestationDigest: digest('c'), workspaceRootPolicyRef: 'workspace-roots', sessionRootPolicyRef: 'session-roots',
    },
    hostAppImageDigest: digest('a'), serverPlugins: [], defaultPluginPackages: [], staticSystemPromptDigest: digest('e'),
    inventories: { capabilities: [], tools: [], skills: null, mcpServers: null }, provisioning: [], filesystemBindings: [],
    policies: { externalPlugins: false, pluginAuthoring: false },
  })
  const compositionDigest = await createAgentAssetDigest(JSON.stringify(snapshot))
  const instructions = { path: 'instructions.md', content, digest: await createAgentAssetDigest(content) }
  const compiledDefinition = { schemaVersion: 1 as const, definitionId: 'definition:insurance', version: '1.0.0', instructionsRef: instructions.path }
  const definition = { definitionId: compiledDefinition.definitionId, version: compiledDefinition.version, instructionsRef: compiledDefinition.instructionsRef,
    digest: await createAgentDefinitionDigest({ definition: compiledDefinition, assets: [instructions] }) }
  const deploymentInput = {
    deploymentId: 'deployment:insurance', version: '2026.07.12', agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest },
  }
  const deploymentDigest = await createAgentDeploymentDigest(deploymentInput)
  const resolvedDigest = await createResolvedAgentDigest({
    workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId,
    workspaceCompositionDigest: compositionDigest, definitionDigest: definition.digest, deploymentDigest,
  })
  return createD1DesiredSnapshot({
    schemaVersion: 1, hostId: 'host-1', expectedHostRevision: null, hostAppImageDigest: digest('a'),
    runtimeProfileRef: 'runsc-eu', databaseRef: 'postgres-eu', workspaceRootPolicyRef: 'workspace-roots',
    sessionRootPolicyRef: 'session-roots', bindings: [{
      bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: snapshot.workspaceId,
      defaultDeploymentId: deploymentInput.deploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
      workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation', ownerPrincipalRef: 'owner',
      landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: ['credential-ref'],
    }],
  }, [{
    schemaVersion: 1, bindingId: 'insurance', composition: { snapshot, digest: compositionDigest },
    workspace: { workspaceId: snapshot.workspaceId, defaultDeploymentId: deploymentInput.deploymentId, compositionDigest },
    deployment: { deploymentId: deploymentInput.deploymentId, version: deploymentInput.version, agentId: 'default', digest: deploymentDigest },
    definition, resolvedDigest,
  }])
}

async function observation(value: D1DesiredSnapshotV1, ready = true) {
  const binding = value.plan.bindings[0]!
  return {
    schemaVersion: 1 as const, domain: 'boring-d1-observed:v1' as const, bindings: [{
      bindingId: binding.bindingId, ready, resolvedDigest: value.resolvedBindings[0]!.resolvedDigest,
      runtimeInputs: await createD1RuntimeInputsIdentity(binding, {
        environment: { versionFingerprint: digest('6') }, workspaceAllocation: { versionFingerprint: digest('7') },
        sessionAllocation: { versionFingerprint: digest('8') },
        secrets: [{ secretRef: 'credential-ref', providerVersionFingerprint: digest('9') }],
      }),
    }],
  }
}

async function fixture(complete = true, content = 'Compare policies.') {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-active-reader-'))
  const root = path.join(parent, 'state')
  const store = createHostRevisionStore({ root, ownerUid: OWNER_UID, appGid: APP_GID })
  const value = await desired(content)
  const revisionId = await store.reserveRevisionId('host-1')
  const binding = value.plan.bindings[0]!; const definition = value.resolvedBindings[0]!.definition
  const asset = { path: definition.instructionsRef, content, digest: await createAgentAssetDigest(content) }
  const bundleDefinition = { schemaVersion: 1 as const, definitionId: definition.definitionId, version: definition.version, instructionsRef: asset.path }
  const bundle = { definition: bundleDefinition, definitionDigest: definition.digest, assets: [asset] }
  const deployment = { deploymentId: binding.defaultDeploymentId, version: '2026.07.12', agentId: 'default',
    definition: { definitionId: definition.definitionId, version: definition.version, digest: definition.digest } }
  const candidate = await store.writeCandidate('host-1', revisionId, value, [{ envelope: { schemaVersion: 1, domain: 'boring-d1-agent-artifact:v1', hostId: 'host-1',
    bindingId: binding.bindingId, bundleRef: binding.bundleRef, deploymentRef: binding.deploymentRef,
    workspaceAllocationRef: binding.workspaceAllocationRef, workspaceCompositionDigest: value.resolvedBindings[0]!.composition.digest, bundle, deployment } }])
  let active = { schemaVersion: 1 as const, revisionId, desiredStateDigest: candidate.desiredStateDigest }
  if (complete) {
    await store.writeObservation('host-1', revisionId, await observation(value))
    await store.writeComplete('host-1', revisionId)
    active = await store.publishActive('host-1', revisionId)
  } else {
    const activeFile = path.join(root, 'host-1', 'active')
    await writeFile(activeFile, JSON.stringify(active)); await chmod(activeFile, 0o440)
  }
  const hostRoot = path.join(root, 'host-1')
  const revisionRoot = path.join(hostRoot, 'revisions', revisionId)
  return { hostRoot, revisionRoot, revisionId, active, value }
}

function reader(hostRoot: string, overrides: Partial<Parameters<typeof createD1ActiveCollectionReader>[0]> = {}) {
  return createD1ActiveCollectionReader({ hostRoot, hostId: 'host-1', ownerUid: OWNER_UID, appGid: APP_GID, ...overrides })
}

async function rewriteJson(file: string, mutate: (raw: Record<string, any>) => void): Promise<void> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
  mutate(raw); await chmod(file, 0o600); await writeFile(file, JSON.stringify(raw)); await chmod(file, 0o440)
}

async function expectFailure(action: Promise<unknown>): Promise<void> {
  const failure = await action.catch((error) => error)
  expect(failure).toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'active' } })
  expect(JSON.stringify(failure)).not.toMatch(/credential-ref|secret-value|private|active-reader-|desired\.json|resolved\.json/)
}

describe('D1 mounted active collection reader', () => {
  it('returns one frozen canonical COMPLETE collection', async () => {
    const h = await fixture()
    const collection = await reader(h.hostRoot).read()
    expect(collection).toMatchObject({ active: h.active, desired: h.value, observation: { bindings: [{ ready: true }] }, completion: { status: 'COMPLETE' } })
    expect(Object.isFrozen(collection)).toBe(true)
    expect(Object.isFrozen(collection!.desired.plan.bindings)).toBe(true)
    expect(collection).not.toHaveProperty('secretRefs')
  })

  it('reads the selected artifact only while the same active revision remains current', async () => {
    const h = await fixture(); const activeReader = reader(h.hostRoot); const collection = (await activeReader.read())!
    const binding = collection.desired.plan.bindings[0]!
    await expect(activeReader.readAgentArtifact(collection, binding)).resolves.toMatchObject({
      bindingId: binding.bindingId, bundleRef: binding.bundleRef, deploymentRef: binding.deploymentRef,
    })
    const activeFile = path.join(h.hostRoot, 'active'); await chmod(activeFile, 0o600)
    await writeFile(activeFile, JSON.stringify({ ...collection.active, revisionId: 'r0000000002' })); await chmod(activeFile, 0o440)
    await expect(activeReader.readAgentArtifact(collection, binding)).rejects.toMatchObject({
      code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'agentArtifacts' },
    })
  })

  it('serves a valid immutable artifact above the general revision-file cap', async () => {
    const content = 'x'.repeat(4 * 1024 * 1024 + 1); const h = await fixture(true, content)
    const activeReader = reader(h.hostRoot); const collection = (await activeReader.read())!
    const artifact = await activeReader.readAgentArtifact(collection, collection.desired.plan.bindings[0]!)
    expect(artifact.bundle.assets[0]!.content).toHaveLength(content.length)
  })

  it('returns null only for a valid mounted host tree without active', async () => {
    const h = await fixture()
    await rename(path.join(h.hostRoot, 'active'), path.join(h.hostRoot, 'inactive'))
    expect(await reader(h.hostRoot).read()).toBeNull()
    await chmod(h.hostRoot, 0o700)
    await expectFailure(reader(h.hostRoot).read())
  })

  it.each([
    ['candidate/incomplete', async () => fixture(false), async () => {}],
    ['orphan', fixture, async (h: Awaited<ReturnType<typeof fixture>>) => rewriteJson(path.join(h.hostRoot, 'active'), (raw) => { raw.revisionId = 'r9999999999' })],
    ['host mismatch', fixture, async (h: Awaited<ReturnType<typeof fixture>>) => { await expectFailure(reader(h.hostRoot, { hostId: 'host-2' }).read()) }],
    ['active digest mismatch', fixture, async (h: Awaited<ReturnType<typeof fixture>>) => rewriteJson(path.join(h.hostRoot, 'active'), (raw) => { raw.desiredStateDigest = digest('0') })],
  ])('rejects %s publication state', async (name, make, mutate) => {
    const h = await make(); await mutate(h)
    if (name !== 'host mismatch') await expectFailure(reader(h.hostRoot).read())
  })

  it.each(['active', 'desired.json', 'resolved.json', 'secret-refs.json', 'observed.json', 'completion.json'])
    ('rejects malformed and extra-key %s JSON', async (artifact) => {
      for (const extra of [false, true]) {
        const h = await fixture(); const file = artifact === 'active' ? path.join(h.hostRoot, artifact) : path.join(h.revisionRoot, artifact)
        await chmod(file, 0o600)
        await writeFile(file, extra ? JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), unexpected: true }) : '{malformed')
        await chmod(file, 0o440)
        await expectFailure(reader(h.hostRoot).read())
      }
    })

  it.each([
    ['desired.json', (raw: any) => { raw.plan.hostId = 'host-2' }],
    ['resolved.json', (raw: any) => { raw.bindings[0].resolvedDigest = digest('0') }],
    ['secret-refs.json', (raw: any) => { raw.bindings[0].secretRefs.push('secret-value') }],
    ['observed.json', (raw: any) => { raw.bindings[0].runtimeInputs.environment.versionFingerprint = digest('0') }],
    ['completion.json', (raw: any) => { raw.completionDigest = digest('0') }],
  ])('rejects tampered %s', async (artifact, mutate) => {
    const h = await fixture(); await rewriteJson(path.join(h.revisionRoot, artifact), mutate)
    await expectFailure(reader(h.hostRoot).read())
  })

  it('rejects tampered desired digest and binding env', async () => {
    for (const artifact of ['desired.sha256', 'bindings/insurance.env']) {
      const h = await fixture(); const file = path.join(h.revisionRoot, artifact)
      await chmod(file, 0o600); await writeFile(file, 'secret-value\n'); await chmod(file, 0o440)
      await expectFailure(reader(h.hostRoot).read())
    }
  })

  it.each(['.', 'revisions', 'revision', 'bindings'])('rejects symlinked or wrongly-modeled %s directory', async (kind) => {
    for (const mutation of ['symlink', 'mode']) {
      const h = await fixture()
      const target = kind === '.' ? h.hostRoot : kind === 'revisions' ? path.join(h.hostRoot, 'revisions')
        : kind === 'revision' ? h.revisionRoot : path.join(h.revisionRoot, 'bindings')
      if (mutation === 'mode') await chmod(target, 0o755)
      else { await rename(target, `${target}.target`); await symlink(`${target}.target`, target) }
      await expectFailure(reader(h.hostRoot).read())
    }
  })

  it.each(['active', 'desired.json', 'resolved.json', 'secret-refs.json', 'desired.sha256', 'bindings/insurance.env', 'observed.json', 'completion.json'])
    ('rejects linked or wrongly-modeled %s', async (artifact) => {
      for (const mutation of ['symlink', 'hardlink', 'mode']) {
        const h = await fixture(); const file = artifact === 'active' ? path.join(h.hostRoot, artifact) : path.join(h.revisionRoot, artifact)
        if (mutation === 'mode') await chmod(file, 0o444)
        else if (mutation === 'hardlink') await link(file, `${file}.link`)
        else { await rename(file, `${file}.target`); await symlink(`${file}.target`, file) }
        await expectFailure(reader(h.hostRoot).read())
      }
    })

  it('rejects a FIFO substitution without blocking before fstat', async () => {
    const h = await fixture(); const active = path.join(h.hostRoot, 'active')
    await rename(active, `${active}.target`); await run('mkfifo', [active]); await chmod(active, 0o440)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('FIFO open blocked')), 500))
    await expectFailure(Promise.race([reader(h.hostRoot).read(), timeout]))
  })

  it('rejects wrong expected owner and group plus noncanonical factory inputs', async () => {
    const h = await fixture()
    await expectFailure(reader(h.hostRoot, { ownerUid: OWNER_UID + 1 }).read())
    await expectFailure(reader(h.hostRoot, { appGid: APP_GID + 1 }).read())
    for (const options of [
      undefined, { hostRoot: 'relative', hostId: 'host-1', ownerUid: OWNER_UID, appGid: APP_GID },
      { hostRoot: `${h.hostRoot}/`, hostId: 'host-1', ownerUid: OWNER_UID, appGid: APP_GID },
      { hostRoot: h.hostRoot, hostId: '../host', ownerUid: OWNER_UID, appGid: APP_GID },
      { hostRoot: h.hostRoot, hostId: 'host-1', ownerUid: -1, appGid: APP_GID },
      { hostRoot: h.hostRoot, hostId: 'host-1', ownerUid: OWNER_UID, appGid: 0 },
    ]) expect(() => createD1ActiveCollectionReader(options as never)).toThrow(expect.objectContaining({ code: D1HostErrorCode.PLAN_INVALID }))
  })

  it('does not inspect providers, /run, directory contents, or secret-value files', async () => {
    const h = await fixture()
    await writeFile(path.join(h.revisionRoot, 'secret-values.json'), 'secret-value', { mode: 0 })
    expect(await reader(h.hostRoot).read()).not.toBeNull()
    const source = await readFile(new URL('../activeCollectionReader.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/createHostRevisionStore|O_DIRECTORY|readdir|provider|['"]\/run|process\.env/)
  })
})
