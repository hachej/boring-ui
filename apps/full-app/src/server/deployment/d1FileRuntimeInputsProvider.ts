import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir, realpath, statfs, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { Sha256Digest } from '@hachej/boring-agent/shared'
import { d1Digest, D1HostError, D1HostErrorCode, strictD1Ref, type D1SiteBindingV1 } from './d1Plan.js'
import type {
  D1BindingSecretProvider,
  D1ProvidedBindingInspectionV1,
  D1ProvidedSecretV1,
  D1ResolvedBindingSecretsV1,
} from './d1SecretMaterializer.js'
export const D1_RUNTIME_INPUTS_METADATA_ROOT = '/etc/boring/d1/runtime-inputs'
export const D1_RUNTIME_INPUTS_VALUE_ROOT = '/run/boring/d1-inputs'

const DOMAIN = 'boring-d1-file-runtime-inputs:v1'
const TMPFS_MAGIC = 0x01021994
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_SECRET_BYTES = 64 * 1024
const MAX_SECRET_FILES = 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024
const VALUE_GENERATION_RE = /^[a-f0-9]{64}$/
export interface D1FileRuntimeInputsProviderOptions {
  readonly hostId: string
  readonly ownerUid: number
  /** Trusted test override. Production callers use the fixed default. */
  readonly metadataRoot?: string
  /** Trusted test override. Production callers use the fixed default. */
  readonly valueRoot?: string
  readonly fault?: (point: 'metadata-root-open' | 'metadata-binding-open' | 'value-root-open' | 'value-binding-open') => void | Promise<void>
}
interface OwnerPolicy { readonly uid: number; readonly gid: number }
interface CheckedDirectory { readonly path: string; readonly handle: FileHandle }
interface CheckedRoot extends CheckedDirectory { readonly dev: number }
interface SecretMetadata {
  readonly secretRef: string
  readonly providerVersionFingerprint: Sha256Digest
  readonly file: string
}
interface ParsedManifest {
  readonly inspection: D1ProvidedBindingInspectionV1
  readonly secrets: readonly SecretMetadata[]
  readonly valueGeneration: string
}

