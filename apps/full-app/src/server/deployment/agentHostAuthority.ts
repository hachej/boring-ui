import { constants, type Stats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { AgentHostError, AgentHostErrorCode, strictAgentHostId, strictAgentHostRef } from './agentHostPlan.js'

export const AGENT_HOST_AUTHORITY_FILE_ENV = 'BORING_AGENT_HOST_AUTHORITY_FILE'
export const AGENT_HOST_AUTHORITY_MAX_BYTES = 64 * 1024
export const AGENT_HOST_PRODUCTION_PROJECT = 'boring-agent-host'
export const AGENT_HOST_PRODUCTION_CONFIG_ROOT = '/opt/boring/agent-host'
export const AGENT_HOST_PRODUCTION_STATE_ROOT = '/var/lib/boring/agent-host'
export const AGENT_HOST_PRODUCTION_MATERIALIZED_ROOT = '/run/boring/agent-host'
export const AGENT_HOST_PRODUCTION_CONTROL_ROOT = '/run/boring/agent-host/control'
export const AGENT_HOST_PRODUCTION_WORKSPACE_VOLUME = 'agent-host-workspaces'
export const AGENT_HOST_PRODUCTION_SESSION_VOLUME = 'agent-host-sessions'

const DOMAIN = 'boring-agent-host-authority:v1' as const
const MAX_PATH_BYTES = 4096
const PROOF_REF_RE = /^agent-host-proof-[a-z0-9][a-z0-9-]{0,47}$/
const PROOF_DATABASE_RE = /^agent_host_proof_[a-z0-9][a-z0-9_]{0,47}$/
const FORBIDDEN_ROOTS = [
  AGENT_HOST_PRODUCTION_CONFIG_ROOT,
  AGENT_HOST_PRODUCTION_STATE_ROOT,
  AGENT_HOST_PRODUCTION_MATERIALIZED_ROOT,
  '/data/workspaces',
  '/data/pi-sessions',
] as const

export interface AgentHostRuntimeAuthorityV1 {
  readonly ref: string
  readonly id: 'runsc'
  readonly launcher: 'docker-runsc'
  readonly privilegeModel: 'docker-runsc-nonroot'
  readonly composeRuntime: 'runsc'
}

interface AgentHostAuthorityBase {
  readonly schemaVersion: 1
  readonly domain: typeof DOMAIN
  readonly hostId: string
  readonly operatorUid: number
  readonly composeProject: string
  readonly configRoot: string
  readonly stateRoot: string
  readonly materializedRoot: string
  readonly controlRoot: string
  readonly lockRoot: string
  readonly secretRoot: string
  readonly workspaceRoot: string
  readonly sessionRoot: string
  readonly databaseUrlFile: string
  readonly databaseRef: string | null
  readonly runtimeProfile: AgentHostRuntimeAuthorityV1 | null
}

export interface AgentHostProductionAuthorityDescriptorV1 extends AgentHostAuthorityBase {
  readonly mode: 'production'
}

export interface AgentHostIsolatedAuthorityDescriptorV1 extends AgentHostAuthorityBase {
  readonly mode: 'isolated-proof'
  readonly authorityRoot: string
  readonly databaseRef: string
  readonly runtimeProfile: AgentHostRuntimeAuthorityV1
}

export type AgentHostAuthorityDescriptorV1 = AgentHostProductionAuthorityDescriptorV1 | AgentHostIsolatedAuthorityDescriptorV1

const capabilityBrand: unique symbol = Symbol('AgentHostAuthorityCapability')
const authorityCapabilities = new WeakSet<object>()
export type AgentHostAuthorityCapability = AgentHostAuthorityDescriptorV1 & { readonly [capabilityBrand]: true }

export interface OpenedAgentHostAuthority {
  readonly authority: AgentHostAuthorityCapability & AgentHostIsolatedAuthorityDescriptorV1
  readonly handle: FileHandle
}

const DESCRIPTOR_KEYS = [
  'schemaVersion', 'domain', 'mode', 'authorityRoot', 'hostId', 'operatorUid', 'composeProject', 'configRoot', 'stateRoot',
  'materializedRoot', 'controlRoot', 'lockRoot', 'secretRoot', 'workspaceRoot', 'sessionRoot', 'databaseUrlFile', 'databaseRef',
  'runtimeProfile',
] as const
const RUNTIME_KEYS = ['ref', 'id', 'launcher', 'privilegeModel', 'composeRuntime'] as const

function invalid(field = 'authority'): never {
  throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field })
}
function dataRecord(value: unknown, keys: readonly string[], field = 'authority'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(field)
  const actual = Reflect.ownKeys(value)
  if (actual.some((key) => typeof key !== 'string') || actual.length !== keys.length || keys.some((key) => !actual.includes(key))) invalid(field)
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(field)
    result[key] = descriptor.value
  }
  return result
}
function absolute(value: unknown, field = 'authority'): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > MAX_PATH_BYTES || value.includes('\0')
    || !path.isAbsolute(value) || path.resolve(value) !== value || value === '/') invalid(field)
  return value
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
export function agentHostAuthorityPathsOverlap(left: string, right: string): boolean {
  return left === right || isWithin(left, right) || isWithin(right, left)
}
function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}
function mintAuthorityCapability<T extends AgentHostAuthorityDescriptorV1>(value: T): T & AgentHostAuthorityCapability {
  const capability = { ...value } as T & AgentHostAuthorityCapability
  Object.defineProperty(capability, capabilityBrand, { value: true, enumerable: false, configurable: false, writable: false })
  Object.freeze(capability); authorityCapabilities.add(capability)
  return capability
}
export function requireAgentHostAuthorityCapability(value: unknown): AgentHostAuthorityCapability {
  if (!value || typeof value !== 'object' || !authorityCapabilities.has(value)) invalid('authority')
  return value as AgentHostAuthorityCapability
}
function canonicalJson(value: AgentHostIsolatedAuthorityDescriptorV1): string {
  return `${JSON.stringify(value)}\n`
}
function operatorUid(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 0xffff_fffe
    || typeof process.geteuid !== 'function' || process.geteuid() !== value) invalid()
  return value
}
function runtime(value: unknown): AgentHostRuntimeAuthorityV1 {
  const raw = dataRecord(value, RUNTIME_KEYS)
  if (raw.id !== 'runsc' || raw.launcher !== 'docker-runsc' || raw.privilegeModel !== 'docker-runsc-nonroot' || raw.composeRuntime !== 'runsc') invalid()
  return Object.freeze({ ref: strictAgentHostRef(raw.ref, 'authority'), id: 'runsc', launcher: 'docker-runsc', privilegeModel: 'docker-runsc-nonroot', composeRuntime: 'runsc' })
}

