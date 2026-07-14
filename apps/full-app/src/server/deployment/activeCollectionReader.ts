import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

import { D1_V1_COLLECTION_LIMITS } from './bootCollection.js'
import { validateD1BindingEnv } from './d1BindingEnv.js'
import { canonicalizeD1AgentArtifactEnvelope, type D1AgentArtifactEnvelopeV1 } from './d1AgentArtifactSnapshot.js'
import { assertD1ExactKeys as exactKeys, D1HostError, D1HostErrorCode, strictD1HostId, type D1SiteBindingV1 } from './d1Plan.js'
import {
  canonicalizeD1ActiveEnvelope,
  canonicalizeD1CompleteEnvelope,
  canonicalizeD1DesiredSnapshot,
  canonicalizeD1Observation,
  canonicalizeD1SecretRefsEnvelope,
  digestD1Desired,
  type D1ActiveEnvelopeV1,
  type D1CompleteEnvelopeV1,
  type D1DesiredSnapshotV1,
  type D1ObservationV1,
} from './d1RevisionCodec.js'

const PLAN_DOMAIN = 'boring-d1-plan:v1'
const RESOLVED_DOMAIN = 'boring-d1-resolved:v1'
const DIRECTORY_MODE = 0o710
const FILE_MODE = 0o440
const NOFOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const FILE_LIMIT = 4 * 1024 * 1024

export interface D1ActiveCollection {
  readonly active: D1ActiveEnvelopeV1
  readonly desired: D1DesiredSnapshotV1
  readonly observation: D1ObservationV1
  readonly completion: D1CompleteEnvelopeV1
}

export interface D1ActiveCollectionReader {
  read(): Promise<D1ActiveCollection | null>
}
export interface D1AgentArtifactReader extends D1ActiveCollectionReader {
  readAgentArtifact(collection: D1ActiveCollection, binding: D1SiteBindingV1): Promise<D1AgentArtifactEnvelopeV1>
}

export interface D1ActiveCollectionReaderOptions {
  readonly hostRoot: string
  readonly hostId: string
  readonly ownerUid: number
  readonly appGid: number
}

interface FsPolicy { readonly uid: number, readonly gid: number }

function invalid(field: string): never {
  throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field })
}

function publicationFailed(field = 'active'): never {
  throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field })
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

export function createD1ActiveCollectionReader(options: D1ActiveCollectionReaderOptions): D1AgentArtifactReader {
  if (typeof options?.hostRoot !== 'string' || options.hostRoot.includes('\0') || !path.isAbsolute(options.hostRoot)
    || path.resolve(options.hostRoot) !== options.hostRoot) invalid('hostRoot')
  let hostId: string
  try { hostId = strictD1HostId(options.hostId, 'hostId') } catch { invalid('hostId') }
  if (!Number.isSafeInteger(options.ownerUid) || options.ownerUid < 0) invalid('ownerUid')
  if (!Number.isSafeInteger(options.appGid) || options.appGid <= 0) invalid('appGid')
  const hostRoot = options.hostRoot
  const policy = Object.freeze({ uid: options.ownerUid, gid: options.appGid })

  return Object.freeze({
    async readAgentArtifact(collection: D1ActiveCollection, binding: D1SiteBindingV1) {
      try {
        const planned = collection.desired.plan.bindings.find((value) => value.bindingId === binding.bindingId)
        if (planned !== binding) throw new Error('binding is not from active snapshot')
        const revisionRoot = path.join(hostRoot, 'revisions', collection.active.revisionId)
        const artifactsRoot = path.join(revisionRoot, 'agent-artifacts')
        await assertDirectory(revisionRoot, policy); await assertDirectory(artifactsRoot, policy)
        const envelope = canonicalizeD1AgentArtifactEnvelope(
          json((await readFile(path.join(artifactsRoot, `${binding.bindingId}.json`), policy, false, D1_V1_COLLECTION_LIMITS.maxBundleBytes))!), hostId, binding,
        )
        const active = canonicalizeD1ActiveEnvelope(json((await readFile(path.join(hostRoot, 'active'), policy, false, 16 * 1024))!))
        if (JSON.stringify(active) !== JSON.stringify(collection.active)) throw new Error('active revision changed')
        return envelope
      } catch { publicationFailed('agentArtifacts') }
    },
    async read(): Promise<D1ActiveCollection | null> {
      try {
        if (await realpath(hostRoot) !== hostRoot) throw new Error('non-canonical host root')
        await assertDirectory(hostRoot, policy)
        const revisionsRoot = path.join(hostRoot, 'revisions')
        await assertDirectory(revisionsRoot, policy)
        const activeContent = await readFile(path.join(hostRoot, 'active'), policy, true, 16 * 1024)
        if (activeContent === null) return null
        const active = canonicalizeD1ActiveEnvelope(json(activeContent))
        const revisionRoot = path.join(revisionsRoot, active.revisionId)
        await assertDirectory(revisionRoot, policy)

        const desiredFile = json((await readFile(path.join(revisionRoot, 'desired.json'), policy))!)
        const resolvedFile = json((await readFile(path.join(revisionRoot, 'resolved.json'), policy))!)
        exactKeys(desiredFile, ['schemaVersion', 'domain', 'plan'], 'desiredFile')
        exactKeys(resolvedFile, ['schemaVersion', 'domain', 'bindings'], 'resolvedFile')
        if (desiredFile.schemaVersion !== 1 || desiredFile.domain !== PLAN_DOMAIN
          || resolvedFile.schemaVersion !== 1 || resolvedFile.domain !== RESOLVED_DOMAIN) throw new Error('invalid split snapshot')
        const desired = await canonicalizeD1DesiredSnapshot({
          schemaVersion: 1, domain: 'boring-d1-desired:v1', plan: desiredFile.plan, resolvedBindings: resolvedFile.bindings,
        })
        if (desired.plan.hostId !== hostId) throw new Error('host mismatch')
        const desiredStateDigest = await digestD1Desired(desired)
        if (active.desiredStateDigest !== desiredStateDigest
          || await readFile(path.join(revisionRoot, 'desired.sha256'), policy, false, 256) !== `${desiredStateDigest}\n`) throw new Error('digest mismatch')

        canonicalizeD1SecretRefsEnvelope(json((await readFile(path.join(revisionRoot, 'secret-refs.json'), policy, false, FILE_LIMIT))!), desired)
        const bindingsRoot = path.join(revisionRoot, 'bindings')
        await assertDirectory(bindingsRoot, policy)
        for (const binding of desired.plan.bindings) {
          validateD1BindingEnv((await readFile(path.join(bindingsRoot, `${binding.bindingId}.env`), policy, false, 64 * 1024))!, binding)
        }
        const observation = await canonicalizeD1Observation(
          json((await readFile(path.join(revisionRoot, 'observed.json'), policy))!), desired,
        )
        const completion = await canonicalizeD1CompleteEnvelope(
          json((await readFile(path.join(revisionRoot, 'completion.json'), policy, false, 16 * 1024))!), desired, observation,
        )
        if (completion.revisionId !== active.revisionId || completion.desiredStateDigest !== active.desiredStateDigest) throw new Error('completion mismatch')
        return Object.freeze({ active, desired, observation, completion })
      } catch { publicationFailed() }
    },
  })
}