function unavailable(): never { throw new D1HostError(D1HostErrorCode.SECRET_UNAVAILABLE, { field: 'secret' }) }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}
function exactMode(info: Stats, policy: OwnerPolicy, mode: number): boolean {
  return info.uid === policy.uid && info.gid === policy.gid && (info.mode & 0o7777) === mode
}
async function openedDirectory(directoryPath: string, requireCanonical = false): Promise<{ readonly handle: FileHandle; readonly after: Stats }> {
  const before = await lstat(directoryPath)
  if (!before.isDirectory() || before.isSymbolicLink() || (requireCanonical && await realpath(directoryPath) !== directoryPath)) throw new Error('directory')
  const handle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const after = await handle.stat()
    if (!after.isDirectory() || !sameIdentity(before, after)) throw new Error('directory')
    return { handle, after }
  } catch (error) {
    try { await handle.close() } catch {}
    throw error
  }
}
async function checkedRoot(root: string, policy: OwnerPolicy, requireTmpfs: boolean): Promise<CheckedRoot> {
  if (!path.isAbsolute(root) || path.resolve(root) !== root) throw new Error('root')
  let current = path.parse(root).root; let handle: FileHandle | undefined
  try {
    for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      const opened = await openedDirectory(current, true)
      if (current === root) {
        if (!exactMode(opened.after, policy, 0o700)) { await opened.handle.close(); throw new Error('root policy') }
        handle = opened.handle
      } else {
        try { if (![0, policy.uid].includes(opened.after.uid) || (opened.after.mode & 0o022) !== 0) throw new Error('ancestor policy') }
        finally { await opened.handle.close() }
      }
    }
    if (!handle) throw new Error('root')
    const info = await handle.stat(); const anchored = `/proc/self/fd/${handle.fd}`
    if (!info.isDirectory() || !exactMode(info, policy, 0o700) || await realpath(anchored) !== root ||
      (requireTmpfs && (Number((await statfs(anchored)).type) >>> 0) !== TMPFS_MAGIC)) throw new Error('filesystem')
    return Object.freeze({ path: anchored, dev: info.dev, handle })
  } catch (error) { if (handle) await handle.close(); throw error }
}
async function checkedDirectory(directoryPath: string, parent: CheckedDirectory, root: CheckedRoot, policy: OwnerPolicy, mode = 0o700): Promise<CheckedDirectory> {
  if (path.dirname(directoryPath) !== parent.path) throw new Error('directory root')
  const opened = await openedDirectory(directoryPath)
  if (opened.after.dev !== root.dev || !exactMode(opened.after, policy, mode)) { await opened.handle.close(); throw new Error('directory policy') }
  return Object.freeze({ path: `/proc/self/fd/${opened.handle.fd}`, handle: opened.handle })
}
async function checkedFile(filePath: string, root: CheckedRoot, policy: OwnerPolicy, maxBytes: number): Promise<Uint8Array> {
  const before = await lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('file')
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let source: Uint8Array | undefined
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || !sameIdentity(before, initial) || initial.dev !== root.dev || !exactMode(initial, policy, 0o400) || initial.nlink !== 1 || initial.size < 1 || initial.size > maxBytes) throw new Error('file policy')
    source = await handle.readFile()
    const final = await handle.stat()
    if (!sameIdentity(initial, final) || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs || source.byteLength !== initial.size) throw new Error('file changed')
    return Uint8Array.from(source)
  } finally { source?.fill(0); await handle.close() }
}
function safeRef(value: unknown): string { return strictD1Ref(value, 'secret') }
function safeDigest(value: unknown): Sha256Digest { return d1Digest(value, 'secret') }
function linkedFingerprint(raw: unknown, expectedRef: string): Sha256Digest {
  if (!exact(raw, ['ref', 'versionFingerprint']) || safeRef(raw.ref) !== expectedRef) throw new Error('linked metadata')
  return safeDigest(raw.versionFingerprint)
}
function parseManifest(raw: unknown, hostId: string, binding: D1SiteBindingV1): ParsedManifest {
  if (!exact(raw, ['schemaVersion', 'domain', 'hostId', 'bindingId', 'environment', 'workspaceAllocation', 'sessionAllocation', 'valueGeneration', 'secrets']) ||
    raw.schemaVersion !== 1 || raw.domain !== DOMAIN || safeRef(raw.hostId) !== hostId || safeRef(raw.bindingId) !== binding.bindingId ||
    typeof raw.valueGeneration !== 'string' || !VALUE_GENERATION_RE.test(raw.valueGeneration) || !Array.isArray(raw.secrets)) throw new Error('manifest')
  const desiredRefs = binding.secretRefs.map(safeRef)
  if (desiredRefs.length > MAX_SECRET_FILES || raw.secrets.length !== desiredRefs.length || JSON.stringify(desiredRefs) !== JSON.stringify([...desiredRefs].sort()) || new Set(desiredRefs).size !== desiredRefs.length) throw new Error('secret refs')
  const secrets = raw.secrets.map((value, index) => {
    if (!exact(value, ['secretRef', 'providerVersionFingerprint', 'file'])) throw new Error('secret metadata')
    const secretRef = safeRef(value.secretRef); const file = String(index).padStart(4, '0')
    if (secretRef !== desiredRefs[index] || value.file !== file) throw new Error('secret metadata')
    return Object.freeze({ secretRef, providerVersionFingerprint: safeDigest(value.providerVersionFingerprint), file })
  })
  if (secrets.length !== desiredRefs.length) throw new Error('secret metadata')
  const inspection = Object.freeze({
    bindingId: binding.bindingId,
    environmentVersionFingerprint: linkedFingerprint(raw.environment, binding.environmentRef),
    workspaceAllocationVersionFingerprint: linkedFingerprint(raw.workspaceAllocation, binding.workspaceAllocationRef),
    sessionAllocationVersionFingerprint: linkedFingerprint(raw.sessionAllocation, binding.sessionAllocationRef),
    secrets: Object.freeze(secrets.map(({ secretRef, providerVersionFingerprint }) => Object.freeze({ secretRef, providerVersionFingerprint }))),
  })
  return Object.freeze({ inspection, secrets: Object.freeze(secrets), valueGeneration: raw.valueGeneration })
}
function safeSegment(value: string): string {
  const parsed = safeRef(value)
  if (new TextEncoder().encode(parsed).byteLength > 255) throw new Error('segment')
  return parsed
}
function sameEntries(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
}

