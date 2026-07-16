import { chmod, chown, link, mkdir, mkdtemp, readFile, rename, statfs, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Sha256Digest } from '@hachej/boring-agent/shared'
import { describe, expect, it } from 'vitest'

import { createAgentHostFileRuntimeInputsProvider } from '../agentHostFileRuntimeInputsProvider.js'
import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from '../agentHostPlan.js'

const OWNER_UID = process.geteuid!()
const TMPFS_PARENT = process.env.XDG_RUNTIME_DIR ?? `/run/user/${OWNER_UID}`
const sha = (value: string): Sha256Digest => `sha256:${value.repeat(64).slice(0, 64)}`
const GENERATION_A = 'a'.repeat(64)
const GENERATION_B = 'b'.repeat(64)

function binding(secretRefs: readonly string[] = ['credential-ref', 'secondary-ref']): AgentHostSiteBindingV1 {
  return {
    bindingId: 'insurance', hostname: 'insurance.example.test', workspaceId: 'workspace:insurance',
    defaultDeploymentId: 'deployment:insurance', bundleRef: 'bundle', deploymentRef: 'deployment',
    workspaceAllocationRef: 'insurance-workspace', sessionAllocationRef: 'insurance-session', ownerPrincipalRef: 'owner',
    landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs,
  }
}
function manifest(site: AgentHostSiteBindingV1, valueGeneration = GENERATION_A, secretFingerprint = sha('4')) {
  return {
    schemaVersion: 1, domain: 'boring-agent-host-file-runtime-inputs:v1', hostId: 'host-1', bindingId: site.bindingId,
    environment: { ref: site.environmentRef, versionFingerprint: sha('1') },
    workspaceAllocation: { ref: site.workspaceAllocationRef, versionFingerprint: sha('2') },
    sessionAllocation: { ref: site.sessionAllocationRef, versionFingerprint: sha('3') },
    valueGeneration,
    secrets: site.secretRefs.map((secretRef, index) => ({
      secretRef, providerVersionFingerprint: secretFingerprint, file: String(index).padStart(4, '0'),
    })),
  }
}
async function directory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 }); await chmod(directoryPath, 0o700)
}
interface Fixture {
  readonly base: string
  readonly metadataRoot: string
  readonly valueRoot: string
  readonly binding: AgentHostSiteBindingV1
  readonly manifestPath: string
  readonly inputBindingRoot: string
  readonly inputGenerationRoot: string
}
async function fixture(secretRefs: readonly string[] = ['credential-ref', 'secondary-ref'], parent = TMPFS_PARENT, includeValues = true): Promise<Fixture> {
  const base = await mkdtemp(path.join(parent, 'boring-agent-host-file-provider-')); await chmod(base, 0o700)
  const metadataRoot = path.join(base, 'metadata'); const valueRoot = path.join(base, 'values'); const site = binding(secretRefs)
  const metadataBindingRoot = path.join(metadataRoot, 'host-1', site.bindingId)
  for (const item of [metadataRoot, path.join(metadataRoot, 'host-1'), metadataBindingRoot]) await directory(item)
  const manifestPath = path.join(metadataBindingRoot, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest(site)), { mode: 0o400 }); await chmod(manifestPath, 0o400)
  const inputBindingRoot = path.join(valueRoot, 'host-1', site.bindingId)
  const inputGenerationRoot = path.join(inputBindingRoot, 'generations', GENERATION_A)
  if (secretRefs.length > 0 && includeValues) {
    for (const item of [valueRoot, path.join(valueRoot, 'host-1'), inputBindingRoot, path.join(inputBindingRoot, 'generations'), inputGenerationRoot]) await directory(item)
    for (const [index, secretRef] of secretRefs.entries()) {
      const file = path.join(inputGenerationRoot, String(index).padStart(4, '0'))
      await writeFile(file, `canary:${secretRef}`, { mode: 0o400 }); await chmod(file, 0o400)
    }
    await chmod(inputGenerationRoot, 0o500)
  }
  return { base, metadataRoot, valueRoot, binding: site, manifestPath, inputBindingRoot, inputGenerationRoot }
}
function provider(input: Fixture, ownerUid = OWNER_UID) {
  return createAgentHostFileRuntimeInputsProvider({ hostId: 'host-1', ownerUid, metadataRoot: input.metadataRoot, valueRoot: input.valueRoot })
}
async function replaceManifest(input: Fixture, value: unknown | Uint8Array): Promise<void> {
  await chmod(input.manifestPath, 0o600)
  await writeFile(input.manifestPath, value instanceof Uint8Array ? value : JSON.stringify(value))
  await chmod(input.manifestPath, 0o400)
}
async function writeGeneration(input: Fixture, generation: string, prefix: string): Promise<string> {
  const root = path.join(input.inputBindingRoot, 'generations', generation); await directory(root)
  for (const [index, secretRef] of input.binding.secretRefs.entries()) {
    const file = path.join(root, String(index).padStart(4, '0'))
    await writeFile(file, `${prefix}:${secretRef}`, { mode: 0o400 }); await chmod(file, 0o400)
  }
  await chmod(root, 0o500)
  return root
}
async function unavailable(operation: Promise<unknown>, input: Fixture): Promise<void> {
  const error = await operation.catch((caught) => caught)
  expect(error).toMatchObject({ code: AgentHostErrorCode.SECRET_UNAVAILABLE, details: { field: 'secret' } })
  expect(JSON.stringify(error)).not.toContain(input.base)
  expect(JSON.stringify(error)).not.toMatch(/credential-ref|canary:/)
}

