import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import type { Sha256Digest } from '@hachej/boring-agent/shared'

import type { AgentHostApplyEffects } from './agentHostCommand.js'
import { canonicalizeAgentHostObservation, type AgentHostActiveEnvelopeV1 } from './agentHostRevisionCodec.js'
import type { AgentHostRuntimeInputsIdentityV1 } from './agentHostRuntimeInputs.js'
import { normalizeAgentHostDestructivePublicationIdentity, type AgentHostDestructivePublicationIdentity } from './destructivePublicationJournal.js'
import type { AgentHostRevisionStore, AgentHostStoredCandidateV1 } from './hostRevisionStore.js'

import { assertAgentHostExactKeys, agentHostDigest, AgentHostError, AgentHostErrorCode, strictAgentHostRef } from './agentHostPlan.js'

export const AGENT_HOST_CONTROL_ROOT = '/run/boring/agent-host/control'
export const AGENT_HOST_PENDING_PUBLICATION_FILE = 'pending'
export const AGENT_HOST_PUBLICATION_SOCKET_FILE = 'publication.sock'
const MAX_FRAME_BYTES = 512
const MAX_PENDING_BYTES = 512 * 1024
const REVISION_RE = /^r\d{10}$/

export interface AgentHostPendingPublicationV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly expectedRevision: string | null
  readonly expectedDigest: Sha256Digest | null
  readonly targetRevision: string
  readonly targetDigest: Sha256Digest
  readonly runtimeInputs: readonly unknown[]
  readonly rollback: AgentHostDestructivePublicationIdentity | null
  readonly state: 'prepared' | 'committed'
}
export interface AgentHostPublicationStatusV1 {
  readonly durableRevision: string | null
  readonly servedRevision: string | null
  readonly pendingOperation: string | null
}
export interface AgentHostPublicationControlAuthority {
  prepare(operationId: string): Promise<AgentHostPublicationStatusV1>
  commit(operationId: string): Promise<AgentHostPublicationStatusV1>
  discard(operationId: string): Promise<AgentHostPublicationStatusV1>
  status(operationId?: string): Promise<AgentHostPublicationStatusV1>
}