export function createD1FileRuntimeInputsProvider(options: D1FileRuntimeInputsProviderOptions): D1BindingSecretProvider {
  let hostId: string; let policy: OwnerPolicy
  try {
    if (!Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0 || typeof process.geteuid !== 'function' || typeof process.getegid !== 'function' || process.geteuid() !== options.ownerUid) throw new Error('owner')
    hostId = safeSegment(options.hostId); policy = Object.freeze({ uid: options.ownerUid, gid: process.getegid() })
  } catch { return unavailable() }
  const metadataPath = options.metadataRoot ?? D1_RUNTIME_INPUTS_METADATA_ROOT
  const valuePath = options.valueRoot ?? D1_RUNTIME_INPUTS_VALUE_ROOT
  const loadManifest = async (binding: D1SiteBindingV1): Promise<ParsedManifest> => {
    const bindingId = safeSegment(binding.bindingId)
    const root = await checkedRoot(metadataPath, policy, false)
    try {
      await options.fault?.('metadata-root-open')
      const hostRoot = await checkedDirectory(path.join(root.path, hostId), root, root, policy)
      try {
        const bindingRoot = await checkedDirectory(path.join(hostRoot.path, bindingId), hostRoot, root, policy)
        try {
          await options.fault?.('metadata-binding-open')
          if (!sameEntries(await readdir(bindingRoot.path), ['manifest.json'])) throw new Error('metadata entries')
          const bytes = await checkedFile(path.join(bindingRoot.path, 'manifest.json'), root, policy, MAX_MANIFEST_BYTES)
          try { return parseManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, hostId, binding) }
          finally { bytes.fill(0) }
        } finally { await bindingRoot.handle.close() }
      } finally { await hostRoot.handle.close() }
    } finally { await root.handle.close() }
  }
  return Object.freeze({
    inspect: async (binding: D1SiteBindingV1) => {
      try { return (await loadManifest(binding)).inspection } catch { return unavailable() }
    },
    resolveSecrets: async (binding: D1SiteBindingV1): Promise<D1ResolvedBindingSecretsV1> => {
      const owned: Uint8Array[] = []
      try {
        const manifest = await loadManifest(binding)
        if (manifest.secrets.length === 0) return Object.freeze({ bindingId: binding.bindingId, secrets: Object.freeze([]) })
        const root = await checkedRoot(valuePath, policy, true)
        try {
          await options.fault?.('value-root-open')
          const hostRoot = await checkedDirectory(path.join(root.path, hostId), root, root, policy)
          try {
            const bindingRoot = await checkedDirectory(path.join(hostRoot.path, safeSegment(binding.bindingId)), hostRoot, root, policy)
            try {
              await options.fault?.('value-binding-open')
              if (!sameEntries(await readdir(bindingRoot.path), ['generations'])) throw new Error('value entries')
              const generationsRoot = await checkedDirectory(path.join(bindingRoot.path, 'generations'), bindingRoot, root, policy)
              try {
                const generationRoot = await checkedDirectory(path.join(generationsRoot.path, manifest.valueGeneration), generationsRoot, root, policy, 0o500)
                try {
                  if (!sameEntries(await readdir(generationRoot.path), manifest.secrets.map((secret) => secret.file))) throw new Error('value entries')
                  let total = 0; const secrets: D1ProvidedSecretV1[] = []
                  for (const metadata of manifest.secrets) {
                    const value = await checkedFile(path.join(generationRoot.path, metadata.file), root, policy, MAX_SECRET_BYTES)
                    owned.push(value); total += value.byteLength
                    if (total > MAX_TOTAL_BYTES) throw new Error('value total')
                    secrets.push(Object.freeze({ secretRef: metadata.secretRef, providerVersionFingerprint: metadata.providerVersionFingerprint, value }))
                  }
                  return Object.freeze({ bindingId: binding.bindingId, secrets: Object.freeze(secrets) })
                } finally { await generationRoot.handle.close() }
              } finally { await generationsRoot.handle.close() }
            } finally { await bindingRoot.handle.close() }
          } finally { await hostRoot.handle.close() }
        } finally { await root.handle.close() }
      } catch { for (const value of owned) value.fill(0); return unavailable() }
    },
  })
}