export function parseAgentHostIsolatedAuthorityDescriptor(raw: unknown, expectedHostId?: string): AgentHostIsolatedAuthorityDescriptorV1 {
  const value = dataRecord(raw, DESCRIPTOR_KEYS)
  if (value.schemaVersion !== 1 || value.domain !== DOMAIN || value.mode !== 'isolated-proof') invalid()
  const uid = operatorUid(value.operatorUid)
  const authorityRoot = absolute(value.authorityRoot)
  const hostId = strictAgentHostId(value.hostId, 'authority')
  const composeProject = strictAgentHostRef(value.composeProject, 'authority')
  const databaseRef = strictAgentHostRef(value.databaseRef, 'authority')
  if (!PROOF_REF_RE.test(hostId) || !PROOF_REF_RE.test(composeProject) || !PROOF_DATABASE_RE.test(databaseRef)
    || expectedHostId !== undefined && hostId !== expectedHostId) invalid()
  const roots = {
    configRoot: absolute(value.configRoot), stateRoot: absolute(value.stateRoot), materializedRoot: absolute(value.materializedRoot),
    controlRoot: absolute(value.controlRoot), lockRoot: absolute(value.lockRoot), secretRoot: absolute(value.secretRoot),
    workspaceRoot: absolute(value.workspaceRoot), sessionRoot: absolute(value.sessionRoot),
  }
  for (const root of [authorityRoot, ...Object.values(roots)]) {
    if (FORBIDDEN_ROOTS.some((forbidden) => agentHostAuthorityPathsOverlap(root, forbidden))) invalid()
  }
  if (Object.values(roots).some((root) => !isWithin(authorityRoot, root))) invalid()
  const topLevelRoots = Object.values(roots)
  if (topLevelRoots.some((root, index) => topLevelRoots.some((other, otherIndex) => index !== otherIndex && agentHostAuthorityPathsOverlap(root, other)))) invalid()
  const secretRoot = roots.secretRoot
  const databaseUrlFile = absolute(value.databaseUrlFile)
  if (databaseUrlFile !== path.join(secretRoot, 'database-url')) invalid()
  const descriptor = Object.freeze({
    schemaVersion: 1 as const, domain: DOMAIN, mode: 'isolated-proof' as const, authorityRoot, hostId, operatorUid: uid,
    composeProject, configRoot: roots.configRoot, stateRoot: roots.stateRoot, materializedRoot: roots.materializedRoot,
    controlRoot: roots.controlRoot, lockRoot: roots.lockRoot, secretRoot, workspaceRoot: roots.workspaceRoot,
    sessionRoot: roots.sessionRoot, databaseUrlFile, databaseRef, runtimeProfile: runtime(value.runtimeProfile),
  })
  return descriptor
}

