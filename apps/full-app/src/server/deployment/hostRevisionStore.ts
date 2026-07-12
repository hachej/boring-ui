import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { renderD1BindingEnv, validateD1BindingEnv } from './d1BindingEnv.js'
import { assertD1ExactKeys as exactKeys, D1HostError, D1HostErrorCode, strictD1Ref } from './d1Plan.js'
import {
  canonicalizeD1ActiveEnvelope,
  canonicalizeD1AuditRecord,
  canonicalizeD1CompleteEnvelope,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  canonicalizeD1SecretRefsEnvelope,
  createD1CompleteEnvelope,
  deriveD1SecretRefsEnvelope,
  digestD1Desired,
  isD1TerminalAuditFor,
  type D1ActiveEnvelopeV1,
  type D1AuditRecordV1,
  type D1CompleteEnvelopeV1,
  type D1DesiredSnapshotV1,
  type D1ObservationV1,
  type D1SecretRefsEnvelopeV1,
} from './d1RevisionCodec.js'

export interface D1StoredCandidateV1 {
  readonly revisionId: string
  readonly desired: D1DesiredSnapshotV1
  readonly desiredStateDigest: Sha256Digest
  readonly secretRefs: D1SecretRefsEnvelopeV1
}
export interface D1StoredCompleteV1 extends D1StoredCandidateV1 {
  readonly observation: D1ObservationV1
  readonly completion: D1CompleteEnvelopeV1
}
export interface D1HostRevisionStore {
  reserveRevisionId(hostId: string): Promise<string>
  writeCandidate(hostId: string, revisionId: string, desired: D1DesiredSnapshotV1): Promise<D1StoredCandidateV1>
  readCandidate(hostId: string, revisionId: string): Promise<D1StoredCandidateV1 | null>
  writeObservation(hostId: string, revisionId: string, observation: D1ObservationV1): Promise<D1ObservationV1>
  writeComplete(hostId: string, revisionId: string): Promise<D1StoredCompleteV1>
  readComplete(hostId: string, revisionId: string): Promise<D1StoredCompleteV1 | null>
  readActive(hostId: string): Promise<D1ActiveEnvelopeV1 | null>
  publishActive(hostId: string, revisionId: string): Promise<D1ActiveEnvelopeV1>
  readAuditRecords(hostId: string): Promise<readonly D1AuditRecordV1[]>
  appendAudit(hostId: string, record: D1AuditRecordV1): Promise<void>
  hasTerminalAudit(hostId: string, active: D1ActiveEnvelopeV1): Promise<boolean>
}
export class D1ActivePublishError extends D1HostError {
  constructor(readonly committed: boolean) {
    super(D1HostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    this.name = 'D1ActivePublishError'
  }
}
export interface D1HostRevisionStoreOptions {
  readonly root: string
  readonly ownerUid: number
  readonly appGid: number
  readonly fault?: (point: 'after-active-rename') => void | Promise<void>
}

const REVISION_RE = /^r\d{10}$/
const PLAN_DOMAIN = 'boring-d1-plan:v1'
const RESOLVED_DOMAIN = 'boring-d1-resolved:v1'
const NOFOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW
interface ExactFsPolicy { readonly uid: number; readonly gid: number; readonly mode: number }

function hostId(value: string): string { return strictD1Ref(value, 'hostId') }
function revisionId(value: string): string {
  if (!REVISION_RE.test(value)) throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'revisionId' })
  return value
}
function mapped(code: D1HostErrorCode, field: string): never { throw new D1HostError(code, { field }) }
function json(content: string): unknown {
  try { return JSON.parse(content) as unknown } catch { mapped(D1HostErrorCode.PLAN_INVALID, 'json') }
}
function exactMetadata(info: Stats, policy: ExactFsPolicy, links = false): boolean {
  return info.uid === policy.uid && info.gid === policy.gid && (info.mode & 0o7777) === policy.mode && (!links || info.nlink === 1)
}
async function openDirectory(directory: string, field: string, policy: ExactFsPolicy, parent = false) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const info = await handle.stat()
  if (!info.isDirectory() || (parent ? info.uid !== policy.uid || (info.mode & 0o022) !== 0 : !exactMetadata(info, policy))) {
    await handle.close(); mapped(D1HostErrorCode.PLAN_INVALID, field)
  }
  return handle
}
async function directory(directory: string, field: string, policy: ExactFsPolicy, parent = false): Promise<void> {
  await (await openDirectory(directory, field, policy, parent)).close()
}
async function syncDirectory(directory: string, field: string, policy: ExactFsPolicy, parent = false): Promise<void> {
  const handle = await openDirectory(directory, field, policy, parent)
  try { await handle.sync() } finally { await handle.close() }
}
async function finalizeDirectory(directoryPath: string, field: string, from: ExactFsPolicy, to: ExactFsPolicy): Promise<void> {
  const handle = await openDirectory(directoryPath, field, from)
  try {
    await handle.chown(to.uid, to.gid); await handle.chmod(to.mode)
    if (!exactMetadata(await handle.stat(), to)) mapped(D1HostErrorCode.PLAN_INVALID, field)
    await handle.sync()
  } finally { await handle.close() }
}
async function ensureDirectory(directoryPath: string, parent: string, field: string, policy: ExactFsPolicy, privatePolicy: ExactFsPolicy, parentPolicy: ExactFsPolicy, trustedParent = false): Promise<void> {
  let created = false
  try { await mkdir(directoryPath, { mode: 0o700 }); created = true } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if (created) await finalizeDirectory(directoryPath, field, privatePolicy, policy)
  else await directory(directoryPath, field, policy)
  if (created) await syncDirectory(parent, trustedParent ? 'storeParent' : 'managedParent', parentPolicy, trustedParent)
}
async function readRegular(file: string, policy: ExactFsPolicy, optional = false): Promise<string | null> {
  let handle
  try { handle = await open(file, NOFOLLOW_READ) } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || !exactMetadata(info, policy, true)) throw new Error('not regular')
    return await handle.readFile('utf8')
  } finally { await handle.close() }
}
async function createDurable(file: string, content: string, policy: ExactFsPolicy): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || initial.uid !== policy.uid || initial.nlink !== 1) throw new Error('wrong owner')
    await handle.writeFile(content, 'utf8'); await handle.chown(policy.uid, policy.gid); await handle.chmod(policy.mode)
    if (!exactMetadata(await handle.stat(), policy, true)) throw new Error('wrong metadata')
    await handle.sync()
  } finally { await handle.close() }
}

