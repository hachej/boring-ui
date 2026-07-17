import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { AgentHostError, AgentHostErrorCode } from './agentHostPlan.js'

export const AGENT_HOST_CORE_ENV_PATH = '/etc/boring/agent-host/core.env'
export const AGENT_HOST_CORE_ENV_MAX_BYTES = 64 * 1024

const CORE_ENV_NAME = 'core.env'
const OPEN_DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const OPEN_FILE = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const CORE_ENV_KEYS = [
  'BORING_AGENT_HOST_OWNER_UID',
  'DATABASE_URL_FILE',
  'BETTER_AUTH_SECRET_FILE',
  'WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE',
  'BORING_PLUGIN_AUTHORING',
  'BETTER_AUTH_URL',
  'CORS_ORIGINS',
  'CSP_ENABLED',
  'CSP_UPGRADE_INSECURE_REQUESTS',
  'SESSION_COOKIE_SECURE',
  'BORING_MCP_PROD_ENABLED',
  'BORING_MANAGED_AGENT_MCP_ENABLED',
  'BORING_AGENT_HOST_MAX_BINDINGS',
  'BORING_AGENT_HOST_MAX_BUNDLE_BYTES',
  'BORING_AGENT_HOST_MAX_TOTAL_BUNDLE_BYTES',
  'BORING_AGENT_HOST_MAX_CONCURRENT_PRELOADS',
] as const
const FIXED_VALUES = Object.freeze({
  DATABASE_URL_FILE: '/run/boring/agent-host/host-secrets/database-url',
  BETTER_AUTH_SECRET_FILE: '/run/boring/agent-host/host-secrets/better-auth-secret',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE: '/run/boring/agent-host/host-secrets/workspace-settings-encryption-key',
  BORING_PLUGIN_AUTHORING: '0',
  CSP_ENABLED: 'true',
  CSP_UPGRADE_INSECURE_REQUESTS: 'true',
  SESSION_COOKIE_SECURE: 'true',
  BORING_MANAGED_AGENT_MCP_ENABLED: '0',
})
const CANONICAL_VALUE = /^[\x21-\x7e]+$/
const FORBIDDEN_VALUE_CHARACTERS = /["'#$\\]/

export type AgentHostCoreEnvV1 = Readonly<Record<(typeof CORE_ENV_KEYS)[number], string>>

export interface AgentHostCoreEnvAuthorityReader {
  read(): Promise<AgentHostCoreEnvV1>
}

export interface AgentHostCoreEnvAuthorityPolicy {
  readonly directoryPath: string
  readonly directoryUid: number
  readonly directoryGid: number
  readonly directoryMode: number
  readonly fileUid: number
  readonly fileGid: number
  readonly fileMode: number
  readonly maxBytes: number
}

export const AGENT_HOST_CORE_ENV_AUTHORITY_POLICY: Readonly<AgentHostCoreEnvAuthorityPolicy> = Object.freeze({
  directoryPath: path.dirname(AGENT_HOST_CORE_ENV_PATH),
  directoryUid: 0,
  directoryGid: 0,
  directoryMode: 0o755,
  fileUid: 0,
  fileGid: 0,
  fileMode: 0o444,
  maxBytes: AGENT_HOST_CORE_ENV_MAX_BYTES,
})

function unavailable(): never {
  throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field: 'coreEnv' })
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameVersion(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right) && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
}

function exactMetadata(info: Stats, uid: number, gid: number, mode: number): boolean {
  return info.uid === uid && info.gid === gid && (info.mode & 0o7777) === mode
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  try { await handle?.close() } catch {}
}

function validPolicy(value: unknown): Readonly<AgentHostCoreEnvAuthorityPolicy> {
  if (!value || typeof value !== 'object') throw new Error()
  const input = value as AgentHostCoreEnvAuthorityPolicy
  const policy = {
    directoryPath: input.directoryPath,
    directoryUid: input.directoryUid,
    directoryGid: input.directoryGid,
    directoryMode: input.directoryMode,
    fileUid: input.fileUid,
    fileGid: input.fileGid,
    fileMode: input.fileMode,
    maxBytes: input.maxBytes,
  }
  const ids = [policy.directoryUid, policy.directoryGid, policy.fileUid, policy.fileGid]
  const modes = [policy.directoryMode, policy.fileMode]
  if (typeof policy.directoryPath !== 'string' || policy.directoryPath.includes('\0')
    || !path.isAbsolute(policy.directoryPath) || path.resolve(policy.directoryPath) !== policy.directoryPath
    || ids.some((id) => !Number.isSafeInteger(id) || id < 0)
    || modes.some((mode) => !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777)
    || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1
    || policy.maxBytes > AGENT_HOST_CORE_ENV_MAX_BYTES) throw new Error()
  return Object.freeze(policy)
}