async function secureDirectory(directory: string, uid: number, writable: boolean,
  lifecycle?: 'app-storage' | 'control'): Promise<void> {
  const before = await lstat(directory); const mode = before.mode & 0o777
  const owners = lifecycle === 'app-storage' ? [uid, 10001] : writable || lifecycle ? [uid] : [0, uid]
  const lifecycleModes = lifecycle === 'control' ? [0o700, 0o730] : [0o700]
  if (!before.isDirectory() || before.isSymbolicLink() || !owners.includes(before.uid)
    || (lifecycle ? !lifecycleModes.includes(mode) : (before.mode & 0o022) !== 0 || writable && mode !== 0o700)) invalid()
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const after = await handle.stat()
    if (!after.isDirectory() || !sameIdentity(before, after) || await realpath(`/proc/self/fd/${handle.fd}`) !== directory) invalid()
  } finally { await handle.close() }
}
async function secureConfigFile(file: string, uid: number, coreEnv = false): Promise<void> {
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || ![0, uid].includes(before.uid) || (before.mode & 0o022) !== 0
    || coreEnv && ![0o400, 0o440, 0o444].includes(before.mode & 0o777)) invalid()
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const after = await handle.stat()
    if (!after.isFile() || !sameIdentity(before, after) || after.nlink !== 1 || await realpath(`/proc/self/fd/${handle.fd}`) !== file) invalid()
  } finally { await handle.close() }
}
async function validateAuthorityTree(value: AgentHostIsolatedAuthorityDescriptorV1): Promise<void> {
  await secureDirectory(value.authorityRoot, value.operatorUid, true)
  await secureDirectory(value.configRoot, value.operatorUid, false)
  for (const name of ['compose.yml', 'compose.isolated.yml', 'Caddyfile']) await secureConfigFile(path.join(value.configRoot, name), value.operatorUid)
  await secureConfigFile(path.join(value.configRoot, 'core.env'), value.operatorUid, true)
  for (const root of [value.stateRoot, value.materializedRoot, value.lockRoot]) await secureDirectory(root, value.operatorUid, true)
  await secureDirectory(value.controlRoot, value.operatorUid, false, 'control')
  await secureDirectory(value.secretRoot, value.operatorUid, true)
  // The image entrypoint owns the explicit operator -> 10001 transition. Repeated preflight accepts either exact lifecycle state.
  for (const root of [value.workspaceRoot, value.sessionRoot]) await secureDirectory(root, value.operatorUid, false, 'app-storage')
}

async function readOpenedDescriptor(handle: FileHandle, before: Stats, descriptorPath: string, expectedHostId?: string): Promise<AgentHostAuthorityCapability & AgentHostIsolatedAuthorityDescriptorV1> {
  const initial = await handle.stat()
  if (!initial.isFile() || !sameIdentity(before, initial) || initial.nlink !== 1 || initial.size < 1 || initial.size > AGENT_HOST_AUTHORITY_MAX_BYTES
    || !(initial.uid === 0 && (initial.mode & 0o777) === 0o444
      || initial.uid === process.geteuid?.() && (initial.mode & 0o777) === 0o400)) invalid()
  const bytes = new Uint8Array(initial.size)
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
    if (bytesRead === 0) invalid()
    offset += bytesRead
  }
  const final = await handle.stat()
  if (!sameIdentity(initial, final) || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs
    || await realpath(`/proc/self/fd/${handle.fd}`) !== descriptorPath) invalid()
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { invalid() }
  const descriptor = parseAgentHostIsolatedAuthorityDescriptor(raw, expectedHostId)
  if (new TextDecoder().decode(bytes) !== canonicalJson(descriptor)) invalid()
  await validateAuthorityTree(descriptor)
  return mintAuthorityCapability(descriptor)
}