function failed(field = 'publication'): never { throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field }) }
function revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) failed(field)
  return value
}
export function parseAgentHostPendingPublication(raw: unknown): AgentHostPendingPublicationV1 {
  try {
    assertAgentHostExactKeys(raw, ['schemaVersion', 'operationId', 'expectedRevision', 'expectedDigest', 'targetRevision', 'targetDigest', 'runtimeInputs', 'rollback', 'state'], 'pending')
    if (raw.schemaVersion !== 1 || raw.state !== 'prepared' && raw.state !== 'committed' || (raw.expectedRevision === null) !== (raw.expectedDigest === null)
      || !Array.isArray(raw.runtimeInputs) || raw.runtimeInputs.length > 20) failed('pending')
    const rollback = raw.rollback
    return Object.freeze({ schemaVersion: 1, operationId: strictAgentHostRef(raw.operationId, 'operationId'),
      expectedRevision: raw.expectedRevision === null ? null : revision(raw.expectedRevision, 'expectedRevision'),
      expectedDigest: raw.expectedDigest === null ? null : agentHostDigest(raw.expectedDigest, 'expectedDigest'),
      targetRevision: revision(raw.targetRevision, 'targetRevision'), targetDigest: agentHostDigest(raw.targetDigest, 'targetDigest'),
      runtimeInputs: Object.freeze(structuredClone(raw.runtimeInputs)),
      rollback: rollback === null ? null : normalizeAgentHostDestructivePublicationIdentity(rollback as AgentHostDestructivePublicationIdentity), state: raw.state })
  } catch { failed('pending') }
}
function exact(info: Stats, uid: number, gid: number, mode: number): boolean {
  return info.uid === uid && info.gid === gid && (info.mode & 0o7777) === mode
}
export async function readAgentHostPendingPublication(options: {
  readonly root?: string; readonly ownerUid: number; readonly appGid: number
}): Promise<AgentHostPendingPublicationV1 | null> {
  const root = options.root ?? AGENT_HOST_CONTROL_ROOT; const file = path.join(root, AGENT_HOST_PENDING_PUBLICATION_FILE)
  let handle
  try {
    const rootInfo = await lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !exact(rootInfo, options.ownerUid, options.appGid, 0o710)
      || await realpath(root) !== root) failed('controlRoot')
    try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const info = await handle.stat()
    if (!info.isFile() || !exact(info, options.ownerUid, options.appGid, 0o440) || info.nlink !== 1 || info.size < 1 || info.size > MAX_PENDING_BYTES) failed('pending')
    const bytes = await handle.readFile()
    return parseAgentHostPendingPublication(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
  } catch (error) { if (error instanceof AgentHostError) throw error; return failed('pending') }
  finally { await handle?.close() }
}
function request(raw: unknown): Readonly<{ action: 'prepare' | 'commit' | 'discard' | 'status'; operationId?: string }> {
  try {
    if (typeof raw !== 'object' || raw === null) failed('request')
    const action = (raw as { action?: unknown }).action
    if (action === 'status') {
      assertAgentHostExactKeys(raw, ['action'], 'request'); return Object.freeze({ action })
    }
    if (action !== 'prepare' && action !== 'commit' && action !== 'discard') failed('request')
    assertAgentHostExactKeys(raw, ['action', 'operationId'], 'request')
    return Object.freeze({ action, operationId: strictAgentHostRef((raw as { operationId?: unknown }).operationId, 'operationId') })
  } catch { failed('request') }
}
function serveSocket(socket: Socket, authority: AgentHostPublicationControlAuthority): void {
  let bytes = 0; let frame = ''; let finished = false
  const reject = () => { if (!finished) { finished = true; socket.end(`${JSON.stringify({ ok: false, error: { code: AgentHostErrorCode.PUBLICATION_FAILED, details: { field: 'request' } } })}\n`) } }
  socket.setEncoding('utf8'); socket.on('data', (chunk: string) => {
    if (finished) return
    bytes += Buffer.byteLength(chunk); frame += chunk
    if (bytes > MAX_FRAME_BYTES || frame.indexOf('\n') !== frame.lastIndexOf('\n')) reject()
  }); socket.on('end', () => {
    if (finished || !frame.endsWith('\n')) return reject()
    finished = true
    void (async () => {
      try {
        const value = request(JSON.parse(frame.slice(0, -1)) as unknown)
        const status = value.action === 'prepare' ? await authority.prepare(value.operationId!)
          : value.action === 'commit' ? await authority.commit(value.operationId!)
            : value.action === 'discard' ? await authority.discard(value.operationId!) : await authority.status()
        socket.end(`${JSON.stringify({ ok: true, status })}\n`)
      } catch { socket.end(`${JSON.stringify({ ok: false, error: { code: AgentHostErrorCode.PUBLICATION_FAILED, details: { field: 'request' } } })}\n`) }
    })()
  }); socket.on('error', () => {})
}
export async function startAgentHostPublicationControlServer(authority: AgentHostPublicationControlAuthority, options: {
  readonly root?: string; readonly ownerUid: number; readonly appUid?: number; readonly appGid: number
}): Promise<Server> {
  const root = options.root ?? AGENT_HOST_CONTROL_ROOT; const socketPath = path.join(root, AGENT_HOST_PUBLICATION_SOCKET_FILE)
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !exact(rootInfo, options.ownerUid, options.appGid, 0o730)
    || await realpath(root) !== root) failed('controlRoot')
  try {
    const existing = await lstat(socketPath)
    if (!existing.isSocket() || existing.uid !== (options.appUid ?? process.geteuid?.())) failed('socket')
    await unlink(socketPath)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const server = createServer({ allowHalfOpen: true }, (socket) => serveSocket(socket, authority))
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  try { await chmod(socketPath, 0o660); server.unref(); return server }
  catch (error) { server.close(); throw error }
}

