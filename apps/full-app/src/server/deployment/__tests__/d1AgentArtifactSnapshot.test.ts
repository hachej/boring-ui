import { chmod, link, mkdtemp, mkdir, rename, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createAgentAssetDigest, createAgentDefinitionDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { describe, expect, it, vi } from 'vitest'

import { loadD1AgentArtifactInputs } from '../d1AgentArtifactSnapshot.js'
import { D1HostErrorCode, type D1SiteBindingV1 } from '../d1Plan.js'

const digest = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const binding: D1SiteBindingV1 = { bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle@1', deploymentRef: 'deployment@1',
  workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation', ownerPrincipalRef: 'owner',
  landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: [] }
const limits = { maxBindings: 2, maxBundleBytes: 64 * 1024, maxTotalBundleBytes: 64 * 1024 }

async function artifact(overrides: Record<string, unknown> = {}) {
  const content = 'Compare policies.'; const asset = { path: 'instructions.md', content, digest: await createAgentAssetDigest(content) }
  const definition = { schemaVersion: 1 as const, definitionId: 'definition:insurance', version: '1.0.0', instructionsRef: asset.path }
  const definitionDigest = await createAgentDefinitionDigest({ definition, assets: [asset] })
  return { schemaVersion: 1, domain: 'boring-d1-agent-artifact:v1', hostId: 'host-1', bindingId: binding.bindingId,
    bundleRef: binding.bundleRef, deploymentRef: binding.deploymentRef, bundle: { definition, definitionDigest, assets: [asset] },
    deployment: { deploymentId: binding.defaultDeploymentId, version: '1.0.0', agentId: 'default',
      definition: { definitionId: definition.definitionId, version: definition.version, digest: definitionDigest } }, ...overrides }
}
async function inbox(value?: Awaited<ReturnType<typeof artifact>>) {
  value ??= await artifact()
  const parent = await mkdtemp(path.join(os.tmpdir(), 'd1-agent-artifacts-')); const root = path.join(parent, 'artifacts')
  const host = path.join(root, 'host-1'); const slot = path.join(host, binding.bindingId); const file = path.join(slot, 'artifact.json')
  for (const directory of [root, host, slot]) { await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700) }
  await writeFile(file, JSON.stringify(value), { mode: 0o400 }); await chmod(file, 0o400)
  return { parent, root, slot, file }
}
const load = (root: string, extra: Record<string, unknown> = {}) => loadD1AgentArtifactInputs({
  hostId: 'host-1', ownerUid: process.geteuid!(), root, limits, inputs: [{ binding, compositionDigest: digest('c') }], ...extra,
})

describe('D1 immutable agent artifact inbox', () => {
  it('resolves an opaque-ref binding from its fixed binding-id slot', async () => {
    const h = await inbox(); const [loaded] = await load(h.root)
    expect(loaded?.envelope).toMatchObject({ bindingId: 'insurance', bundleRef: 'bundle@1', deploymentRef: 'deployment@1' })
    expect(loaded?.envelope.bundle.assets).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'Compare policies.' })]))
  })

  it('canonicalizes artifact assets by path before snapshotting', async () => {
    const value = await artifact(); const extra = { path: 'a.txt', content: 'a', digest: await createAgentAssetDigest('a') }
    value.bundle.assets = [value.bundle.assets[0]!, extra].reverse()
    value.bundle.definitionDigest = await createAgentDefinitionDigest({ definition: value.bundle.definition, assets: value.bundle.assets })
    value.deployment.definition.digest = value.bundle.definitionDigest
    const [loaded] = await load((await inbox(value)).root)
    expect(loaded!.envelope.bundle.assets.map((asset) => asset.path)).toEqual(['a.txt', 'instructions.md'])
  })

  it('accepts the injected byte cap exactly and rejects cap plus one', async () => {
    const h = await inbox(); const size = (await stat(h.file)).size
    await expect(load(h.root, { limits: { ...limits, maxBundleBytes: size, maxTotalBundleBytes: size } })).resolves.toHaveLength(1)
    await expect(load(h.root, { limits: { ...limits, maxBundleBytes: size - 1 } })).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
  })

  it('rejects filesystem drift, changed reads, oversize input, and tampered identities', async () => {
    const cases: Array<(h: Awaited<ReturnType<typeof inbox>>) => Promise<Record<string, unknown> | void>> = [
      async ({ slot }) => { await writeFile(path.join(slot, 'extra'), 'x', { mode: 0o400 }) },
      async ({ file }) => { await chmod(file, 0o600) },
      async ({ parent, file }) => { await link(file, path.join(parent, 'hardlink')) },
      async ({ parent, file }) => { const target = path.join(parent, 'target'); await rename(file, target); await symlink(target, file) },
      async () => ({ limits: { ...limits, maxBundleBytes: 1 } }),
      async () => ({ fault: async () => { await chmod(current!.file, 0o600); await writeFile(current!.file, '{}'); await chmod(current!.file, 0o400) } }),
      async ({ slot }) => ({ fault: async (point: string) => { if (point === 'after-directory-open') await rename(slot, `${slot}-moved`) } }),
      async ({ file }) => ({ fault: async (point: string) => { if (point === 'after-file-open') await rename(file, `${file}-moved`) } }),
    ]
    let current: Awaited<ReturnType<typeof inbox>> | undefined
    for (const mutate of cases) {
      current = await inbox(); const extra = await mutate(current)
      await expect(load(current.root, extra ?? {})).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    }
    const wrongRef = await inbox(await artifact({ bundleRef: '../bundle' }))
    await expect(load(wrongRef.root)).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED })
    const tampered = await artifact(); (tampered.bundle.assets[0] as { content: string }).content = 'tampered'
    await expect(load((await inbox(tampered)).root)).rejects.toMatchObject({ validationCode: 'AGENT_DEFINITION_INVALID' })
  })

  it('rejects an input tree owned by a different uid than the command policy', async () => {
    const h = await inbox(); const policyUid = process.geteuid!() + 1
    const identity = vi.spyOn(process, 'geteuid').mockReturnValue(policyUid)
    try { await expect(load(h.root, { ownerUid: policyUid })).rejects.toMatchObject({ code: D1HostErrorCode.PUBLICATION_FAILED }) }
    finally { identity.mockRestore() }
  })
})
