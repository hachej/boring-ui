import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { renderAgentHostBindingEnv, validateAgentHostBindingEnv } from './agentHostBindingEnv.js'
import { canonicalizeAgentHostAgentArtifactEnvelope, validateAgentHostAgentArtifact, type AgentHostAgentArtifactEnvelopeV1, type AgentHostLoadedAgentArtifact } from './agentHostAgentArtifactSnapshot.js'
import { assertAgentHostExactKeys as exactKeys, AgentHostError, AgentHostErrorCode, strictAgentHostId, strictAgentHostRef } from './agentHostPlan.js'
import {
  canonicalizeAgentHostActiveEnvelope,
  canonicalizeAgentHostAuditRecord,
  canonicalizeAgentHostCompleteEnvelope,
  canonicalizeAgentHostDesiredSnapshot,
  canonicalizeAgentHostObservation,
  canonicalizeAgentHostSecretRefsEnvelope,
  createAgentHostCompleteEnvelope,
  deriveAgentHostSecretRefsEnvelope,
  digestAgentHostDesired,
  isAgentHostTerminalAuditFor,
  type AgentHostActiveEnvelopeV1,
  type AgentHostAuditRecordV1,
  type AgentHostCompleteEnvelopeV1,
  type AgentHostDesiredSnapshotV1,
  type AgentHostObservationV1,
  type AgentHostSecretRefsEnvelopeV1,
} from './agentHostRevisionCodec.js'

export interface AgentHostStoredCandidateV1 {
  readonly revisionId: string
  readonly desired: AgentHostDesiredSnapshotV1
  readonly desiredStateDigest: Sha256Digest
  readonly secretRefs: AgentHostSecretRefsEnvelopeV1
}
export interface AgentHostStoredCompleteV1 extends AgentHostStoredCandidateV1 {
  readonly observation: AgentHostObservationV1
  readonly completion: AgentHostCompleteEnvelopeV1
}
export interface AgentHostRevisionStore {
  reserveRevisionId(hostId: string): Promise<string>
  writeCandidate(hostId: string, revisionId: string, desired: AgentHostDesiredSnapshotV1, agentArtifacts: readonly AgentHostLoadedAgentArtifact[]): Promise<AgentHostStoredCandidateV1>
  readCandidate(hostId: string, revisionId: string): Promise<AgentHostStoredCandidateV1 | null>
  writeObservation(hostId: string, revisionId: string, observation: AgentHostObservationV1): Promise<AgentHostObservationV1>
  writeComplete(hostId: string, revisionId: string): Promise<AgentHostStoredCompleteV1>
  readComplete(hostId: string, revisionId: string): Promise<AgentHostStoredCompleteV1 | null>
  readAgentArtifact(hostId: string, revisionId: string, bindingId: string): Promise<AgentHostAgentArtifactEnvelopeV1 | null>
  readActive(hostId: string): Promise<AgentHostActiveEnvelopeV1 | null>
  publishActive(hostId: string, revisionId: string): Promise<AgentHostActiveEnvelopeV1>
  readAuditRecords(hostId: string): Promise<readonly AgentHostAuditRecordV1[]>
  appendAudit(hostId: string, record: AgentHostAuditRecordV1): Promise<void>
  hasTerminalAudit(hostId: string, active: AgentHostActiveEnvelopeV1): Promise<boolean>
}
export class AgentHostActivePublishError extends AgentHostError {
  constructor(readonly committed: boolean) {
    super(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'active' })
    this.name = 'AgentHostActivePublishError'
  }
}
export interface AgentHostRevisionStoreOptions {
  readonly root: string
  readonly ownerUid: number
  readonly appGid: number
  readonly fault?: (point: 'after-active-rename') => void | Promise<void>
}

const REVISION_RE = /^r\d{10}$/
const PLAN_DOMAIN = 'boring-agent-host-plan:v1'
const RESOLVED_DOMAIN = 'boring-agent-host-resolved:v1'
const NOFOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW
interface ExactFsPolicy { readonly uid: number; readonly gid: number; readonly mode: number }

