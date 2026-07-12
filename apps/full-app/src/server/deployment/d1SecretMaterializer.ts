import { randomUUID, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, statfs, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { D1ApplyEffects, D1RuntimeInputsInspectionV1 } from './d1Command.js'
import { d1Digest, D1HostError, D1HostErrorCode, strictD1Ref, type D1SiteBindingV1 } from './d1Plan.js'
import { canonicalizeD1DesiredSnapshot, canonicalizeD1SecretRefsEnvelope, digestD1Desired, type D1DesiredSnapshotV1 } from './d1RevisionCodec.js'
import { canonicalizeD1RuntimeInputsIdentity, createD1RuntimeInputsIdentity, type D1RuntimeInputsAttestationV1, type D1RuntimeInputsIdentityV1 } from './d1RuntimeInputs.js'
import type { D1StoredCandidateV1 } from './hostRevisionStore.js'

const TMPFS_MAGIC = 0x01021994
const MAX_SECRET_BYTES = 64 * 1024
const MAX_SECRET_FILES = 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const REVISION_RE = /^r\d{10}$/

export interface D1ProvidedSecretV1 {
  readonly secretRef: string
  readonly providerVersionFingerprint: Sha256Digest
  /** Ownership transfers to the materializer. The provider must return a fresh mutable buffer. */
  readonly value: Uint8Array
}
export interface D1ProvidedSecretMetadataV1 {
  readonly secretRef: string
  readonly providerVersionFingerprint: Sha256Digest
}
export interface D1ProvidedBindingInspectionV1 {
  readonly bindingId: string
  readonly environmentVersionFingerprint: Sha256Digest
  readonly workspaceAllocationVersionFingerprint: Sha256Digest
  readonly sessionAllocationVersionFingerprint: Sha256Digest
  readonly secrets: readonly D1ProvidedSecretMetadataV1[]
}
export interface D1ResolvedBindingSecretsV1 {
  readonly bindingId: string
  readonly secrets: readonly D1ProvidedSecretV1[]
}
export interface D1BindingSecretProvider {
  /** Metadata-only: implementations must not fetch or expose secret values. */
  inspect(binding: D1SiteBindingV1): Promise<D1ProvidedBindingInspectionV1>
  /** Value-bearing: ownership of every returned buffer transfers to the caller. */
  resolveSecrets(binding: D1SiteBindingV1): Promise<D1ResolvedBindingSecretsV1>
}
export interface D1SecretMaterializerOptions {
  readonly root: string
  readonly ownerUid: number
  readonly appUid: number
  readonly appGid: number
  readonly provider: D1BindingSecretProvider
  readonly fault?: (point: 'before-final-rename' | 'after-final-rename') => void | Promise<void>
}

interface FsPolicy { readonly uid: number; readonly gid: number; readonly mode: number; readonly device?: number }
interface InspectedBinding { readonly inspection: D1RuntimeInputsInspectionV1; readonly identity: D1RuntimeInputsIdentityV1 }
interface OwnedSecret { readonly ref: string; readonly fingerprint: Sha256Digest; readonly bytes: Uint8Array }
interface ResolvedBinding {
  readonly binding: D1SiteBindingV1
  readonly identity: D1RuntimeInputsIdentityV1
  readonly inspection: D1RuntimeInputsInspectionV1
  readonly secrets: readonly OwnedSecret[]
}

function fail(code: D1HostErrorCode, field: string): never { throw new D1HostError(code, { field }) }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
  })
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }
function zero(value: unknown): void { if (value instanceof Uint8Array) try { Uint8Array.prototype.fill.call(value, 0) } catch {} }
function metadata(info: Stats, policy: FsPolicy, links = false): boolean {
  return info.uid === policy.uid && info.gid === policy.gid && (info.mode & 0o7777) === policy.mode &&
    (policy.device === undefined || info.dev === policy.device) && (!links || info.nlink === 1)
}
async function directory(directoryPath: string, policy: FsPolicy, ancestor = false): Promise<FileHandle> {
  const handle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const info = await handle.stat()
  const valid = info.isDirectory() && (ancestor
    ? (info.uid === 0 || info.uid === policy.uid) && (info.mode & 0o022) === 0
    : metadata(info, policy))
  if (!valid) { await handle.close(); throw new Error('directory policy') }
  return handle
}
async function syncDirectory(directoryPath: string, policy: FsPolicy): Promise<void> {
  const handle = await directory(directoryPath, policy)
  try { await handle.sync() } finally { await handle.close() }
}
async function finalizeDirectory(directoryPath: string, from: FsPolicy, to: FsPolicy): Promise<void> {
  const handle = await directory(directoryPath, from)
  try {
    await handle.chown(to.uid, to.gid); await handle.chmod(to.mode)
    if (!metadata(await handle.stat(), to)) throw new Error('directory metadata')
    await handle.sync()
  } finally { await handle.close() }
}
async function ensureDirectory(
  directoryPath: string,
  parent: string,
  privatePolicy: FsPolicy,
  finalPolicy: FsPolicy,
  parentPolicy: FsPolicy,
  parentHandle?: FileHandle,
): Promise<void> {
  let created = false
  try { await mkdir(directoryPath, { mode: privatePolicy.mode }); created = true } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if (created) {
    await finalizeDirectory(directoryPath, privatePolicy, finalPolicy)
    if (parentHandle) await parentHandle.sync()
    else await syncDirectory(parent, parentPolicy)
  } else await (await directory(directoryPath, finalPolicy)).close()
}
async function createFile(filePath: string, bytes: Uint8Array, policy: FsPolicy): Promise<void> {
  const handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || initial.nlink !== 1) throw new Error('file type')
    await handle.writeFile(bytes); await handle.chown(policy.uid, policy.gid); await handle.chmod(policy.mode)
    const final = await handle.stat()
    if (!final.isFile() || !metadata(final, policy, true) || final.size !== bytes.byteLength) throw new Error('file metadata')
    await handle.sync()
  } finally { await handle.close() }
}
async function readFile(filePath: string, policy: FsPolicy, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || !metadata(info, policy, true) || info.size > maxBytes) throw new Error('file policy')
    return await handle.readFile()
  } finally { await handle.close() }
}