/** Mutations require the caller to hold the host's external OS lock. */
export function createHostRevisionStore(options: D1HostRevisionStoreOptions): D1HostRevisionStore {
  if (!Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0) throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'ownerUid' })
  if (!Number.isSafeInteger(options.appGid) || options.appGid <= 0) throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'appGid' })
  if (typeof process.getegid !== 'function') throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field: 'ownerGid' })
  const ownerUid = options.ownerUid
  const ownerGid = process.getegid()
  const privateDirectory = Object.freeze({ uid: ownerUid, gid: ownerGid, mode: 0o700 })
  const redactedDirectory = Object.freeze({ uid: ownerUid, gid: options.appGid, mode: 0o710 })
  const privateFile = Object.freeze({ uid: ownerUid, gid: ownerGid, mode: 0o400 })
  const auditFile = Object.freeze({ uid: ownerUid, gid: ownerGid, mode: 0o600 })
  const redactedFile = Object.freeze({ uid: ownerUid, gid: options.appGid, mode: 0o440 })
  const root = path.resolve(options.root)
  const hostRoot = (host: string) => path.join(root, hostId(host))
  const revisionsRoot = (host: string) => path.join(hostRoot(host), 'revisions')
  const revisionRoot = (host: string, revision: string) => path.join(revisionsRoot(host), revisionId(revision))
  const assertMutationOwner = () => {
    if (typeof process.geteuid !== 'function' || process.geteuid() !== ownerUid) mapped(D1HostErrorCode.PLAN_INVALID, 'ownerUid')
  }
  const ensureHost = async (host: string) => {
    assertMutationOwner()
    const parent = path.dirname(root)
    await directory(parent, 'storeParent', privateDirectory, true)
    if (await realpath(parent) !== path.resolve(parent)) mapped(D1HostErrorCode.PLAN_INVALID, 'storeParent')
    await ensureDirectory(root, parent, 'storeRoot', privateDirectory, privateDirectory, privateDirectory, true)
    if (await realpath(root) !== root) mapped(D1HostErrorCode.PLAN_INVALID, 'storeRoot')
    const hostDirectory = hostRoot(host)
    await ensureDirectory(hostDirectory, root, 'hostRoot', redactedDirectory, privateDirectory, privateDirectory)
    const revisions = revisionsRoot(host)
    await ensureDirectory(revisions, hostDirectory, 'revisions', redactedDirectory, privateDirectory, redactedDirectory)
    return { hostDirectory, revisions }
  }
  const existingHost = async (host: string, includeRevisions: boolean, optional: boolean) => {
    try {
      await directory(root, 'storeRoot', privateDirectory)
      if (await realpath(root) !== root) mapped(D1HostErrorCode.PLAN_INVALID, 'storeRoot')
      await directory(hostRoot(host), 'hostRoot', redactedDirectory)
      if (includeRevisions) await directory(revisionsRoot(host), 'revisions', redactedDirectory)
      return true
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  const revisionDirectory = async (host: string, revision: string, optional = false) => {
    if (!await existingHost(host, true, optional)) return null
    const target = revisionRoot(host, revision)
    try { await directory(target, 'revision', redactedDirectory) } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    return target
  }
  const loadCandidate = async (host: string, revision: string): Promise<D1StoredCandidateV1 | null> => {
    const target = await revisionDirectory(host, revision, true)
    if (!target) return null
    const desiredRaw = json((await readRegular(path.join(target, 'desired.json'), redactedFile))!)
    const resolvedRaw = json((await readRegular(path.join(target, 'resolved.json'), redactedFile))!)
    exactKeys(desiredRaw, ['schemaVersion', 'domain', 'plan'], 'desiredFile')
    exactKeys(resolvedRaw, ['schemaVersion', 'domain', 'bindings'], 'resolvedFile')
    if (desiredRaw.schemaVersion !== 1 || desiredRaw.domain !== PLAN_DOMAIN) mapped(D1HostErrorCode.PLAN_INVALID, 'desiredFile')
    if (resolvedRaw.schemaVersion !== 1 || resolvedRaw.domain !== RESOLVED_DOMAIN) mapped(D1HostErrorCode.PLAN_INVALID, 'resolvedFile')
    const desired = await canonicalizeD1DesiredSnapshot({ schemaVersion: 1, domain: 'boring-d1-desired:v1', plan: desiredRaw.plan, resolvedBindings: resolvedRaw.bindings })
    if (desired.plan.hostId !== hostId(host)) mapped(D1HostErrorCode.PLAN_INVALID, 'desired.plan.hostId')
    const bindingsDirectory = path.join(target, 'bindings')
    await directory(bindingsDirectory, 'bindings', redactedDirectory)
    const expectedBindingFiles = desired.plan.bindings.map((binding) => `${binding.bindingId}.env`).sort()
    const actualBindingFiles = (await readdir(bindingsDirectory)).sort()
    if (JSON.stringify(actualBindingFiles) !== JSON.stringify(expectedBindingFiles)) mapped(D1HostErrorCode.PLAN_INVALID, 'bindings')
    for (const binding of desired.plan.bindings) {
      const content = await readRegular(path.join(bindingsDirectory, `${binding.bindingId}.env`), redactedFile)
      validateD1BindingEnv(content!, binding)
    }
    const secretRefs = canonicalizeD1SecretRefsEnvelope(json((await readRegular(path.join(target, 'secret-refs.json'), redactedFile))!), desired)
    const desiredStateDigest = await digestD1Desired(desired)
    if ((await readRegular(path.join(target, 'desired.sha256'), redactedFile))!.trim() !== desiredStateDigest) mapped(D1HostErrorCode.PLAN_INVALID, 'desiredDigest')
    return Object.freeze({ revisionId: revision, desired, desiredStateDigest, secretRefs })
  }
  const loadComplete = async (host: string, revision: string): Promise<D1StoredCompleteV1 | null> => {
    const target = await revisionDirectory(host, revision, true)
    if (!target) return null
    const rawCompletion = await readRegular(path.join(target, 'completion.json'), redactedFile, true)
    if (rawCompletion === null) return null
    const candidate = await loadCandidate(host, revision)
    if (!candidate) mapped(D1HostErrorCode.PLAN_INVALID, 'candidate')
    const observation = await canonicalizeD1Observation(json((await readRegular(path.join(target, 'observed.json'), redactedFile))!), candidate.desired)
    const completion = await canonicalizeD1CompleteEnvelope(json(rawCompletion), candidate.desired, observation)
    return Object.freeze({ ...candidate, observation, completion })
  }
  const loadActive = async (host: string): Promise<D1ActiveEnvelopeV1 | null> => {
    if (!await existingHost(host, false, true)) return null
    const raw = await readRegular(path.join(hostRoot(host), 'active'), redactedFile, true)
    if (raw === null) return null
    const active = canonicalizeD1ActiveEnvelope(json(raw))
    const complete = await loadComplete(host, active.revisionId)
    if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) mapped(D1HostErrorCode.PLAN_INVALID, 'active')
    return active
  }
  const auditRecords = async (host: string, repair: boolean) => {
    if (!repair && !await existingHost(host, false, true)) return Object.freeze([]) as readonly D1AuditRecordV1[]
    const hostDirectory = repair ? (await ensureHost(host)).hostDirectory : hostRoot(host)
    const file = path.join(hostDirectory, 'audit.jsonl')
    const content = await readRegular(file, auditFile, true)
    if (content === null || content === '') return Object.freeze([]) as readonly D1AuditRecordV1[]
    let durable = content
    if (!content.endsWith('\n')) {
      const newline = content.lastIndexOf('\n')
      durable = newline < 0 ? '' : content.slice(0, newline + 1)
    }
    const records = Object.freeze(durable.split('\n').filter(Boolean).map((line) => canonicalizeD1AuditRecord(json(line))))
    if (repair && durable !== content) {
      const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW)
      try {
        const info = await handle.stat()
        if (!info.isFile() || !exactMetadata(info, auditFile, true)) throw new Error('wrong audit owner')
        await handle.truncate(new TextEncoder().encode(durable).byteLength); await handle.sync()
      } finally { await handle.close() }
      await syncDirectory(hostDirectory, 'hostRoot', redactedDirectory)
    }
    return records
  }
  return {
    async reserveRevisionId(host) {
      hostId(host)
      try {
        const { hostDirectory } = await ensureHost(host)
        const sequence = path.join(hostDirectory, 'sequence')
        const raw = await readRegular(sequence, privateFile, true)
        const current = raw === null ? 0 : Number(raw.trim())
        if (!Number.isSafeInteger(current) || current < 0 || current >= 9_999_999_999 || (raw !== null && raw.trim() !== String(current))) mapped(D1HostErrorCode.REVISION_CONFLICT, 'sequence')
        const next = current + 1
        const temporary = path.join(hostDirectory, `.sequence.${randomUUID()}`)
        await createDurable(temporary, `${next}\n`, privateFile)
        await rename(temporary, sequence)
        await syncDirectory(hostDirectory, 'hostRoot', redactedDirectory)
        return `r${String(next).padStart(10, '0')}`
      } catch { mapped(D1HostErrorCode.REVISION_CONFLICT, 'sequence') }
    },
    async writeCandidate(host, revision, rawDesired) {
      const desired = await canonicalizeD1DesiredSnapshot(rawDesired)
      if (desired.plan.hostId !== hostId(host)) mapped(D1HostErrorCode.PLAN_INVALID, 'desired.plan.hostId')
      try {
        const { hostDirectory, revisions } = await ensureHost(host)
        if ((await readRegular(path.join(hostDirectory, 'sequence'), privateFile))!.trim() !== String(Number(revisionId(revision).slice(1)))) mapped(D1HostErrorCode.REVISION_CONFLICT, 'revisionId')
        const target = revisionRoot(host, revision)
        try { await lstat(target); mapped(D1HostErrorCode.REVISION_CONFLICT, 'revisionId') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const temporary = path.join(revisions, `.${revision}.${randomUUID()}`)
        await mkdir(temporary, { mode: 0o700 })
        await directory(temporary, 'candidate', privateDirectory)
        const desiredStateDigest = await digestD1Desired(desired)
        const secretRefs = deriveD1SecretRefsEnvelope(desired)
        await createDurable(path.join(temporary, 'desired.json'), JSON.stringify({ schemaVersion: 1, domain: PLAN_DOMAIN, plan: desired.plan }), redactedFile)
        await createDurable(path.join(temporary, 'resolved.json'), JSON.stringify({ schemaVersion: 1, domain: RESOLVED_DOMAIN, bindings: desired.resolvedBindings }), redactedFile)
        await createDurable(path.join(temporary, 'secret-refs.json'), JSON.stringify(secretRefs), redactedFile)
        await createDurable(path.join(temporary, 'desired.sha256'), `${desiredStateDigest}\n`, redactedFile)
        const bindingsDirectory = path.join(temporary, 'bindings')
        await mkdir(bindingsDirectory, { mode: 0o700 })
        await directory(bindingsDirectory, 'bindings', privateDirectory)
        for (const binding of desired.plan.bindings) {
          await createDurable(path.join(bindingsDirectory, `${binding.bindingId}.env`), renderD1BindingEnv(binding), redactedFile)
        }
        await syncDirectory(bindingsDirectory, 'bindings', privateDirectory)
        await finalizeDirectory(bindingsDirectory, 'bindings', privateDirectory, redactedDirectory)
        await syncDirectory(temporary, 'candidate', privateDirectory)
        await finalizeDirectory(temporary, 'candidate', privateDirectory, redactedDirectory)
        await rename(temporary, target)
        await syncDirectory(revisions, 'revisions', redactedDirectory)
        return Object.freeze({ revisionId: revision, desired, desiredStateDigest, secretRefs })
      } catch (error) {
        if (error instanceof D1HostError) throw error
        mapped(D1HostErrorCode.REVISION_CONFLICT, 'candidate')
      }
    },
    async readCandidate(host, revision) {
      hostId(host); revisionId(revision)
      try { return await loadCandidate(host, revision) } catch { mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
    },
    async writeObservation(host, revision, rawObservation) {
      hostId(host); revisionId(revision)
      assertMutationOwner()
      let candidate
      try { candidate = await loadCandidate(host, revision) } catch { mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
      if (!candidate) mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision')
      const observation = await canonicalizeD1Observation(rawObservation, candidate.desired)
      try {
        const target = revisionRoot(host, revision)
        await createDurable(path.join(target, 'observed.json'), JSON.stringify(observation), redactedFile)
        await syncDirectory(target, 'revision', redactedDirectory)
        return observation
      } catch { mapped(D1HostErrorCode.COLLECTION_NOT_READY, 'observation') }
    },
    async writeComplete(host, revision) {
      hostId(host); revisionId(revision)
      assertMutationOwner()
      let candidate
      try { candidate = await loadCandidate(host, revision) } catch { mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
      if (!candidate) mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision')
      try {
        const target = revisionRoot(host, revision)
        const observation = await canonicalizeD1Observation(json((await readRegular(path.join(target, 'observed.json'), redactedFile))!), candidate.desired)
        const completion = await createD1CompleteEnvelope(revision, candidate.desired, observation)
        await createDurable(path.join(target, 'completion.json'), JSON.stringify(completion), redactedFile)
        await syncDirectory(target, 'revision', redactedDirectory)
        return Object.freeze({ ...candidate, observation, completion })
      } catch (error) {
        if (error instanceof D1HostError && error.details.field === 'completion.observation.ready') throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'observation' })
        mapped(D1HostErrorCode.COLLECTION_NOT_READY, 'completion')
      }
    },
    async readComplete(host, revision) {
      hostId(host); revisionId(revision)
      try { return await loadComplete(host, revision) } catch { mapped(D1HostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
    },
    async readActive(host) {
      hostId(host)
      try { return await loadActive(host) } catch { mapped(D1HostErrorCode.PUBLICATION_FAILED, 'active') }
    },
    async publishActive(host, revision) {
      hostId(host); revisionId(revision)
      let committed = false
      try {
        const complete = await loadComplete(host, revision)
        if (!complete) throw new Error('incomplete')
        const active = canonicalizeD1ActiveEnvelope({ schemaVersion: 1, revisionId: revision, desiredStateDigest: complete.desiredStateDigest })
        const { hostDirectory } = await ensureHost(host)
        const current = await loadActive(host)
        if (current) {
          if (current.revisionId === active.revisionId && current.desiredStateDigest === active.desiredStateDigest) return current
          if (Number(active.revisionId.slice(1)) <= Number(current.revisionId.slice(1))) throw new Error('non-monotonic')
        }
        const temporary = path.join(hostDirectory, `.active.${randomUUID()}`)
        await createDurable(temporary, JSON.stringify(active), redactedFile)
        await rename(temporary, path.join(hostDirectory, 'active'))
        committed = true
        await options.fault?.('after-active-rename')
        await syncDirectory(hostDirectory, 'hostRoot', redactedDirectory)
        if (JSON.stringify(await loadActive(host)) !== JSON.stringify(active)) throw new Error('verification')
        return active
      } catch { throw new D1ActivePublishError(committed) }
    },
    async readAuditRecords(host) {
      hostId(host)
      try { return await auditRecords(host, false) } catch { mapped(D1HostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
    async appendAudit(host, rawRecord) {
      hostId(host)
      const record = canonicalizeD1AuditRecord(rawRecord)
      try {
        if ('completionDigest' in record) {
          const complete = await loadComplete(host, record.revisionId)
          if (!complete || complete.desiredStateDigest !== record.desiredStateDigest || complete.completion.completionDigest !== record.completionDigest) throw new Error('completion mismatch')
        }
        if (record.outcome === 'COMPLETE' || record.outcome === 'RECOVERY_REQUIRED') {
          const active = await loadActive(host)
          if (!active || active.revisionId !== record.revisionId || active.desiredStateDigest !== record.desiredStateDigest) throw new Error('active mismatch')
        }
        const { hostDirectory } = await ensureHost(host)
        await auditRecords(host, true)
        const file = path.join(hostDirectory, 'audit.jsonl')
        const existed = await readRegular(file, auditFile, true) !== null
        const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
        try {
          const info = await handle.stat()
          if (!info.isFile() || !exactMetadata(info, auditFile, true)) throw new Error('wrong audit owner')
          await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync()
        } finally { await handle.close() }
        if (!existed) await syncDirectory(hostDirectory, 'hostRoot', redactedDirectory)
      } catch { mapped(D1HostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
    async hasTerminalAudit(host, rawActive) {
      hostId(host)
      const supplied = canonicalizeD1ActiveEnvelope(rawActive)
      try {
        const active = await loadActive(host)
        if (!active || active.revisionId !== supplied.revisionId || active.desiredStateDigest !== supplied.desiredStateDigest) return false
        const complete = await loadComplete(host, active.revisionId)
        if (!complete) mapped(D1HostErrorCode.PUBLICATION_FAILED, 'audit')
        return (await auditRecords(host, false)).some((record) => isD1TerminalAuditFor(record, active, complete.completion))
      } catch { mapped(D1HostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
  }
}
