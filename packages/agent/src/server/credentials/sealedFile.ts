import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs'
import path from 'node:path'

export type SealedHostFileReadResultV1 =
  | Readonly<{ ok: true; bytes: Buffer }>
  | Readonly<{ ok: false; reasonCode: string }>

export function readSealedHostFileV1(
  filePath: string,
  options: Readonly<{
    expectedOwnerUid?: number
    maximumBytes: number
    exactBytes?: number
  }>,
): SealedHostFileReadResultV1 {
  if (
    typeof filePath !== 'string'
    || !path.isAbsolute(filePath)
    || path.normalize(filePath) !== filePath
    || /[\0-\x1f\x7f]/.test(filePath)
  ) {
    return { ok: false, reasonCode: 'SEALED_FILE_PATH_INVALID' }
  }
  const expectedOwnerUid = options.expectedOwnerUid
    ?? (typeof process.geteuid === 'function' ? process.geteuid() : -1)
  if (
    !Number.isSafeInteger(expectedOwnerUid)
    || expectedOwnerUid < 0
    || !Number.isSafeInteger(options.maximumBytes)
    || options.maximumBytes <= 0
    || (
      options.exactBytes !== undefined
      && (
        !Number.isSafeInteger(options.exactBytes)
        || options.exactBytes <= 0
        || options.exactBytes > options.maximumBytes
      )
    )
  ) {
    return { ok: false, reasonCode: 'SEALED_FILE_POLICY_INVALID' }
  }

  let fd: number | undefined
  let buffer: Buffer | undefined
  let reasonCode: string | undefined
  try {
    fd = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const stat = fstatSync(fd)
    if (
      !stat.isFile()
      || stat.nlink !== 1
      || stat.uid !== expectedOwnerUid
      || (stat.mode & 0o7777) !== 0o400
      || stat.size <= 0
      || stat.size > options.maximumBytes
      || (
        options.exactBytes !== undefined
        && stat.size !== options.exactBytes
      )
    ) {
      reasonCode = 'SEALED_FILE_METADATA_INVALID'
    } else {
      buffer = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < buffer.byteLength) {
        const count = readSync(fd, buffer, offset, buffer.byteLength - offset, null)
        if (count === 0) break
        offset += count
      }
      if (offset !== buffer.byteLength) {
        reasonCode = 'SEALED_FILE_READ_INCOMPLETE'
      }
    }
  } catch {
    reasonCode = 'SEALED_FILE_UNREADABLE'
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        reasonCode = 'SEALED_FILE_CLOSE_FAILED'
      }
    }
  }
  if (reasonCode || !buffer) {
    buffer?.fill(0)
    return { ok: false, reasonCode: reasonCode ?? 'SEALED_FILE_UNREADABLE' }
  }
  return { ok: true, bytes: buffer }
}
