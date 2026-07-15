import { constants, type Stats } from 'node:fs'
import { chmod, lstat, open, realpath, unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'

import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { assertD1ExactKeys, d1Digest, D1HostError, D1HostErrorCode, strictD1Ref } from './d1Plan.js'

export const D1_CONTROL_ROOT = '/run/boring/d1-control'
export const D1_PENDING_PUBLICATION_FILE = 'pending'
export const D1_PUBLICATION_SOCKET_FILE = 'publication.sock'
const MAX_FRAME_BYTES = 512
const MAX_PENDING_BYTES = 512 * 1024
const REVISION_RE = /^r\d{10}$/

export interface D1PendingPublicationV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly expectedRevision: string | null
  readonly expectedDigest: Sha256Digest | null
  readonly targetRevision: string
  readonly targetDigest: Sha256Digest
  readonly runtimeInputs: readonly unknown[]
}
export interface D1PublicationStatusV1 {
  readonly durableRevision: string | null
  readonly servedRevision: string | null
  readonly pendingOperation: string | null
}
export interface D1PublicationControlAuthority {
  prepare(operationId: string): Promise<D1PublicationStatusV1>
  commit(operationId: string): Promise<D1PublicationStatusV1>
  status(operationId?: string): Promise<D1PublicationStatusV1>
}

function failed(field = 'publication'): never { throw new D1HostError(D1HostErrorCode.PUBLICATION_FAILED, { field }) }
function revision(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REVISION_RE.test(value)) failed(field)
  return value
}
export function parseD1PendingPublication(raw: unknown): D1PendingPublicationV1 {
  try {
    assertD1ExactKeys(raw, ['schemaVersion', 'operationId', 'expectedRevision', 'expectedDigest', 'targetRevision', 'targetDigest', 'runtimeInputs'], 'pending')
    if (raw.schemaVersion !== 1 || (raw.expectedRevision === null) !== (raw.expectedDigest === null)
      || !Array.isArray(raw.runtimeInputs) || raw.runtimeInputs.length > 20) failed('pending')
    return Object.freeze({ schemaVersion: 1, operationId: strictD1Ref(raw.operationId, 'operationId'),
      expectedRevision: raw.expectedRevision === null ? null : revision(raw.expectedRevision, 'expectedRevision'),
      expectedDigest: raw.expectedDigest === null ? null : d1Digest(raw.expectedDigest, 'expectedDigest'),
      targetRevision: revision(raw.targetRevision, 'targetRevision'), targetDigest: d1Digest(raw.targetDigest, 'targetDigest'),
      runtimeInputs: Object.freeze(structuredClone(raw.runtimeInputs)) })
  } catch { failed('pending') }
}
function exact(info: Stats, uid: number, gid: number, mode: number): boolean {
  return info.uid === uid && info.gid === gid && (info.mode & 0o7777) === mode
}
export async function readD1PendingPublication(options: {
  readonly root?: string; readonly ownerUid: number; readonly appGid: number
}): Promise<D1PendingPublicationV1 | null> {
  const root = options.root ?? D1_CONTROL_ROOT; const file = path.join(root, D1_PENDING_PUBLICATION_FILE)
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
    return parseD1PendingPublication(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown)
  } catch (error) { if (error instanceof D1HostError) throw error; return failed('pending') }
  finally { await handle?.close() }
}
function request(raw: unknown): Readonly<{ action: 'prepare' | 'commit' | 'status'; operationId?: string }> {
  try {
    if (typeof raw !== 'object' || raw === null) failed('request')
    const action = (raw as { action?: unknown }).action
    if (action === 'status') {
      assertD1ExactKeys(raw, ['action'], 'request'); return Object.freeze({ action })
    }
    if (action !== 'prepare' && action !== 'commit') failed('request')
    assertD1ExactKeys(raw, ['action', 'operationId'], 'request')
    return Object.freeze({ action, operationId: strictD1Ref((raw as { operationId?: unknown }).operationId, 'operationId') })
  } catch { failed('request') }
}
function serveSocket(socket: Socket, authority: D1PublicationControlAuthority): void {
  let bytes = 0; let frame = ''; let finished = false
  const reject = () => { if (!finished) { finished = true; socket.end(`${JSON.stringify({ ok: false, error: { code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'request' } } })}\n`) } }
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
          : value.action === 'commit' ? await authority.commit(value.operationId!) : await authority.status()
        socket.end(`${JSON.stringify({ ok: true, status })}\n`)
      } catch { socket.end(`${JSON.stringify({ ok: false, error: { code: D1HostErrorCode.PUBLICATION_FAILED, details: { field: 'request' } } })}\n`) }
    })()
  }); socket.on('error', () => {})
}
export async function startD1PublicationControlServer(authority: D1PublicationControlAuthority, options: {
  readonly root?: string; readonly ownerUid: number; readonly appUid?: number; readonly appGid: number
}): Promise<Server> {
  const root = options.root ?? D1_CONTROL_ROOT; const socketPath = path.join(root, D1_PUBLICATION_SOCKET_FILE)
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