function hostId(value: string): string { return strictAgentHostId(value, 'hostId') }
function revisionId(value: string): string {
  if (!REVISION_RE.test(value)) throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: 'revisionId' })
  return value
}
function mapped(code: AgentHostErrorCode, field: string): never { throw new AgentHostError(code, { field }) }
function json(content: string): unknown {
  try { return JSON.parse(content) as unknown } catch { mapped(AgentHostErrorCode.PLAN_INVALID, 'json') }
}
function exactMetadata(info: Stats, policy: ExactFsPolicy, links = false): boolean {
  return info.uid === policy.uid && info.gid === policy.gid && (info.mode & 0o7777) === policy.mode && (!links || info.nlink === 1)
}
async function openDirectory(directory: string, field: string, policy: ExactFsPolicy, parent = false) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const info = await handle.stat()
  if (!info.isDirectory() || (parent ? info.uid !== policy.uid || (info.mode & 0o022) !== 0 : !exactMetadata(info, policy))) {
    await handle.close(); mapped(AgentHostErrorCode.PLAN_INVALID, field)
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
    if (!exactMetadata(await handle.stat(), to)) mapped(AgentHostErrorCode.PLAN_INVALID, field)
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
export function createHostRevisionStore(options: AgentHostRevisionStoreOptions): AgentHostRevisionStore {
  if (!Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0) throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: 'ownerUid' })
  if (!Number.isSafeInteger(options.appGid) || options.appGid <= 0) throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: 'appGid' })
  if (typeof process.getegid !== 'function') throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field: 'ownerGid' })
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
    if (typeof process.geteuid !== 'function' || process.geteuid() !== ownerUid) mapped(AgentHostErrorCode.PLAN_INVALID, 'ownerUid')
  }
  const ensureHost = async (host: string) => {
    assertMutationOwner()
    const parent = path.dirname(root)
    await directory(parent, 'storeParent', privateDirectory, true)
    if (await realpath(parent) !== path.resolve(parent)) mapped(AgentHostErrorCode.PLAN_INVALID, 'storeParent')
    await ensureDirectory(root, parent, 'storeRoot', privateDirectory, privateDirectory, privateDirectory, true)
    if (await realpath(root) !== root) mapped(AgentHostErrorCode.PLAN_INVALID, 'storeRoot')
    const hostDirectory = hostRoot(host)
    await ensureDirectory(hostDirectory, root, 'hostRoot', redactedDirectory, privateDirectory, privateDirectory)
    const revisions = revisionsRoot(host)
    await ensureDirectory(revisions, hostDirectory, 'revisions', redactedDirectory, privateDirectory, redactedDirectory)
    return { hostDirectory, revisions }
  }
  const existingHost = async (host: string, includeRevisions: boolean, optional: boolean) => {
    try {
      await directory(root, 'storeRoot', privateDirectory)
      if (await realpath(root) !== root) mapped(AgentHostErrorCode.PLAN_INVALID, 'storeRoot')
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
  const loadCandidate = async (host: string, revision: string): Promise<AgentHostStoredCandidateV1 | null> => {
    const target = await revisionDirectory(host, revision, true)
    if (!target) return null
    const desiredRaw = json((await readRegular(path.join(target, 'desired.json'), redactedFile))!)
    const resolvedRaw = json((await readRegular(path.join(target, 'resolved.json'), redactedFile))!)
    exactKeys(desiredRaw, ['schemaVersion', 'domain', 'plan'], 'desiredFile')
    exactKeys(resolvedRaw, ['schemaVersion', 'domain', 'bindings'], 'resolvedFile')
    if (desiredRaw.schemaVersion !== 1 || desiredRaw.domain !== PLAN_DOMAIN) mapped(AgentHostErrorCode.PLAN_INVALID, 'desiredFile')
    if (resolvedRaw.schemaVersion !== 1 || resolvedRaw.domain !== RESOLVED_DOMAIN) mapped(AgentHostErrorCode.PLAN_INVALID, 'resolvedFile')
    const desired = await canonicalizeAgentHostDesiredSnapshot({ schemaVersion: 1, domain: 'boring-agent-host-desired:v1', plan: desiredRaw.plan, resolvedBindings: resolvedRaw.bindings })
    if (desired.plan.hostId !== hostId(host)) mapped(AgentHostErrorCode.PLAN_INVALID, 'desired.plan.hostId')
    const bindingsDirectory = path.join(target, 'bindings')
    await directory(bindingsDirectory, 'bindings', redactedDirectory)
    const expectedBindingFiles = desired.plan.bindings.map((binding) => `${binding.bindingId}.env`).sort()
    const actualBindingFiles = (await readdir(bindingsDirectory)).sort()
    if (JSON.stringify(actualBindingFiles) !== JSON.stringify(expectedBindingFiles)) mapped(AgentHostErrorCode.PLAN_INVALID, 'bindings')
    for (const binding of desired.plan.bindings) {
      const content = await readRegular(path.join(bindingsDirectory, `${binding.bindingId}.env`), redactedFile)
      validateAgentHostBindingEnv(content!, binding)
    }
    const secretRefs = canonicalizeAgentHostSecretRefsEnvelope(json((await readRegular(path.join(target, 'secret-refs.json'), redactedFile))!), desired)
    const desiredStateDigest = await digestAgentHostDesired(desired)
    if ((await readRegular(path.join(target, 'desired.sha256'), redactedFile))!.trim() !== desiredStateDigest) mapped(AgentHostErrorCode.PLAN_INVALID, 'desiredDigest')
    return Object.freeze({ revisionId: revision, desired, desiredStateDigest, secretRefs })
  }
  const loadComplete = async (host: string, revision: string): Promise<AgentHostStoredCompleteV1 | null> => {
    const target = await revisionDirectory(host, revision, true)
    if (!target) return null
    const rawCompletion = await readRegular(path.join(target, 'completion.json'), redactedFile, true)
    if (rawCompletion === null) return null
    const candidate = await loadCandidate(host, revision)
    if (!candidate) mapped(AgentHostErrorCode.PLAN_INVALID, 'candidate')
    const observation = await canonicalizeAgentHostObservation(json((await readRegular(path.join(target, 'observed.json'), redactedFile))!), candidate.desired)
    const completion = await canonicalizeAgentHostCompleteEnvelope(json(rawCompletion), candidate.desired, observation)
    return Object.freeze({ ...candidate, observation, completion })
  }
  const loadActive = async (host: string): Promise<AgentHostActiveEnvelopeV1 | null> => {
    if (!await existingHost(host, false, true)) return null
    const raw = await readRegular(path.join(hostRoot(host), 'active'), redactedFile, true)
    if (raw === null) return null
    const active = canonicalizeAgentHostActiveEnvelope(json(raw))
    const complete = await loadComplete(host, active.revisionId)
    if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) mapped(AgentHostErrorCode.PLAN_INVALID, 'active')
    return active
  }
  const auditRecords = async (host: string, repair: boolean) => {
    if (!repair && !await existingHost(host, false, true)) return Object.freeze([]) as readonly AgentHostAuditRecordV1[]
    const hostDirectory = repair ? (await ensureHost(host)).hostDirectory : hostRoot(host)
    const file = path.join(hostDirectory, 'audit.jsonl')
    const content = await readRegular(file, auditFile, true)
    if (content === null || content === '') return Object.freeze([]) as readonly AgentHostAuditRecordV1[]
    let durable = content
    if (!content.endsWith('\n')) {
      const newline = content.lastIndexOf('\n')
      durable = newline < 0 ? '' : content.slice(0, newline + 1)
    }
    const records = Object.freeze(durable.split('\n').filter(Boolean).map((line) => canonicalizeAgentHostAuditRecord(json(line))))
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
        if (!Number.isSafeInteger(current) || current < 0 || current >= 9_999_999_999 || (raw !== null && raw.trim() !== String(current))) mapped(AgentHostErrorCode.REVISION_CONFLICT, 'sequence')
        const next = current + 1
        const temporary = path.join(hostDirectory, `.sequence.${randomUUID()}`)
        await createDurable(temporary, `${next}\n`, privateFile)
        await rename(temporary, sequence)
        await syncDirectory(hostDirectory, 'hostRoot', redactedDirectory)
        return `r${String(next).padStart(10, '0')}`
      } catch { mapped(AgentHostErrorCode.REVISION_CONFLICT, 'sequence') }
    },
    async writeCandidate(host, revision, rawDesired, agentArtifacts) {
      const desired = await canonicalizeAgentHostDesiredSnapshot(rawDesired)
      if (desired.plan.hostId !== hostId(host)) mapped(AgentHostErrorCode.PLAN_INVALID, 'desired.plan.hostId')
      let serializedArtifacts: readonly { readonly bindingId: string; readonly value: string }[] = []
      try {
        {
          if (agentArtifacts.length !== desired.plan.bindings.length) mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
          serializedArtifacts = await Promise.all(desired.plan.bindings.map(async (binding, index) => {
            const artifact = agentArtifacts[index]; const expected = desired.resolvedBindings[index]
            if (artifact && expected) await validateAgentHostAgentArtifact(artifact.envelope, binding, expected)
            if (!artifact || artifact.envelope.hostId !== host || artifact.envelope.bindingId !== binding.bindingId
              || artifact.envelope.bundleRef !== binding.bundleRef || artifact.envelope.deploymentRef !== binding.deploymentRef) throw new Error()
            return { bindingId: binding.bindingId, value: JSON.stringify(artifact.envelope) }
          }))
        }
      } catch { mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts') }
      let writingArtifacts = false
      try {
        const { hostDirectory, revisions } = await ensureHost(host)
        if ((await readRegular(path.join(hostDirectory, 'sequence'), privateFile))!.trim() !== String(Number(revisionId(revision).slice(1)))) mapped(AgentHostErrorCode.REVISION_CONFLICT, 'revisionId')
        const target = revisionRoot(host, revision)
        try { await lstat(target); mapped(AgentHostErrorCode.REVISION_CONFLICT, 'revisionId') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const temporary = path.join(revisions, `.${revision}.${randomUUID()}`)
        await mkdir(temporary, { mode: 0o700 })
        await directory(temporary, 'candidate', privateDirectory)
        const desiredStateDigest = await digestAgentHostDesired(desired)
        const secretRefs = deriveAgentHostSecretRefsEnvelope(desired)
        await createDurable(path.join(temporary, 'desired.json'), JSON.stringify({ schemaVersion: 1, domain: PLAN_DOMAIN, plan: desired.plan }), redactedFile)
        await createDurable(path.join(temporary, 'resolved.json'), JSON.stringify({ schemaVersion: 1, domain: RESOLVED_DOMAIN, bindings: desired.resolvedBindings }), redactedFile)
        await createDurable(path.join(temporary, 'secret-refs.json'), JSON.stringify(secretRefs), redactedFile)
        await createDurable(path.join(temporary, 'desired.sha256'), `${desiredStateDigest}\n`, redactedFile)
        const bindingsDirectory = path.join(temporary, 'bindings')
        await mkdir(bindingsDirectory, { mode: 0o700 })
        await directory(bindingsDirectory, 'bindings', privateDirectory)
        for (const binding of desired.plan.bindings) {
          await createDurable(path.join(bindingsDirectory, `${binding.bindingId}.env`), renderAgentHostBindingEnv(binding), redactedFile)
        }
        await syncDirectory(bindingsDirectory, 'bindings', privateDirectory)
        await finalizeDirectory(bindingsDirectory, 'bindings', privateDirectory, redactedDirectory)
        {
          writingArtifacts = true
          const artifactsDirectory = path.join(temporary, 'agent-artifacts')
          await mkdir(artifactsDirectory, { mode: 0o700 }); await directory(artifactsDirectory, 'agentArtifacts', privateDirectory)
          for (const artifact of serializedArtifacts) await createDurable(path.join(artifactsDirectory, `${artifact.bindingId}.json`), artifact.value, redactedFile)
          await syncDirectory(artifactsDirectory, 'agentArtifacts', privateDirectory)
          await finalizeDirectory(artifactsDirectory, 'agentArtifacts', privateDirectory, redactedDirectory)
          writingArtifacts = false
        }
        await syncDirectory(temporary, 'candidate', privateDirectory)
        await finalizeDirectory(temporary, 'candidate', privateDirectory, redactedDirectory)
        await rename(temporary, target)
        await syncDirectory(revisions, 'revisions', redactedDirectory)
        return Object.freeze({ revisionId: revision, desired, desiredStateDigest, secretRefs })
      } catch (error) {
        if (error instanceof AgentHostError) throw error
        if (writingArtifacts) mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
        mapped(AgentHostErrorCode.REVISION_CONFLICT, 'candidate')
      }
    },
    async readCandidate(host, revision) {
      hostId(host); revisionId(revision)
      try { return await loadCandidate(host, revision) } catch { mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
    },
    async writeObservation(host, revision, rawObservation) {
      hostId(host); revisionId(revision)
      assertMutationOwner()
      let candidate
      try { candidate = await loadCandidate(host, revision) } catch { mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
      if (!candidate) mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision')
      const observation = await canonicalizeAgentHostObservation(rawObservation, candidate.desired)
      try {
        const target = revisionRoot(host, revision)
        await createDurable(path.join(target, 'observed.json'), JSON.stringify(observation), redactedFile)
        await syncDirectory(target, 'revision', redactedDirectory)
        return observation
      } catch { mapped(AgentHostErrorCode.COLLECTION_NOT_READY, 'observation') }
    },
    async writeComplete(host, revision) {
      hostId(host); revisionId(revision)
      assertMutationOwner()
      let candidate
      try { candidate = await loadCandidate(host, revision) } catch { mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
      if (!candidate) mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision')
      try {
        const target = revisionRoot(host, revision)
        const observation = await canonicalizeAgentHostObservation(json((await readRegular(path.join(target, 'observed.json'), redactedFile))!), candidate.desired)
        const completion = await createAgentHostCompleteEnvelope(revision, candidate.desired, observation)
        await createDurable(path.join(target, 'completion.json'), JSON.stringify(completion), redactedFile)
        await syncDirectory(target, 'revision', redactedDirectory)
        return Object.freeze({ ...candidate, observation, completion })
      } catch (error) {
        if (error instanceof AgentHostError && error.details.field === 'completion.observation.ready') throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'observation' })
        mapped(AgentHostErrorCode.COLLECTION_NOT_READY, 'completion')
      }
    },
    async readComplete(host, revision) {
      hostId(host); revisionId(revision)
      try { return await loadComplete(host, revision) } catch { mapped(AgentHostErrorCode.ROLLBACK_TARGET_INVALID, 'targetRevision') }
    },
    async readAgentArtifact(host, revision, requestedBindingId) {
      hostId(host); revisionId(revision); const safeBindingId = strictAgentHostRef(requestedBindingId, 'bindingId')
      try {
        const candidate = await loadCandidate(host, revision)
        if (!candidate) return null
        const binding = candidate.desired.plan.bindings.find((value) => value.bindingId === safeBindingId)
        if (!binding) mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
        const revisionDirectoryPath = await revisionDirectory(host, revision)
        const artifactsDirectory = path.join(revisionDirectoryPath!, 'agent-artifacts')
        await directory(artifactsDirectory, 'agentArtifacts', redactedDirectory)
        const raw = await readRegular(path.join(artifactsDirectory, `${safeBindingId}.json`), redactedFile, true)
        if (raw === null) return null
        const envelope = canonicalizeAgentHostAgentArtifactEnvelope(json(raw), host, binding)
        const expected = candidate.desired.resolvedBindings.find((value) => value.bindingId === safeBindingId)!
        await validateAgentHostAgentArtifact(envelope, binding, expected)
        return envelope
      } catch (error) {
        if (error instanceof AgentHostError && error.code === AgentHostErrorCode.PUBLICATION_FAILED) throw error
        mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts')
      }
    },
    async readActive(host) {
      hostId(host)
      try { return await loadActive(host) } catch { mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'active') }
    },
    async publishActive(host, revision) {
      hostId(host); revisionId(revision)
      let committed = false
      try {
        const complete = await loadComplete(host, revision)
        if (!complete) throw new Error('incomplete')
        const active = canonicalizeAgentHostActiveEnvelope({ schemaVersion: 1, revisionId: revision, desiredStateDigest: complete.desiredStateDigest })
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
      } catch { throw new AgentHostActivePublishError(committed) }
    },
    async readAuditRecords(host) {
      hostId(host)
      try { return await auditRecords(host, false) } catch { mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
    async appendAudit(host, rawRecord) {
      hostId(host)
      const record = canonicalizeAgentHostAuditRecord(rawRecord)
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
      } catch { mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
    async hasTerminalAudit(host, rawActive) {
      hostId(host)
      const supplied = canonicalizeAgentHostActiveEnvelope(rawActive)
      try {
        const active = await loadActive(host)
        if (!active || active.revisionId !== supplied.revisionId || active.desiredStateDigest !== supplied.desiredStateDigest) return false
        const complete = await loadComplete(host, active.revisionId)
        if (!complete) mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'audit')
        return (await auditRecords(host, false)).some((record) => isAgentHostTerminalAuditFor(record, active, complete.completion))
      } catch { mapped(AgentHostErrorCode.PUBLICATION_FAILED, 'audit') }
    },
  }
}
