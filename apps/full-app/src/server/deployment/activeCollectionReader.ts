import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

import { AGENT_HOST_V1_COLLECTION_LIMITS } from './bootCollection.js'
import { validateAgentHostBindingEnv } from './agentHostBindingEnv.js'
import { canonicalizeAgentHostAgentArtifactEnvelope, type AgentHostAgentArtifactEnvelopeV1 } from './agentHostAgentArtifactSnapshot.js'
import { assertAgentHostExactKeys as exactKeys, AgentHostError, AgentHostErrorCode, strictAgentHostId, type AgentHostSiteBindingV1 } from './agentHostPlan.js'
import type { AgentHostStoredCandidateV1, AgentHostStoredCompleteV1 } from './hostRevisionStore.js'
import {
  canonicalizeAgentHostActiveEnvelope,
  canonicalizeAgentHostCompleteEnvelope,
  canonicalizeAgentHostDesiredSnapshot,
  canonicalizeAgentHostObservation,
  canonicalizeAgentHostSecretRefsEnvelope,
  digestAgentHostDesired,
  type AgentHostActiveEnvelopeV1,
  type AgentHostCompleteEnvelopeV1,
  type AgentHostDesiredSnapshotV1,
  type AgentHostObservationV1,
} from './agentHostRevisionCodec.js'

const PLAN_DOMAIN = 'boring-agent-host-plan:v1'
const RESOLVED_DOMAIN = 'boring-agent-host-resolved:v1'
const DIRECTORY_MODE = 0o710
const FILE_MODE = 0o440
const NOFOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const FILE_LIMIT = 4 * 1024 * 1024

export interface AgentHostActiveCollection {
  readonly active: AgentHostActiveEnvelopeV1
  readonly desired: AgentHostDesiredSnapshotV1
  readonly observation: AgentHostObservationV1
  readonly completion: AgentHostCompleteEnvelopeV1
}

export interface AgentHostActiveCollectionReader {
  read(): Promise<AgentHostActiveCollection | null>
}
export interface AgentHostAgentArtifactReader extends AgentHostActiveCollectionReader {
  readAgentArtifact(collection: AgentHostActiveCollection, binding: AgentHostSiteBindingV1): Promise<AgentHostAgentArtifactEnvelopeV1>
}
export interface AgentHostImmutableRevisionReader extends AgentHostAgentArtifactReader {
  readActive(): Promise<AgentHostActiveEnvelopeV1 | null>
  readCandidate(revisionId: string): Promise<AgentHostStoredCandidateV1 | null>
  readComplete(revisionId: string): Promise<AgentHostStoredCompleteV1 | null>
  readRevisionAgentArtifact(revisionId: string, binding: AgentHostSiteBindingV1): Promise<AgentHostAgentArtifactEnvelopeV1>
}

export interface AgentHostActiveCollectionReaderOptions {
  readonly hostRoot: string
  readonly hostId: string
  readonly ownerUid: number
  readonly appGid: number
}

interface FsPolicy { readonly uid: number, readonly gid: number }

function invalid(field: string): never {
  throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field })
}

function publicationFailed(field = 'active'): never {
  throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field })
}

function exactMetadata(info: Stats, policy: FsPolicy, mode: number, links = false): boolean {
  return info.uid === policy.uid && info.gid === policy.gid && (info.mode & 0o7777) === mode && (!links || info.nlink === 1)
}

async function assertDirectory(directory: string, policy: FsPolicy): Promise<void> {
  // The trusted publication owner keeps named revisions immutable; lstat preserves app-group traversal of 0710 directories without requiring read access.
  const info = await lstat(directory)
  if (!info.isDirectory() || !exactMetadata(info, policy, DIRECTORY_MODE)) throw new Error('invalid directory')
}

async function readFile(file: string, policy: FsPolicy, optional = false, limit = FILE_LIMIT): Promise<string | null> {
  let handle
  try { handle = await open(file, NOFOLLOW_READ) } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || !exactMetadata(info, policy, FILE_MODE, true) || info.size < 0 || info.size > limit) throw new Error('invalid file')
    return await handle.readFile('utf8')
  } finally { await handle.close() }
}

function json(content: string): unknown {
  return JSON.parse(content) as unknown
}