export async function openAgentHostAuthorityDescriptor(descriptorPath: string, expectedHostId?: string): Promise<OpenedAgentHostAuthority> {
  try {
    const canonicalPath = absolute(descriptorPath)
    const parent = path.dirname(canonicalPath)
    await secureDirectory(parent, process.geteuid!(), false)
    const before = await lstat(canonicalPath)
    if (!before.isFile() || before.isSymbolicLink()) invalid()
    const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const authority = await readOpenedDescriptor(handle, before, canonicalPath, expectedHostId)
      return Object.freeze({ authority, handle })
    } catch (error) { await handle.close(); throw error }
  } catch (error) { if (error instanceof AgentHostError) throw error; return invalid() }
}

export async function readInheritedAgentHostAuthorityDescriptor(fd: number, descriptorPath: string, expectedHostId: string): Promise<AgentHostAuthorityCapability & AgentHostIsolatedAuthorityDescriptorV1> {
  try {
    const canonicalPath = absolute(descriptorPath)
    const before = await lstat(canonicalPath)
    const handle = await open(`/proc/self/fd/${fd}`, constants.O_RDONLY)
    try { return await readOpenedDescriptor(handle, before, canonicalPath, expectedHostId) } finally { await handle.close() }
  } catch (error) { if (error instanceof AgentHostError) throw error; return invalid() }
}

export function createDefaultAgentHostAuthority(options: {
  readonly hostId: string; readonly operatorUid: number; readonly stateRoot: string; readonly lockRoot: string; readonly databaseRef?: string
}): AgentHostAuthorityCapability & AgentHostProductionAuthorityDescriptorV1 {
  const hostId = strictAgentHostId(options.hostId, 'hostId')
  return mintAuthorityCapability(Object.freeze({
    schemaVersion: 1, domain: DOMAIN, mode: 'production', hostId, operatorUid: options.operatorUid,
    composeProject: AGENT_HOST_PRODUCTION_PROJECT, configRoot: AGENT_HOST_PRODUCTION_CONFIG_ROOT,
    stateRoot: options.stateRoot, materializedRoot: AGENT_HOST_PRODUCTION_MATERIALIZED_ROOT,
    controlRoot: AGENT_HOST_PRODUCTION_CONTROL_ROOT, lockRoot: options.lockRoot,
    secretRoot: path.join(AGENT_HOST_PRODUCTION_MATERIALIZED_ROOT, hostId, 'host-secrets'),
    workspaceRoot: AGENT_HOST_PRODUCTION_WORKSPACE_VOLUME, sessionRoot: AGENT_HOST_PRODUCTION_SESSION_VOLUME,
    databaseUrlFile: path.join(AGENT_HOST_PRODUCTION_MATERIALIZED_ROOT, hostId, 'host-secrets', 'database-url'),
    databaseRef: options.databaseRef ? strictAgentHostRef(options.databaseRef, 'databaseRef') : null,
    runtimeProfile: null,
  }))
}

export async function readAgentHostAuthorityDatabaseUrl(rawAuthority: AgentHostAuthorityCapability): Promise<string> {
  const authority = requireAgentHostAuthorityCapability(rawAuthority)
  let handle: FileHandle | undefined
  try {
    const before = await lstat(authority.databaseUrlFile)
    if (!before.isFile() || before.isSymbolicLink()) invalid('databaseAuthority')
    handle = await open(authority.databaseUrlFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const initial = await handle.stat()
    if (!initial.isFile() || !sameIdentity(before, initial) || initial.nlink !== 1 || initial.size < 1 || initial.size > 4096
      || !(initial.uid === 0 && (initial.mode & 0o777) === 0o444
        || initial.uid === authority.operatorUid && (initial.mode & 0o777) === 0o400)) invalid('databaseAuthority')
    const bytes = await handle.readFile(); const final = await handle.stat()
    if (!sameIdentity(initial, final) || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs
      || await realpath(`/proc/self/fd/${handle.fd}`) !== authority.databaseUrlFile) invalid('databaseAuthority')
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') invalid('databaseAuthority')
    if (authority.mode === 'isolated-proof') {
      const database = decodeURIComponent(parsed.pathname.slice(1)); const username = decodeURIComponent(parsed.username)
      if (database !== authority.databaseRef || !PROOF_DATABASE_RE.test(database) || !PROOF_DATABASE_RE.test(username)) invalid('databaseAuthority')
    }
    return value
  } catch (error) { if (error instanceof AgentHostError) throw error; return invalid('databaseAuthority') }
  finally { await handle?.close() }
}
