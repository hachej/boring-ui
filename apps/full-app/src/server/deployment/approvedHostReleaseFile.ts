import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { decodeApprovedD1HostReleaseRecord, type ApprovedD1HostReleaseRecordV1 } from './approvedHostRelease.js'
import { D1HostError, D1HostErrorCode, strictD1HostId } from './d1Plan.js'

export const D1_APPROVED_HOST_RELEASE_ROOT = '/etc/boring/d1/approved-host-releases'
export const D1_APPROVED_HOST_RELEASE_MAX_BYTES = 64 * 1024

const DIRECTORY_MODE = 0o755
const FILE_MODE = 0o444
const ROOT_UID = 0
const ROOT_GID = 0
const OPEN_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const OPEN_FILE = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

export interface D1ApprovedHostReleaseFileReader {
  read(hostId: string): Promise<ApprovedD1HostReleaseRecordV1>
}

export interface D1ApprovedHostReleaseFilePolicy {
  readonly directoryPath: string
  readonly directoryUid: number
  readonly directoryGid: number
  readonly directoryMode: number
  readonly fileUid: number
  readonly fileGid: number
  readonly fileMode: number
  readonly maxBytes: number
}

export const D1_APPROVED_HOST_RELEASE_AUTHORITY_POLICY: Readonly<D1ApprovedHostReleaseFilePolicy> = Object.freeze({
  directoryPath: D1_APPROVED_HOST_RELEASE_ROOT,
  directoryUid: ROOT_UID,
  directoryGid: ROOT_GID,
  directoryMode: DIRECTORY_MODE,
  fileUid: ROOT_UID,
  fileGid: ROOT_GID,
  fileMode: FILE_MODE,
  maxBytes: D1_APPROVED_HOST_RELEASE_MAX_BYTES,
})

function unavailable(): never {
  throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'approvedHostRelease' })
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function exactMetadata(info: Stats, uid: number, gid: number, mode: number): boolean {
  return info.uid === uid && info.gid === gid && (info.mode & 0o7777) === mode
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  try { await handle?.close() } catch {}
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(maxBytes + 1)
  let offset = 0
  while (offset < bytes.byteLength) {
    const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  if (offset > maxBytes) throw new Error('file too large')
  return bytes.slice(0, offset)
}

function validPolicy(value: unknown): Readonly<D1ApprovedHostReleaseFilePolicy> {
  if (!value || typeof value !== 'object') throw new Error('policy')
  const input = value as D1ApprovedHostReleaseFilePolicy
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
  if (typeof directoryPath !== 'string' || directoryPath.includes('\0') || !path.isAbsolute(directoryPath)
    || path.resolve(directoryPath) !== directoryPath || ids.some((id) => !Number.isSafeInteger(id) || id < 0)
    || modes.some((mode) => !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > D1_APPROVED_HOST_RELEASE_MAX_BYTES) throw new Error('policy')
  return Object.freeze({ directoryPath, directoryUid, directoryGid, directoryMode, fileUid, fileGid, fileMode, maxBytes })
}

async function openVerifiedDirectory(policy: Readonly<D1ApprovedHostReleaseFilePolicy>): Promise<FileHandle> {
  const before = await lstat(policy.directoryPath)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('directory')
  const handle = await open(policy.directoryPath, OPEN_DIRECTORY)
  try {
    const after = await handle.stat()
    const anchored = `/proc/self/fd/${handle.fd}`
    if (!after.isDirectory() || !sameIdentity(before, after)
      || !exactMetadata(after, policy.directoryUid, policy.directoryGid, policy.directoryMode)
      || await realpath(anchored) !== policy.directoryPath) throw new Error('directory')
    return handle
  } catch (error) {
    await closeQuietly(handle)
    throw error
  }
}

async function readVerifiedRecord(
  directory: FileHandle,
  hostId: string,
  policy: Readonly<D1ApprovedHostReleaseFilePolicy>,
): Promise<ApprovedD1HostReleaseRecordV1> {
  const fileName = `${hostId}.json`
  const expectedPath = path.join(policy.directoryPath, fileName)
  const directoryAnchor = `/proc/self/fd/${directory.fd}`
  const initialDirectory = await directory.stat()
  if (!initialDirectory.isDirectory()
    || !exactMetadata(initialDirectory, policy.directoryUid, policy.directoryGid, policy.directoryMode)) throw new Error('directory')
  const handle = await open(path.join(directoryAnchor, fileName), OPEN_FILE)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || !exactMetadata(initial, policy.fileUid, policy.fileGid, policy.fileMode)
      || initial.nlink !== 1 || initial.size < 1 || initial.size > policy.maxBytes
      || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error('file')
    const bytes = await readBounded(handle, policy.maxBytes)
    const final = await handle.stat()
    const finalDirectory = await directory.stat()
    if (!final.isFile() || !sameIdentity(initial, final)
      || !exactMetadata(final, policy.fileUid, policy.fileGid, policy.fileMode)
      || final.nlink !== 1 || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs
      || final.ctimeMs !== initial.ctimeMs || bytes.byteLength !== initial.size
      || !finalDirectory.isDirectory() || !sameIdentity(initialDirectory, finalDirectory)
      || !exactMetadata(finalDirectory, policy.directoryUid, policy.directoryGid, policy.directoryMode)
      || await realpath(directoryAnchor) !== policy.directoryPath
      || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error('file changed')
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    return decodeApprovedD1HostReleaseRecord(raw)
  } finally {
    await closeQuietly(handle)
  }
}

/** Trusted policy seam for filesystem tests. It reads a record and never mints release authority. */
export function createD1ApprovedHostReleaseFileReaderForPolicy(
  input: D1ApprovedHostReleaseFilePolicy,
): D1ApprovedHostReleaseFileReader {
  let policy: Readonly<D1ApprovedHostReleaseFilePolicy>
  try { policy = validPolicy(input) } catch { return unavailable() }
  return Object.freeze({
    async read(rawHostId: string): Promise<ApprovedD1HostReleaseRecordV1> {
      let directory: FileHandle | undefined
      try {
        const hostId = strictD1HostId(rawHostId, 'hostId')
        directory = await openVerifiedDirectory(policy)
        return await readVerifiedRecord(directory, hostId, policy)
      } catch { return unavailable() } finally { await closeQuietly(directory) }
    },
  })
}

const productionReader = createD1ApprovedHostReleaseFileReaderForPolicy(D1_APPROVED_HOST_RELEASE_AUTHORITY_POLICY)

export async function readApprovedD1HostReleaseFile(hostId: string): Promise<ApprovedD1HostReleaseRecordV1> {
  return productionReader.read(hostId)
}