export interface AgentHostRootPublicationClient extends Pick<AgentHostApplyEffects, 'preload' | 'verifyActive'> {
  status(): Promise<AgentHostPublicationStatusV1>
  commit(operationId: string, target: AgentHostActiveEnvelopeV1): Promise<void>
  discard(operationId: string): Promise<void>
  recover(): Promise<void>
}
function exactStatus(raw: unknown): AgentHostPublicationStatusV1 {
  try {
    assertAgentHostExactKeys(raw, ['durableRevision', 'servedRevision', 'pendingOperation'], 'status')
    const value = (item: unknown, field: string) => item === null ? null : revision(item, field)
    return Object.freeze({ durableRevision: value(raw.durableRevision, 'durableRevision'), servedRevision: value(raw.servedRevision, 'servedRevision'),
      pendingOperation: raw.pendingOperation === null ? null : strictAgentHostRef(raw.pendingOperation, 'pendingOperation') })
  } catch { failed('status') }
}
export function createAgentHostRootPublicationClient(options: {
  readonly hostId: string; readonly hostRoot: string; readonly ownerUid: number; readonly appGid: number; readonly operationId: string
  readonly revisionStore: AgentHostRevisionStore; readonly controlRoot?: string; readonly socketPath?: string; readonly timeoutMs?: number; readonly startupTimeoutMs?: number
  readonly startCore?: (candidate: AgentHostStoredCandidateV1) => Promise<void>; readonly startIngress?: (candidate: AgentHostStoredCandidateV1) => Promise<void>
}): AgentHostRootPublicationClient {
  let pending: AgentHostPendingPublicationV1 | undefined; let candidate: AgentHostStoredCandidateV1 | undefined
  const controlRoot = options.controlRoot ?? AGENT_HOST_CONTROL_ROOT
  const ensureControlRoot = async () => {
    await mkdir(controlRoot, { mode: 0o730 }).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    const handle = await open(controlRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat(); if (!info.isDirectory() || await realpath(`/proc/self/fd/${handle.fd}`) !== controlRoot) failed('controlRoot')
      await handle.chown(options.ownerUid, options.appGid); await handle.chmod(0o730); await handle.sync()
      if (!exact(await handle.stat(), options.ownerUid, options.appGid, 0o730)) failed('controlRoot')
    } finally { await handle.close() }
  }
  const call = async (action: 'prepare' | 'commit' | 'discard' | 'status', operationId?: string) => new Promise<AgentHostPublicationStatusV1>((resolve, reject) => {
    const socket = createConnection(options.socketPath ?? path.join(controlRoot, AGENT_HOST_PUBLICATION_SOCKET_FILE)); let output = ''; let size = 0; let settled = false
    const failCall = (error?: Error) => { if (!settled) { settled = true; reject(error ?? new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'response' })) } }
    socket.setTimeout(options.timeoutMs ?? 5_000, () => socket.destroy()); socket.setEncoding('utf8')
    socket.on('connect', () => socket.end(`${JSON.stringify(operationId ? { action, operationId } : { action })}\n`))
    socket.on('data', (chunk: string) => { size += Buffer.byteLength(chunk); if (size > 2048) socket.destroy(); else output += chunk })
    socket.on('error', (error: NodeJS.ErrnoException) => failCall(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? error : undefined)); socket.on('close', () => failCall()); socket.on('end', () => {
      if (settled) return
      try {
        if (!output.endsWith('\n') || output.slice(0, -1).includes('\n')) return failCall()
        const raw = JSON.parse(output) as { ok?: unknown; status?: unknown }
        if (raw.ok !== true || Object.keys(raw).sort().join(',') !== 'ok,status') return failCall()
        const status = exactStatus(raw.status); settled = true; resolve(status)
      } catch { failCall() }
    })
  })
  const callWhenStarted = async (action: 'prepare' | 'status', operationId?: string) => {
    const deadline = Date.now() + (options.startupTimeoutMs ?? 10_000)
    for (;;) { try { return await call(action, operationId) } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code !== 'ENOENT' && code !== 'ECONNREFUSED') || Date.now() >= deadline) throw error
      await delay(50)
    } }
  }
  const syncRoot = async () => { const root = await open(options.hostRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await root.sync() } finally { await root.close() } }
  const install = async (value: AgentHostPendingPublicationV1) => {
    const stage = path.join(options.hostRoot, `.pending.${randomUUID()}`); const target = path.join(options.hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE)
    const handle = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.chown(options.ownerUid, options.appGid); await handle.chmod(0o440); await handle.sync() }
    finally { await handle.close() }
    await rename(stage, target); await syncRoot()
  }
  const requireStatus = (status: AgentHostPublicationStatusV1, durable: string | null, served: string | null, operationId: string) => {
    if (status.durableRevision !== durable || status.servedRevision !== served || status.pendingOperation !== operationId) failed('status')
  }
  const commit = async (operationId: string, target: AgentHostActiveEnvelopeV1) => requireStatus(await call('commit', operationId), target.revisionId, target.revisionId, operationId)
  const discard = async (operationId: string) => {
    const value = await readAgentHostPendingPublication({ root: options.hostRoot, ownerUid: options.ownerUid, appGid: options.appGid }); if (!value) return
    if (value.operationId !== operationId) failed('pending')
    requireStatus(await call('discard', operationId), value.expectedRevision, value.expectedRevision, operationId)
    await unlink(path.join(options.hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE)); await syncRoot()
  }
  return Object.freeze({
    async preload(value: AgentHostStoredCandidateV1, runtimeInputs: readonly AgentHostRuntimeInputsIdentityV1[]) {
      candidate = value; const active = await options.revisionStore.readActive(options.hostId)
      const prior = active ? await options.revisionStore.readComplete(options.hostId, active.revisionId) : null
      if (active && (!prior || prior.desiredStateDigest !== active.desiredStateDigest)) failed('active')
      const nextIds = new Set(value.desired.plan.bindings.map((binding) => binding.bindingId))
      const removals = prior?.desired.plan.bindings.map((binding) => binding.bindingId).filter((bindingId) => !nextIds.has(bindingId)).sort() ?? []
      const rollback = active && removals.length > 0 ? normalizeAgentHostDestructivePublicationIdentity({ operationId: options.operationId, hostId: options.hostId,
        expectedRevision: active.revisionId, expectedDigest: active.desiredStateDigest, targetRevision: value.revisionId,
        targetDigest: value.desiredStateDigest, removalBindingIds: removals }) : null
      pending = parseAgentHostPendingPublication({ schemaVersion: 1, operationId: options.operationId, expectedRevision: active?.revisionId ?? null,
        expectedDigest: active?.desiredStateDigest ?? null, targetRevision: value.revisionId, targetDigest: value.desiredStateDigest,
        runtimeInputs, rollback, state: 'prepared' })
      await ensureControlRoot(); await install(pending); if (!active) await options.startCore?.(value)
      requireStatus(await callWhenStarted('prepare', pending.operationId), active?.revisionId ?? null, active?.revisionId ?? null, pending.operationId)
      return canonicalizeAgentHostObservation({ schemaVersion: 1, domain: 'boring-agent-host-observed:v1', bindings: value.desired.resolvedBindings.map((binding) => ({
        bindingId: binding.bindingId, ready: true, resolvedDigest: binding.resolvedDigest,
        runtimeInputs: runtimeInputs.find((input) => input.bindingId === binding.bindingId),
      })) }, value.desired)
    },
    async verifyActive(active: AgentHostActiveEnvelopeV1) {
      if (!pending || !candidate || pending.targetRevision !== active.revisionId) failed('pending')
      await commit(pending.operationId, active); pending = parseAgentHostPendingPublication({ ...pending, state: 'committed' }); await install(pending)
      if (pending.expectedRevision === null) await options.startIngress?.(candidate)
      await unlink(path.join(options.hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE)); await syncRoot(); pending = undefined; candidate = undefined
    },
    status: () => call('status'), commit, discard,
    async recover() {
      const value = await readAgentHostPendingPublication({ root: options.hostRoot, ownerUid: options.ownerUid, appGid: options.appGid }); if (!value) return
      let status: AgentHostPublicationStatusV1
      try { status = await call('status') } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (value.expectedRevision !== null || code !== 'ENOENT' && code !== 'ECONNREFUSED') throw error
        const staged = await options.revisionStore.readCandidate(options.hostId, value.targetRevision)
        if (!staged || staged.desiredStateDigest !== value.targetDigest) throw error
        await ensureControlRoot(); await options.startCore?.(staged); status = await callWhenStarted('status')
      }
      if (status.pendingOperation !== value.operationId) failed('status')
      if (value.rollback && status.durableRevision === value.expectedRevision && status.servedRevision === value.expectedRevision) return discard(value.operationId)
      if (value.rollback && status.durableRevision === value.expectedRevision) failed('status')
      const complete = await options.revisionStore.readComplete(options.hostId, value.targetRevision)
      if (status.durableRevision === value.expectedRevision && status.servedRevision === value.expectedRevision && !complete) return discard(value.operationId)
      if (!complete || complete.desiredStateDigest !== value.targetDigest) failed('status')
      if (status.durableRevision === value.expectedRevision && status.servedRevision === value.expectedRevision) {
        const active = await options.revisionStore.publishActive(options.hostId, value.targetRevision); await commit(value.operationId, active)
      } else if (status.durableRevision === value.targetRevision && status.servedRevision === value.expectedRevision) {
        await commit(value.operationId, { schemaVersion: 1, revisionId: value.targetRevision, desiredStateDigest: value.targetDigest })
      } else if (status.durableRevision !== value.targetRevision || status.servedRevision !== value.targetRevision) failed('status')
      const committed = value.state === 'committed' ? value : parseAgentHostPendingPublication({ ...value, state: 'committed' }); if (committed !== value) await install(committed)
      if (value.expectedRevision === null && complete) await options.startIngress?.(complete)
      await unlink(path.join(options.hostRoot, AGENT_HOST_PENDING_PUBLICATION_FILE)); await syncRoot()
    },
  })
}