describe('AgentHost file runtime-input provider', () => {
  it('inspects only canonical metadata and resolves fresh full-span value buffers', async () => {
    const input = await fixture(); const source = provider(input)
    const inspection = await source.inspect(input.binding)
    expect(inspection).toEqual({
      bindingId: 'insurance', environmentVersionFingerprint: sha('1'), workspaceAllocationVersionFingerprint: sha('2'),
      sessionAllocationVersionFingerprint: sha('3'), secrets: [
        { secretRef: 'credential-ref', providerVersionFingerprint: sha('4') },
        { secretRef: 'secondary-ref', providerVersionFingerprint: sha('4') },
      ],
    })
    expect(Object.isFrozen(inspection)).toBe(true)
    const resolved = await source.resolveSecrets(input.binding)
    expect(resolved.secrets.map(({ secretRef, value }) => [secretRef, new TextDecoder().decode(value)])).toEqual([
      ['credential-ref', 'canary:credential-ref'], ['secondary-ref', 'canary:secondary-ref'],
    ])
    for (const secret of resolved.secrets) {
      expect(secret.value.byteOffset).toBe(0); expect(secret.value.byteLength).toBe(secret.value.buffer.byteLength)
    }
    const resolvedAgain = await source.resolveSecrets(input.binding)
    expect(resolvedAgain.secrets[0]!.value.buffer).not.toBe(resolved.secrets[0]!.value.buffer)
    resolved.secrets[0]!.value.fill(0)
    expect(await readFile(path.join(input.inputGenerationRoot, '0000'), 'utf8')).toBe('canary:credential-ref')
  })

  it('does not touch the value root during inspect or for a zero-secret binding', async () => {
    const missingValues = await fixture(['credential-ref'])
    const inspected = await createAgentHostFileRuntimeInputsProvider({
      hostId: 'host-1', ownerUid: OWNER_UID, metadataRoot: missingValues.metadataRoot, valueRoot: path.join(missingValues.base, 'absent'),
    }).inspect(missingValues.binding)
    expect(inspected.secrets).toHaveLength(1)
    const empty = await fixture([])
    expect(await provider(empty).resolveSecrets(empty.binding)).toEqual({ bindingId: 'insurance', secrets: [] })
  })

  it('rejects malformed or mismatched manifests with one redacted error', async () => {
    const cases: Array<(input: Fixture) => unknown | Uint8Array> = [
      (input) => ({ ...manifest(input.binding), unexpected: true }),
      (input) => ({ ...manifest(input.binding), hostId: 'host-2' }),
      (input) => ({ ...manifest(input.binding), environment: { ref: 'staging', versionFingerprint: sha('1') } }),
      (input) => ({ ...manifest(input.binding), valueGeneration: '../secret' }),
      (input) => ({ ...manifest(input.binding), secrets: [...manifest(input.binding).secrets].reverse() }),
      (input) => ({ ...manifest(input.binding), secrets: [{ ...manifest(input.binding).secrets[0], file: '../secret' }, manifest(input.binding).secrets[1]] }),
      () => Uint8Array.from([0xff, 0xfe, 0xfd]),
      () => new Uint8Array(512 * 1024 + 1),
    ]
    for (const mutate of cases) {
      const input = await fixture(); await replaceManifest(input, mutate(input)); await unavailable(provider(input).inspect(input.binding), input)
    }
    const tooMany = await fixture(Array.from({ length: 1025 }, (_value, index) => `secret-${String(index).padStart(4, '0')}`), TMPFS_PARENT, false)
    await unavailable(provider(tooMany).inspect(tooMany.binding), tooMany)
  })

  it('rejects unsafe metadata roots, files, owner policy, and links', async () => {
    const wrongMode = await fixture(); await chmod(wrongMode.manifestPath, 0o600)
    await unavailable(provider(wrongMode).inspect(wrongMode.binding), wrongMode)
    const hardLinked = await fixture(); await link(hardLinked.manifestPath, path.join(hardLinked.base, 'manifest-hardlink'))
    await unavailable(provider(hardLinked).inspect(hardLinked.binding), hardLinked)
    const linkedRoot = await fixture(); const alias = path.join(linkedRoot.base, 'metadata-alias'); await symlink(linkedRoot.metadataRoot, alias)
    await unavailable(createAgentHostFileRuntimeInputsProvider({ hostId: 'host-1', ownerUid: OWNER_UID, metadataRoot: alias, valueRoot: linkedRoot.valueRoot }).inspect(linkedRoot.binding), linkedRoot)
    expect(() => provider(linkedRoot, OWNER_UID + 1)).toThrow(expect.objectContaining({ code: AgentHostErrorCode.SECRET_UNAVAILABLE }))
  })

  it('keeps descendant reads anchored when the validated metadata root is replaced', async () => {
    const input = await fixture(); const moved = `${input.metadataRoot}-moved`; let replaced = false
    const source = createAgentHostFileRuntimeInputsProvider({
      hostId: 'host-1', ownerUid: OWNER_UID, metadataRoot: input.metadataRoot, valueRoot: input.valueRoot,
      fault: async (point) => {
        if (point !== 'metadata-root-open' || replaced) return
        replaced = true; await rename(input.metadataRoot, moved); await symlink(path.join(input.base, 'missing'), input.metadataRoot)
      },
    })
    expect(await source.inspect(input.binding)).toMatchObject({ bindingId: 'insurance', environmentVersionFingerprint: sha('1') })
  })

  it('keeps manifest reads anchored when the validated binding directory is replaced', async () => {
    const input = await fixture(); const bindingRoot = path.dirname(input.manifestPath); const moved = `${bindingRoot}-moved`; let replaced = false
    const source = createAgentHostFileRuntimeInputsProvider({
      hostId: 'host-1', ownerUid: OWNER_UID, metadataRoot: input.metadataRoot, valueRoot: input.valueRoot,
      fault: async (point) => {
        if (point !== 'metadata-binding-open' || replaced) return
        replaced = true; await rename(bindingRoot, moved); await symlink(path.join(input.base, 'missing'), bindingRoot)
      },
    })
    expect(await source.inspect(input.binding)).toMatchObject({ bindingId: 'insurance', environmentVersionFingerprint: sha('1') })
  })

  it('keeps value reads anchored when the validated binding directory is replaced', async () => {
    const input = await fixture(['credential-ref']); const moved = `${input.inputBindingRoot}-moved`; let replaced = false
    const source = createAgentHostFileRuntimeInputsProvider({
      hostId: 'host-1', ownerUid: OWNER_UID, metadataRoot: input.metadataRoot, valueRoot: input.valueRoot,
      fault: async (point) => {
        if (point !== 'value-binding-open' || replaced) return
        replaced = true; await rename(input.inputBindingRoot, moved); await symlink(path.join(input.base, 'missing'), input.inputBindingRoot)
      },
    })
    const resolved = await source.resolveSecrets(input.binding)
    expect(new TextDecoder().decode(resolved.secrets[0]!.value)).toBe('canary:credential-ref')
  })

  it('requires an exact tmpfs value tree with bounded regular files', async () => {
    const mutable = await fixture(['credential-ref']); await chmod(mutable.inputGenerationRoot, 0o700); await unavailable(provider(mutable).resolveSecrets(mutable.binding), mutable)
    const extra = await fixture(['credential-ref']); const extraFile = path.join(extra.inputGenerationRoot, '0001')
    await chmod(extra.inputGenerationRoot, 0o700); await writeFile(extraFile, 'unused', { mode: 0o400 }); await chmod(extraFile, 0o400); await chmod(extra.inputGenerationRoot, 0o500)
    await unavailable(provider(extra).resolveSecrets(extra.binding), extra)
    const wrongMode = await fixture(['credential-ref']); await chmod(path.join(wrongMode.inputGenerationRoot, '0000'), 0o600)
    await unavailable(provider(wrongMode).resolveSecrets(wrongMode.binding), wrongMode)
    const oversized = await fixture(['credential-ref']); const file = path.join(oversized.inputGenerationRoot, '0000')
    await chmod(file, 0o600); await writeFile(file, new Uint8Array(64 * 1024 + 1)); await chmod(file, 0o400)
    await unavailable(provider(oversized).resolveSecrets(oversized.binding), oversized)
    const empty = await fixture(['credential-ref']); const emptyFile = path.join(empty.inputGenerationRoot, '0000')
    await chmod(emptyFile, 0o600); await writeFile(emptyFile, new Uint8Array()); await chmod(emptyFile, 0o400)
    await unavailable(provider(empty).resolveSecrets(empty.binding), empty)
    const hard = await fixture(['credential-ref']); await link(path.join(hard.inputGenerationRoot, '0000'), path.join(hard.base, 'value-hardlink'))
    await unavailable(provider(hard).resolveSecrets(hard.binding), hard)
    const linked = await fixture(['credential-ref']); const linkedFile = path.join(linked.inputGenerationRoot, '0000'); const moved = path.join(linked.base, 'value-moved')
    await chmod(linked.inputGenerationRoot, 0o700); await rename(linkedFile, moved); await symlink(moved, linkedFile); await chmod(linked.inputGenerationRoot, 0o500)
    await unavailable(provider(linked).resolveSecrets(linked.binding), linked)
    const alternateGid = process.getgroups?.().find((gid) => gid !== process.getegid!())
    if (alternateGid !== undefined) {
      const wrongGid = await fixture(['credential-ref']); await chown(wrongGid.inputGenerationRoot, OWNER_UID, alternateGid)
      await unavailable(provider(wrongGid).resolveSecrets(wrongGid.binding), wrongGid)
    }
    const nonTmpfs = await fixture(['credential-ref'], os.homedir())
    expect(Number((await statfs(nonTmpfs.valueRoot)).type) >>> 0).not.toBe(0x01021994)
    await unavailable(provider(nonTmpfs).resolveSecrets(nonTmpfs.binding), nonTmpfs)
  })

  it('rejects aggregate values above 8 MiB', async () => {
    const refs = Array.from({ length: 129 }, (_value, index) => `secret-${String(index).padStart(3, '0')}`)
    const input = await fixture(refs)
    for (let index = 0; index < refs.length; index += 1) {
      const file = path.join(input.inputGenerationRoot, String(index).padStart(4, '0'))
      await chmod(file, 0o600); await writeFile(file, new Uint8Array(64 * 1024)); await chmod(file, 0o400)
    }
    await unavailable(provider(input).resolveSecrets(input.binding), input)
  })

  it('selects one immutable value generation and rejects partial rotation states', async () => {
    const input = await fixture(['credential-ref']); const source = provider(input)
    const inspected = await source.inspect(input.binding)
    await writeGeneration(input, GENERATION_B, 'next')
    expect(new TextDecoder().decode((await source.resolveSecrets(input.binding)).secrets[0]!.value)).toBe('canary:credential-ref')
    await replaceManifest(input, manifest(input.binding, 'c'.repeat(64), sha('5')))
    await unavailable(source.resolveSecrets(input.binding), input)
    const incomplete = path.join(input.inputBindingRoot, 'generations', 'd'.repeat(64)); await directory(incomplete); await chmod(incomplete, 0o500)
    await replaceManifest(input, manifest(input.binding, 'd'.repeat(64), sha('5')))
    await unavailable(source.resolveSecrets(input.binding), input)
    await replaceManifest(input, manifest(input.binding, GENERATION_B, sha('5')))
    const resolved = await source.resolveSecrets(input.binding)
    expect(new TextDecoder().decode(resolved.secrets[0]!.value)).toBe('next:credential-ref')
    expect(resolved.secrets[0]!.providerVersionFingerprint).toBe(sha('5'))
    expect(inspected.secrets[0]!.providerVersionFingerprint).toBe(sha('4'))
    expect(await readFile(path.join(input.inputGenerationRoot, '0000'), 'utf8')).toBe('canary:credential-ref')
  })
})