async function validateRoot(root: string, ownerUid: number, privatePolicy: FsPolicy): Promise<FileHandle> {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || await realpath(root) !== root) throw new Error('runtime root')
  let current = path.parse(root).root
  for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const handle = await directory(current, privatePolicy, current !== root)
    await handle.close()
  }
  if ((Number((await statfs(root)).type) >>> 0) !== TMPFS_MAGIC || ownerUid !== privatePolicy.uid) throw new Error('runtime filesystem')
  const handle = await directory(root, privatePolicy)
  try {
    if (await realpath(`/proc/self/fd/${handle.fd}`) !== root) throw new Error('runtime root changed')
    return handle
  } catch (error) { await handle.close(); throw error }
}

function providerFailure(error: unknown): never {
  if (error instanceof D1HostError && (
    error.code === D1HostErrorCode.SECRET_UNAVAILABLE ||
    error.code === D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED ||
    error.code === D1HostErrorCode.COLLECTION_NOT_READY
  )) throw error
  fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
}
async function inspectBinding(binding: D1SiteBindingV1, provider: D1BindingSecretProvider): Promise<InspectedBinding> {
  let raw: unknown
  try { raw = await provider.inspect(binding) } catch { fail(D1HostErrorCode.SECRET_UNAVAILABLE, 'secret') }
  try {
    if (!exact(raw, ['bindingId', 'environmentVersionFingerprint', 'workspaceAllocationVersionFingerprint', 'sessionAllocationVersionFingerprint', 'secrets']) || !Array.isArray(raw.secrets) || raw.secrets.length > MAX_SECRET_FILES) {
      fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    }
    const bindingId = strictD1Ref(raw.bindingId, 'provider.bindingId')
    const secrets = raw.secrets.map((value) => {
      if (!exact(value, ['secretRef', 'providerVersionFingerprint'])) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      return Object.freeze({
        secretRef: strictD1Ref(value.secretRef, 'provider.secretRef'),
        providerVersionFingerprint: d1Digest(value.providerVersionFingerprint, 'provider.providerVersionFingerprint'),
      })
    }).sort((left, right) => left.secretRef < right.secretRef ? -1 : left.secretRef > right.secretRef ? 1 : 0)
    if (new Set(secrets.map((secret) => secret.secretRef)).size !== secrets.length) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    const actualRefs = secrets.map((secret) => secret.secretRef)
    if (binding.secretRefs.some((ref) => !actualRefs.includes(ref))) fail(D1HostErrorCode.SECRET_UNAVAILABLE, 'secret')
    if (!same(actualRefs, binding.secretRefs) || bindingId !== binding.bindingId) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    const attestation: D1RuntimeInputsAttestationV1 = Object.freeze({
      environment: Object.freeze({ versionFingerprint: d1Digest(raw.environmentVersionFingerprint, 'provider.environmentVersionFingerprint') }),
      workspaceAllocation: Object.freeze({ versionFingerprint: d1Digest(raw.workspaceAllocationVersionFingerprint, 'provider.workspaceAllocationVersionFingerprint') }),
      sessionAllocation: Object.freeze({ versionFingerprint: d1Digest(raw.sessionAllocationVersionFingerprint, 'provider.sessionAllocationVersionFingerprint') }),
      secrets: Object.freeze(secrets),
    })
    return Object.freeze({
      inspection: Object.freeze({ bindingId, attestation }),
      identity: await createD1RuntimeInputsIdentity(binding, attestation),
    })
  } catch (error) { return providerFailure(error) }
}

