import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { AgentHostError, AgentHostErrorCode } from './agentHostPlan.js'

export const AGENT_HOST_CADDYFILE_PATH = '/opt/boring/agent-host/Caddyfile'
export const AGENT_HOST_CADDYFILE_MAX_BYTES = 64 * 1024

const CADDYFILE_NAME = 'Caddyfile'
const OPEN_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const OPEN_FILE = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

export interface AgentHostCaddyfileAuthorityReader {
  read(): Promise<Uint8Array>
}

export interface AgentHostCaddyfileAuthorityPolicy {
  readonly directoryPath: string
  readonly directoryUid: number
  readonly directoryGid: number
  readonly directoryMode: number
  readonly fileUid: number
  readonly fileGid: number
  readonly fileMode: number
  readonly maxBytes: number
}

export const AGENT_HOST_CADDYFILE_AUTHORITY_POLICY: Readonly<AgentHostCaddyfileAuthorityPolicy> = Object.freeze({
  directoryPath: path.dirname(AGENT_HOST_CADDYFILE_PATH),
  directoryUid: 0,
  directoryGid: 0,
  directoryMode: 0o755,
  fileUid: 0,
  fileGid: 0,
  fileMode: 0o444,
  maxBytes: AGENT_HOST_CADDYFILE_MAX_BYTES,
})

function unavailable(): never {
  throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'caddyfile' })
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameVersion(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

function exactMetadata(info: Stats, uid: number, gid: number, mode: number): boolean {
  return info.uid === uid && info.gid === gid && (info.mode & 0o7777) === mode
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  try { await handle?.close() } catch {}
}

function validPolicy(value: unknown): Readonly<AgentHostCaddyfileAuthorityPolicy> {
  if (!value || typeof value !== 'object') throw new Error('policy')
  const input = value as AgentHostCaddyfileAuthorityPolicy
  const directoryPath = input.directoryPath
  const directoryUid = input.directoryUid
  const directoryGid = input.directoryGid
  const directoryMode = input.directoryMode
  const fileUid = input.fileUid
  const fileGid = input.fileGid
  const fileMode = input.fileMode
  const maxBytes = input.maxBytes
  const ids = [directoryUid, directoryGid, fileUid, fileGid]
  const modes = [directoryMode, fileMode]
  if (typeof directoryPath !== 'string' || directoryPath.includes('\0')
    || !path.isAbsolute(directoryPath) || path.resolve(directoryPath) !== directoryPath
    || ids.some((id) => !Number.isSafeInteger(id) || id < 0)
    || modes.some((mode) => !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > AGENT_HOST_CADDYFILE_MAX_BYTES) throw new Error('policy')
  return Object.freeze({ directoryPath, directoryUid, directoryGid, directoryMode, fileUid, fileGid, fileMode, maxBytes })
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Uint8Array> {
  const allocation = new Uint8Array(maxBytes + 1)
  let offset = 0
  while (offset < allocation.byteLength) {
    const { bytesRead } = await handle.read(allocation, offset, allocation.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > maxBytes) throw new Error('file too large')
  return allocation.slice(0, offset)
}

async function openDirectory(policy: Readonly<AgentHostCaddyfileAuthorityPolicy>): Promise<{
  handle: FileHandle
  initial: Stats
}> {
  const pathBefore = await lstat(policy.directoryPath)
  if (!pathBefore.isDirectory() || pathBefore.isSymbolicLink()) throw new Error('directory')
  const handle = await open(policy.directoryPath, OPEN_DIRECTORY)
  try {
    const initial = await handle.stat()
    if (!initial.isDirectory() || !sameIdentity(pathBefore, initial)
      || !exactMetadata(initial, policy.directoryUid, policy.directoryGid, policy.directoryMode)
      || await realpath(`/proc/self/fd/${handle.fd}`) !== policy.directoryPath) throw new Error('directory')
    return { handle, initial }
  } catch (error) {
    await closeQuietly(handle)
    throw error
  }
}

async function readFile(directory: FileHandle, policy: Readonly<AgentHostCaddyfileAuthorityPolicy>): Promise<Uint8Array> {
  const expectedPath = path.join(policy.directoryPath, CADDYFILE_NAME)
  const directoryAnchor = `/proc/self/fd/${directory.fd}`
  const pathBefore = await lstat(expectedPath)
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()
    || !exactMetadata(pathBefore, policy.fileUid, policy.fileGid, policy.fileMode)
    || pathBefore.nlink !== 1 || pathBefore.size < 1 || pathBefore.size > policy.maxBytes) throw new Error('file')
  const handle = await open(path.join(directoryAnchor, CADDYFILE_NAME), OPEN_FILE)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || !sameVersion(pathBefore, initial)
      || !exactMetadata(initial, policy.fileUid, policy.fileGid, policy.fileMode)
      || initial.nlink !== 1 || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error('file')
    const bytes = await readBounded(handle, policy.maxBytes)
    const final = await handle.stat()
    const pathAfter = await lstat(expectedPath)
    if (!final.isFile() || !sameVersion(initial, final) || !sameVersion(initial, pathAfter)
      || !exactMetadata(final, policy.fileUid, policy.fileGid, policy.fileMode)
      || !exactMetadata(pathAfter, policy.fileUid, policy.fileGid, policy.fileMode)
      || final.nlink !== 1 || pathAfter.nlink !== 1 || bytes.byteLength !== initial.size
      || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error('file changed')
    return bytes
  } finally {
    await closeQuietly(handle)
  }
}

async function verifyDirectoryAfter(
  handle: FileHandle,
  initial: Stats,
  policy: Readonly<AgentHostCaddyfileAuthorityPolicy>,
): Promise<void> {
  const final = await handle.stat()
  const pathAfter = await lstat(policy.directoryPath)
  if (!final.isDirectory() || !sameIdentity(initial, final) || !sameIdentity(initial, pathAfter)
    || !exactMetadata(final, policy.directoryUid, policy.directoryGid, policy.directoryMode)
    || !exactMetadata(pathAfter, policy.directoryUid, policy.directoryGid, policy.directoryMode)
    || await realpath(`/proc/self/fd/${handle.fd}`) !== policy.directoryPath) throw new Error('directory changed')
}

/** Trusted policy seam for filesystem tests. It cannot change the fixed Caddyfile basename. */
export function createAgentHostCaddyfileAuthorityReaderForPolicy(input: AgentHostCaddyfileAuthorityPolicy): AgentHostCaddyfileAuthorityReader {
  let policy: Readonly<AgentHostCaddyfileAuthorityPolicy>
  try { policy = validPolicy(input) } catch { return unavailable() }
  return Object.freeze({
    async read(): Promise<Uint8Array> {
      let directory: FileHandle | undefined
      try {
        const opened = await openDirectory(policy)
        directory = opened.handle
        const bytes = await readFile(directory, policy)
        await verifyDirectoryAfter(directory, opened.initial, policy)
        return bytes
      } catch { return unavailable() } finally { await closeQuietly(directory) }
    },
  })
}

const productionReader = createAgentHostCaddyfileAuthorityReaderForPolicy(AGENT_HOST_CADDYFILE_AUTHORITY_POLICY)

export async function readAgentHostCaddyfileAuthority(): Promise<Uint8Array> {
  return productionReader.read()
}