function parseCoreEnv(bytes: Uint8Array): AgentHostCoreEnvV1 {
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const parsed = parseEnv(content)
  if (Object.keys(parsed).length !== CORE_ENV_KEYS.length) throw new Error()
  const snapshot = Object.create(null) as Record<string, string>
  for (const key of CORE_ENV_KEYS) {
    const value = parsed[key]
    if (typeof value !== 'string' || !CANONICAL_VALUE.test(value)
      || FORBIDDEN_VALUE_CHARACTERS.test(value)) throw new Error()
    snapshot[key] = value
  }
  for (const [key, value] of Object.entries(FIXED_VALUES)) {
    if (snapshot[key] !== value) throw new Error()
  }
  if (snapshot.BORING_MCP_PROD_ENABLED !== '0' && snapshot.BORING_MCP_PROD_ENABLED !== '1') throw new Error()
  const canonical = CORE_ENV_KEYS.map((key) => `${key}=${snapshot[key]}`).join('\n') + '\n'
  if (content !== canonical) throw new Error()
  return Object.freeze(snapshot) as AgentHostCoreEnvV1
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Uint8Array> {
  const allocation = new Uint8Array(maxBytes + 1)
  let offset = 0
  while (offset < allocation.byteLength) {
    const { bytesRead } = await handle.read(allocation, offset, allocation.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > maxBytes) throw new Error()
  return allocation.slice(0, offset)
}

async function openDirectory(policy: Readonly<AgentHostCoreEnvAuthorityPolicy>): Promise<{ handle: FileHandle; initial: Stats }> {
  const before = await lstat(policy.directoryPath)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error()
  const handle = await open(policy.directoryPath, OPEN_DIRECTORY)
  try {
    const initial = await handle.stat()
    if (!initial.isDirectory() || !sameIdentity(before, initial)
      || !exactMetadata(initial, policy.directoryUid, policy.directoryGid, policy.directoryMode)
      || await realpath(`/proc/self/fd/${handle.fd}`) !== policy.directoryPath) throw new Error()
    return { handle, initial }
  } catch (error) { await closeQuietly(handle); throw error }
}

async function readFile(directory: FileHandle, policy: Readonly<AgentHostCoreEnvAuthorityPolicy>): Promise<AgentHostCoreEnvV1> {
  const expectedPath = path.join(policy.directoryPath, CORE_ENV_NAME)
  const before = await lstat(expectedPath)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || !exactMetadata(before, policy.fileUid, policy.fileGid, policy.fileMode)
    || before.size < 1 || before.size > policy.maxBytes) throw new Error()
  const handle = await open(`/proc/self/fd/${directory.fd}/${CORE_ENV_NAME}`, OPEN_FILE)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || !sameVersion(before, initial) || initial.nlink !== 1
      || !exactMetadata(initial, policy.fileUid, policy.fileGid, policy.fileMode)
      || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error()
    const bytes = await readBounded(handle, policy.maxBytes)
    const final = await handle.stat()
    const after = await lstat(expectedPath)
    if (!final.isFile() || !sameVersion(initial, final) || !sameVersion(initial, after)
      || !exactMetadata(final, policy.fileUid, policy.fileGid, policy.fileMode)
      || !exactMetadata(after, policy.fileUid, policy.fileGid, policy.fileMode)
      || final.nlink !== 1 || after.nlink !== 1 || bytes.byteLength !== initial.size
      || await realpath(`/proc/self/fd/${handle.fd}`) !== expectedPath) throw new Error()
    return parseCoreEnv(bytes)
  } finally { await closeQuietly(handle) }
}

async function verifyDirectory(handle: FileHandle, initial: Stats, policy: Readonly<AgentHostCoreEnvAuthorityPolicy>): Promise<void> {
  const final = await handle.stat()
  const after = await lstat(policy.directoryPath)
  if (!final.isDirectory() || !sameVersion(initial, final) || !sameVersion(initial, after)
    || !exactMetadata(final, policy.directoryUid, policy.directoryGid, policy.directoryMode)
    || !exactMetadata(after, policy.directoryUid, policy.directoryGid, policy.directoryMode)
    || await realpath(`/proc/self/fd/${handle.fd}`) !== policy.directoryPath) throw new Error()
}

/** Trusted policy seam for filesystem tests; the core.env basename stays fixed. */
export function createAgentHostCoreEnvAuthorityReaderForPolicy(input: AgentHostCoreEnvAuthorityPolicy): AgentHostCoreEnvAuthorityReader {
  let policy: Readonly<AgentHostCoreEnvAuthorityPolicy>
  try { policy = validPolicy(input) } catch { return unavailable() }
  return Object.freeze({
    async read(): Promise<AgentHostCoreEnvV1> {
      let directory: FileHandle | undefined
      try {
        const opened = await openDirectory(policy)
        directory = opened.handle
        const env = await readFile(directory, policy)
        await verifyDirectory(directory, opened.initial, policy)
        return env
      } catch { return unavailable() } finally { await closeQuietly(directory) }
    },
  })
}

const productionReader = createAgentHostCoreEnvAuthorityReaderForPolicy(AGENT_HOST_CORE_ENV_AUTHORITY_POLICY)

export async function readAgentHostCoreEnvAuthority(): Promise<AgentHostCoreEnvV1> {
  return productionReader.read()
}