export function createD1RuntimeInputsInspector(provider: D1BindingSecretProvider) {
  return async (desired: D1DesiredSnapshotV1): Promise<readonly D1RuntimeInputsInspectionV1[]> => Object.freeze(
    await Promise.all(desired.plan.bindings.map(async (binding) => (await inspectBinding(binding, provider)).inspection)),
  )
}

async function resolveBinding(
  binding: D1SiteBindingV1,
  inspected: InspectedBinding,
  provider: D1BindingSecretProvider,
  owned: Uint8Array[],
  totals: { files: number; bytes: number },
  seenBuffers: Set<ArrayBuffer>,
): Promise<ResolvedBinding> {
  let raw: unknown
  try { raw = await provider.resolveSecrets(binding) } catch { fail(D1HostErrorCode.SECRET_UNAVAILABLE, 'secret') }
  const transferred: Uint8Array[] = []
  try {
    if (!isRecord(raw)) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    const secretsDescriptor = Object.getOwnPropertyDescriptor(raw, 'secrets')
    const rawSecrets = secretsDescriptor && Object.hasOwn(secretsDescriptor, 'value') && Array.isArray(secretsDescriptor.value) ? secretsDescriptor.value : []
    for (const value of rawSecrets) {
      if (!isRecord(value)) continue
      const descriptor = Object.getOwnPropertyDescriptor(value, 'value')
      if (descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value instanceof Uint8Array) transferred.push(descriptor.value)
    }
    if (!exact(raw, ['bindingId', 'secrets']) || !Array.isArray(raw.secrets) || raw.secrets.length > MAX_SECRET_FILES) {
      fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    }
    const bindingId = strictD1Ref(raw.bindingId, 'provider.bindingId')
    const captured = raw.secrets.map((value) => {
      if (!isRecord(value)) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      const descriptor = Object.getOwnPropertyDescriptor(value, 'value')
      const bytes = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
      if (!exact(value, ['secretRef', 'providerVersionFingerprint', 'value'])) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer ||
        bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength ||
        bytes.byteLength === 0 || bytes.byteLength > MAX_SECRET_BYTES || seenBuffers.has(bytes.buffer)) {
        fail(D1HostErrorCode.SECRET_UNAVAILABLE, 'secret')
      }
      seenBuffers.add(bytes.buffer)
      return { value, bytes }
    })
    const secrets: OwnedSecret[] = captured.map(({ value, bytes: source }) => {
      const secretRef = strictD1Ref(value.secretRef, 'provider.secretRef')
      const fingerprint = d1Digest(value.providerVersionFingerprint, 'provider.providerVersionFingerprint')
      const bytes = Uint8Array.from(source); zero(source); owned.push(bytes)
      totals.files += 1; totals.bytes += bytes.byteLength
      if (totals.files > MAX_SECRET_FILES || totals.bytes > MAX_TOTAL_BYTES) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      return { ref: secretRef, fingerprint, bytes }
    }).sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0)
    if (new Set(secrets.map((secret) => secret.ref)).size !== secrets.length) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    const actualRefs = secrets.map((secret) => secret.ref)
    if (binding.secretRefs.some((ref) => !actualRefs.includes(ref))) fail(D1HostErrorCode.SECRET_UNAVAILABLE, 'secret')
    if (!same(actualRefs, binding.secretRefs) || bindingId !== binding.bindingId) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
    const metadata = secrets.map((secret) => ({ secretRef: secret.ref, providerVersionFingerprint: secret.fingerprint }))
    if (!same(metadata, inspected.inspection.attestation.secrets)) fail(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'runtimeInputs')
    return Object.freeze({ binding, identity: inspected.identity, inspection: inspected.inspection, secrets: Object.freeze(secrets) })
  } catch (error) { return providerFailure(error) }
  finally { for (const value of transferred) zero(value) }
}

