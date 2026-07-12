import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import path from 'node:path'

import { ConfigValidationError } from '../../shared/errors.js'

const MAX_SECRET_BYTES = 64 * 1024
const SECRET_PAIRS = [
  ['DATABASE_URL', 'DATABASE_URL_FILE'],
  ['BETTER_AUTH_SECRET', 'BETTER_AUTH_SECRET_FILE'],
  ['WORKSPACE_SETTINGS_ENCRYPTION_KEY', 'WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE'],
] as const

type SecretVariable = (typeof SECRET_PAIRS)[number][0]
export type FileSecretVariable = (typeof SECRET_PAIRS)[number][1]

function invalid(variable: FileSecretVariable, message = 'secret file is invalid'): never {
  throw new ConfigValidationError([{ message, path: ['env', variable] }])
}

function decodeSecret(bytes: Uint8Array): string | undefined {
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  if (value.endsWith('\n')) value = value.slice(0, -1)
  if (!value || /[\0\r\n]/.test(value)) return undefined
  return value
}

export function readConfigFileSecret(
  variable: FileSecretVariable,
  filePath: string,
  options: { readonly expectedOwnerUid?: number } = {},
): string {
  if (!path.isAbsolute(filePath) || path.normalize(filePath) !== filePath || /[\0-\x1f\x7f]/.test(filePath)) invalid(variable)
  const expectedOwnerUid = options.expectedOwnerUid ?? (typeof process.geteuid === 'function' ? process.geteuid() : -1)
  if (!Number.isSafeInteger(expectedOwnerUid) || expectedOwnerUid < 0) invalid(variable)

  let fd: number | undefined
  let failure = false
  let value: string | undefined
  try {
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== expectedOwnerUid ||
      (stat.mode & 0o7777) !== 0o400 ||
      stat.size > MAX_SECRET_BYTES
    ) {
      failure = true
    } else {
      const buffer = Buffer.allocUnsafe(MAX_SECRET_BYTES + 1)
      let length = 0
      while (length <= MAX_SECRET_BYTES) {
        const read = readSync(fd, buffer, length, buffer.length - length, null)
        if (read === 0) break
        length += read
      }
      if (length > MAX_SECRET_BYTES) failure = true
      else {
        value = decodeSecret(buffer.subarray(0, length))
        if (value === undefined) failure = true
      }
    }
  } catch {
    failure = true
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { failure = true }
  }
  if (failure || value === undefined) invalid(variable)
  return value
}

export function resolveConfigFileSecrets(env: Readonly<Record<string, string | undefined>>): Readonly<Partial<Record<SecretVariable, string>>> {
  const values: Partial<Record<SecretVariable, string>> = {}
  for (const [variable, fileVariable] of SECRET_PAIRS) {
    if (env[variable] !== undefined && env[fileVariable] !== undefined) {
      invalid(fileVariable, `${variable} and ${fileVariable} cannot both be set`)
    }
    if (env[fileVariable] !== undefined)
      values[variable] = readConfigFileSecret(fileVariable, env[fileVariable])
  }
  return Object.freeze(values)
}