export function createAgentHostActiveCollectionReader(options: AgentHostActiveCollectionReaderOptions): AgentHostImmutableRevisionReader {
  if (typeof options?.hostRoot !== 'string' || options.hostRoot.includes('\0') || !path.isAbsolute(options.hostRoot)
    || path.resolve(options.hostRoot) !== options.hostRoot) invalid('hostRoot')
  let hostId: string
  try { hostId = strictAgentHostId(options.hostId, 'hostId') } catch { invalid('hostId') }
  if (!Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0) invalid('ownerUid')
  if (!Number.isSafeInteger(options.appGid) || options.appGid <= 0) invalid('appGid')
  const hostRoot = options.hostRoot
  const policy = Object.freeze({ uid: options.ownerUid, gid: options.appGid })

  const readActive = async () => {
    const content = await readFile(path.join(hostRoot, 'active'), policy, true, 16 * 1024)
    return content === null ? null : canonicalizeAgentHostActiveEnvelope(json(content))
  }
  const readCandidate = async (revisionId: string): Promise<AgentHostStoredCandidateV1 | null> => {
    const revisionRoot = path.join(hostRoot, 'revisions', revisionId)
    try { await assertDirectory(revisionRoot, policy) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const desiredFile = json((await readFile(path.join(revisionRoot, 'desired.json'), policy))!)
    const resolvedFile = json((await readFile(path.join(revisionRoot, 'resolved.json'), policy))!)
    exactKeys(desiredFile, ['schemaVersion', 'domain', 'plan'], 'desiredFile'); exactKeys(resolvedFile, ['schemaVersion', 'domain', 'bindings'], 'resolvedFile')
    if (desiredFile.schemaVersion !== 1 || desiredFile.domain !== PLAN_DOMAIN || resolvedFile.schemaVersion !== 1 || resolvedFile.domain !== RESOLVED_DOMAIN) throw new Error()
    const desired = await canonicalizeAgentHostDesiredSnapshot({ schemaVersion: 1, domain: 'boring-agent-host-desired:v1', plan: desiredFile.plan, resolvedBindings: resolvedFile.bindings })
    if (desired.plan.hostId !== hostId) throw new Error()
    const desiredStateDigest = await digestAgentHostDesired(desired)
    if (await readFile(path.join(revisionRoot, 'desired.sha256'), policy, false, 256) !== `${desiredStateDigest}\n`) throw new Error()
    const secretRefs = canonicalizeAgentHostSecretRefsEnvelope(json((await readFile(path.join(revisionRoot, 'secret-refs.json'), policy, false, FILE_LIMIT))!), desired)
    const bindingsRoot = path.join(revisionRoot, 'bindings'); await assertDirectory(bindingsRoot, policy)
    for (const binding of desired.plan.bindings) validateAgentHostBindingEnv((await readFile(path.join(bindingsRoot, `${binding.bindingId}.env`), policy, false, 64 * 1024))!, binding)
    return Object.freeze({ revisionId, desired, desiredStateDigest, secretRefs })
  }
  const readComplete = async (revisionId: string): Promise<AgentHostStoredCompleteV1 | null> => {
    const candidate = await readCandidate(revisionId); if (!candidate) return null
    const root = path.join(hostRoot, 'revisions', revisionId)
    const observation = await canonicalizeAgentHostObservation(json((await readFile(path.join(root, 'observed.json'), policy))!), candidate.desired)
    const completion = await canonicalizeAgentHostCompleteEnvelope(json((await readFile(path.join(root, 'completion.json'), policy, false, 16 * 1024))!), candidate.desired, observation)
    if (completion.revisionId !== revisionId || completion.desiredStateDigest !== candidate.desiredStateDigest) throw new Error()
    return Object.freeze({ ...candidate, observation, completion })
  }
  const readRevisionAgentArtifact = async (revisionId: string, binding: AgentHostSiteBindingV1) => {
    const root = path.join(hostRoot, 'revisions', revisionId); await assertDirectory(root, policy); await assertDirectory(path.join(root, 'agent-artifacts'), policy)
    return canonicalizeAgentHostAgentArtifactEnvelope(json((await readFile(path.join(root, 'agent-artifacts', `${binding.bindingId}.json`), policy, false, AGENT_HOST_V1_COLLECTION_LIMITS.maxBundleBytes))!), hostId, binding)
  }
  const guarded = async <T>(operation: () => Promise<T>, field = 'active'): Promise<T> => {
    try { if (await realpath(hostRoot) !== hostRoot) throw new Error(); await assertDirectory(hostRoot, policy); await assertDirectory(path.join(hostRoot, 'revisions'), policy); return await operation() }
    catch { publicationFailed(field) }
  }
  return Object.freeze({
    readActive: () => guarded(readActive), readCandidate: (revisionId: string) => guarded(() => readCandidate(revisionId)),
    readComplete: (revisionId: string) => guarded(() => readComplete(revisionId)),
    readRevisionAgentArtifact: (revisionId: string, binding: AgentHostSiteBindingV1) => guarded(() => readRevisionAgentArtifact(revisionId, binding), 'agentArtifacts'),
    async readAgentArtifact(collection: AgentHostActiveCollection, binding: AgentHostSiteBindingV1) {
      const planned = collection.desired.plan.bindings.find((value: AgentHostSiteBindingV1) => value.bindingId === binding.bindingId)
      if (planned !== binding) publicationFailed('agentArtifacts')
      const envelope = await guarded(() => readRevisionAgentArtifact(collection.active.revisionId, binding), 'agentArtifacts')
      if (JSON.stringify(await guarded(readActive)) !== JSON.stringify(collection.active)) publicationFailed('agentArtifacts')
      return envelope
    },
    async read() {
      return guarded(async () => {
        const active = await readActive(); if (!active) return null
        const complete = await readComplete(active.revisionId)
        if (!complete || complete.desiredStateDigest !== active.desiredStateDigest) throw new Error()
        return Object.freeze({ active, desired: complete.desired, observation: complete.observation, completion: complete.completion })
      })
    },
  })
}