function manifest(candidate: D1StoredCandidateV1, resolved: readonly ResolvedBinding[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    domain: 'boring-d1-binding-secrets:v1',
    hostId: candidate.desired.plan.hostId,
    revisionId: candidate.revisionId,
    desiredStateDigest: candidate.desiredStateDigest,
    bindings: resolved.map((entry) => ({
      bindingId: entry.binding.bindingId,
      runtimeInputsDigest: entry.identity.digest,
      secrets: entry.secrets.map((secret, index) => ({
        secretRef: secret.ref,
        providerVersionFingerprint: secret.fingerprint,
        file: `bindings/${entry.binding.bindingId}/${String(index).padStart(4, '0')}`,
      })),
    })),
  })
}

async function verifyTree(root: string, manifestBytes: Uint8Array, resolved: readonly ResolvedBinding[], policies: { publicDirectory: FsPolicy; redactedFile: FsPolicy; secretFile: FsPolicy }): Promise<void> {
  const rootHandle = await directory(root, policies.publicDirectory); const anchoredRoot = `/proc/self/fd/${rootHandle.fd}`
  try {
    const entries = (await readdir(anchoredRoot)).sort()
    if (!same(entries, ['bindings', 'manifest.json'])) throw new Error('revision entries')
    const actualManifest = await readFile(path.join(anchoredRoot, 'manifest.json'), policies.redactedFile, manifestBytes.byteLength)
    try { if (!timingSafeEqual(actualManifest, manifestBytes)) throw new Error('manifest mismatch') } finally { zero(actualManifest) }
    const bindingsRoot = path.join(anchoredRoot, 'bindings')
    await (await directory(bindingsRoot, policies.publicDirectory)).close()
    if (!same((await readdir(bindingsRoot)).sort(), resolved.map((entry) => entry.binding.bindingId))) throw new Error('binding entries')
    for (const entry of resolved) {
      const bindingRoot = path.join(bindingsRoot, entry.binding.bindingId)
      await (await directory(bindingRoot, policies.publicDirectory)).close()
      const names = entry.secrets.map((_secret, index) => String(index).padStart(4, '0'))
      if (!same((await readdir(bindingRoot)).sort(), names)) throw new Error('secret entries')
      for (const [index, secret] of entry.secrets.entries()) {
        const actual = await readFile(path.join(bindingRoot, names[index]!), policies.secretFile, MAX_SECRET_BYTES)
        try { if (actual.byteLength !== secret.bytes.byteLength || !timingSafeEqual(actual, secret.bytes)) throw new Error('secret mismatch') } finally { zero(actual) }
      }
    }
  } finally { await rootHandle.close() }
}
/** Linux/coreutils no-clobber publication; both paths remain anchored through the inherited root fd. */
async function publishNoReplace(source: string, target: string, rootFd: number): Promise<void> {
  const stdio = Array<'ignore' | number>(rootFd + 1).fill('ignore'); stdio[rootFd] = rootFd
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/mv', ['-n', '-T', '--', source, target], { shell: false, stdio })
    child.once('error', reject); child.once('close', () => resolve())
  })
}

export function createD1BindingSecretMaterializer(options: D1SecretMaterializerOptions): D1ApplyEffects['materialize'] {
  if (![options.ownerUid, options.appUid, options.appGid].every((value) => Number.isSafeInteger(value) && value >= 0) || options.appUid === 0 || options.appGid === 0 || typeof process.getegid !== 'function') {
    fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
  }
  const root = options.root
  const privateDirectory = Object.freeze({ uid: options.ownerUid, gid: process.getegid(), mode: 0o700 })
  const publicDirectory = Object.freeze({ uid: options.ownerUid, gid: options.appGid, mode: 0o710 })
  const redactedFile = Object.freeze({ uid: options.ownerUid, gid: options.appGid, mode: 0o440 })
  const secretFile = Object.freeze({ uid: options.appUid, gid: options.appGid, mode: 0o400 })

  return async (candidate, rawExpected) => {
    const owned: Uint8Array[] = []
    let rootHandle: FileHandle | undefined
    try {
      if (!REVISION_RE.test(candidate.revisionId)) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      const desired = await canonicalizeD1DesiredSnapshot(candidate.desired)
      if (await digestD1Desired(desired) !== candidate.desiredStateDigest || !same(canonicalizeD1SecretRefsEnvelope(candidate.secretRefs, desired), candidate.secretRefs)) {
        fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      }
      const expected = await Promise.all(rawExpected.map((value) => {
        const binding = desired.plan.bindings.find((entry) => entry.bindingId === value.bindingId)
        if (!binding) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
        return canonicalizeD1RuntimeInputsIdentity(value, binding)
      }))
      expected.sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
      if (!same(expected.map((value) => value.bindingId), desired.plan.bindings.map((binding) => binding.bindingId))) fail(D1HostErrorCode.COLLECTION_NOT_READY, 'materialize')
      rootHandle = await validateRoot(root, options.ownerUid, privateDirectory)
      const anchoredRoot = `/proc/self/fd/${rootHandle.fd}`
      const device = (await rootHandle.stat()).dev
      const fsPrivate = { ...privateDirectory, device }; const fsPublic = { ...publicDirectory, device }
      const fsRedacted = { ...redactedFile, device }; const fsSecret = { ...secretFile, device }
      const inspected = await Promise.all(desired.plan.bindings.map((binding) => inspectBinding(binding, options.provider)))
      if (!same(inspected.map((entry) => entry.identity), expected)) fail(D1HostErrorCode.ACTIVE_BINDING_RESTART_REQUIRED, 'runtimeInputs')
      const totals = { files: 0, bytes: 0 }; const seenBuffers = new Set<ArrayBuffer>(); const resolved: ResolvedBinding[] = []
      for (const [index, binding] of desired.plan.bindings.entries()) {
        resolved.push(await resolveBinding(binding, inspected[index]!, options.provider, owned, totals, seenBuffers))
      }
      const encodedManifest = new TextEncoder().encode(manifest(candidate, resolved))

      const hostRoot = path.join(anchoredRoot, desired.plan.hostId)
      await ensureDirectory(hostRoot, anchoredRoot, fsPrivate, fsPublic, fsPrivate, rootHandle)
      const revisionsRoot = path.join(hostRoot, 'revisions')
      await ensureDirectory(revisionsRoot, hostRoot, fsPrivate, fsPublic, fsPublic)
      const target = path.join(revisionsRoot, candidate.revisionId)
      try {
        await lstat(target)
        await verifyTree(target, encodedManifest, resolved, { publicDirectory: fsPublic, redactedFile: fsRedacted, secretFile: fsSecret })
        return Object.freeze(resolved.map((entry) => entry.inspection))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') providerFailure(error)
      }
      const stage = path.join(anchoredRoot, `.${candidate.revisionId}.${randomUUID()}`)
      await mkdir(stage, { mode: 0o700 }); await (await directory(stage, fsPrivate)).close(); await rootHandle.sync()
      const bindingsRoot = path.join(stage, 'bindings')
      await mkdir(bindingsRoot, { mode: 0o700 }); await (await directory(bindingsRoot, fsPrivate)).close()
      for (const entry of resolved) {
        const bindingRoot = path.join(bindingsRoot, entry.binding.bindingId)
        await mkdir(bindingRoot, { mode: 0o700 }); await (await directory(bindingRoot, fsPrivate)).close()
        for (const [index, secret] of entry.secrets.entries()) await createFile(path.join(bindingRoot, String(index).padStart(4, '0')), secret.bytes, fsSecret)
        await syncDirectory(bindingRoot, fsPrivate); await finalizeDirectory(bindingRoot, fsPrivate, fsPublic)
      }
      await syncDirectory(bindingsRoot, fsPrivate); await finalizeDirectory(bindingsRoot, fsPrivate, fsPublic)
      await createFile(path.join(stage, 'manifest.json'), encodedManifest, fsRedacted)
      await syncDirectory(stage, fsPrivate); await finalizeDirectory(stage, fsPrivate, fsPublic)
      await verifyTree(stage, encodedManifest, resolved, { publicDirectory: fsPublic, redactedFile: fsRedacted, secretFile: fsSecret })
      await options.fault?.('before-final-rename')
      await publishNoReplace(stage, target, rootHandle.fd)
      let stagePresent = true
      try { await lstat(stage) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        stagePresent = false
      }
      if (!stagePresent) {
        await rootHandle.sync(); await syncDirectory(revisionsRoot, fsPublic)
        await options.fault?.('after-final-rename')
      }
      await verifyTree(target, encodedManifest, resolved, { publicDirectory: fsPublic, redactedFile: fsRedacted, secretFile: fsSecret })
      return Object.freeze(resolved.map((entry) => entry.inspection))
    } catch (error) { return providerFailure(error) }
    finally {
      for (const bytes of owned) zero(bytes)
      if (rootHandle) try { await rootHandle.close() } catch {}
    }
  }
}
