import { createHash } from 'node:crypto'
import type { Sha256Digest } from '@hachej/boring-agent/shared'

import { decodeApprovedD1HostReleaseRecord, type ApprovedD1HostReleaseRecordV1 } from './approvedHostRelease.js'
import {
  D1_CADDY_AMD64_ID,
  D1_CADDY_COMMAND,
  D1_CADDY_IMAGE,
  D1_CADDY_IMAGE_DEFAULTS,
  D1_CADDYFILE_DIGEST,
} from './d1IngressArtifacts.js'
import { D1HostError, D1HostErrorCode } from './d1Plan.js'

const SHA256 = /^sha256:[a-f0-9]{64}$/
const REVISION = /^[a-f0-9]{40}$/
const PINNED_IMAGE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/
const FORBIDDEN_LOADER_KEYS = new Set(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH'])
const SECRET_KEY = /(?:SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|API[_-]?KEY|BEARER|DATABASE|DB_|MODEL_|COMPOSIO|CREDITS)/i
const CORE_ENV = Object.freeze({
  NODE_ENV: 'production',
  BORING_AGENT_MODE: 'vercel-sandbox',
  BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces',
  BORING_AGENT_SESSION_ROOT: '/data/pi-sessions',
})
const DATABASE_COMPATIBILITY_FAILURE = Object.freeze({})

type EvidenceField = 'approvedHostRelease' | 'coreImage' | 'ingressImage' | 'caddyfile' | 'databaseSchemaCompatibility'

export interface D1ApprovedHostArtifactEvidenceV1 {
  readonly coreImageId: Sha256Digest
  readonly ingressImageId: Sha256Digest
  readonly imageDefaults: Readonly<{ path: string; nodeVersion: string; yarnVersion: string }>
  readonly executionPolicyRevision: string
  readonly migrationSetDigest: Sha256Digest
  readonly currentEpoch: number
  readonly caddyfileDigest: Sha256Digest
}

function unavailable(field: EvidenceField): never {
  throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field })
}

function dataRecord(value: unknown, required: readonly string[], exact = false): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || (exact && keys.length !== required.length)
    || required.some((key) => !keys.includes(key))) throw new Error()
  const snapshot = Object.create(null) as Record<string, unknown>
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    snapshot[key] = descriptor.value
  }
  return Object.freeze(snapshot)
}

function dataArray(value: unknown, maxLength = 10_000): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error()
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value)
    || length.value < 0 || length.value > maxLength) throw new Error()
  const indices = Array.from({ length: length.value }, (_, index) => String(index))
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== indices.length + 1
    || !keys.includes('length') || indices.some((key) => !keys.includes(key))) throw new Error()
  return Object.freeze(indices.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    return descriptor.value
  }))
}

function stringArray(value: unknown, maxLength = 1_000): readonly string[] {
  const values = dataArray(value, maxLength)
  if (values.some((entry) => typeof entry !== 'string')) throw new Error()
  return values as readonly string[]
}

function exactArray(value: unknown, expected: readonly string[]): void {
  const values = stringArray(value, expected.length)
  if (values.length !== expected.length || values.some((entry, index) => entry !== expected[index])) throw new Error()
}

function digest(value: unknown): Sha256Digest {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error()
  return value as Sha256Digest
}

function safeString(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\0-\x1f\x7f]/.test(value)) throw new Error()
  return value
}

function environment(value: unknown, expected: Readonly<Record<string, string>>, exactKeys: readonly string[]): Readonly<Map<string, string>> {
  const entries = stringArray(value)
  const parsed = new Map<string, string>()
  for (const entry of entries) {
    const separator = entry.indexOf('=')
    const key = separator < 1 ? '' : entry.slice(0, separator)
    const envValue = separator < 0 ? '' : entry.slice(separator + 1)
    if (!ENV_KEY.test(key) || parsed.has(key) || FORBIDDEN_LOADER_KEYS.has(key) || SECRET_KEY.test(key)) throw new Error()
    parsed.set(key, safeString(envValue))
  }
  if (parsed.size !== exactKeys.length || exactKeys.some((key) => !parsed.has(key))) throw new Error()
  for (const [key, expectedValue] of Object.entries(expected)) if (parsed.get(key) !== expectedValue) throw new Error()
  return parsed
}

function oneImage(value: unknown): Readonly<Record<string, unknown>> {
  const images = dataArray(value, 1)
  if (images.length !== 1) throw new Error()
  return dataRecord(images[0], ['Id', 'RepoDigests', 'Architecture', 'Os', 'Config'])
}

function imageIdentity(image: Readonly<Record<string, unknown>>, imageRef: string): Sha256Digest {
  const imageId = digest(image.Id)
  const repoDigests = stringArray(image.RepoDigests)
  if (image.Architecture !== 'amd64' || image.Os !== 'linux' || !repoDigests.includes(imageRef)) throw new Error()
  return imageId
}

function validateCore(
  record: ApprovedD1HostReleaseRecordV1,
  coreImageRefValue: unknown,
  inspectValue: unknown,
): Readonly<{ imageId: Sha256Digest; imageDefaults: Readonly<{ path: string; nodeVersion: string; yarnVersion: string }> }> {
  const coreImageRef = safeString(coreImageRefValue)
  if (!PINNED_IMAGE.test(coreImageRef) || !coreImageRef.endsWith(`@${record.hostAppImageDigest}`)) throw new Error()
  const image = oneImage(inspectValue)
  const imageId = imageIdentity(image, coreImageRef)
  const config = dataRecord(image.Config, ['Entrypoint', 'Cmd', 'WorkingDir', 'Env', 'Labels'])
  exactArray(config.Entrypoint, record.coreCommand.entrypoint)
  exactArray(config.Cmd, record.coreCommand.cmd)
  // Docker omits an unset User; a non-empty image User would bypass the root setup entrypoint.
  if (config.WorkingDir !== '/app' || (Object.hasOwn(config, 'User') && config.User !== '')) throw new Error()
  const envKeys = ['PATH', 'NODE_VERSION', 'YARN_VERSION', ...Object.keys(CORE_ENV)]
  const env = environment(config.Env, CORE_ENV, envKeys)
  const path = safeString(env.get('PATH')); const nodeVersion = safeString(env.get('NODE_VERSION')); const yarnVersion = safeString(env.get('YARN_VERSION'))
  if (!VERSION.test(nodeVersion) || !VERSION.test(yarnVersion)) throw new Error()
  const labels = dataRecord(config.Labels, ['boring.role', 'org.opencontainers.image.revision',
    'ai.senecapp.d1.migration-set-digest', 'ai.senecapp.d1.database-current-epoch'])
  if (labels['boring.role'] !== 'web' || labels['org.opencontainers.image.revision'] !== record.executionPolicyRevision
    || typeof labels['org.opencontainers.image.revision'] !== 'string'
    || !REVISION.test(labels['org.opencontainers.image.revision'])) throw new Error()
  if (labels['ai.senecapp.d1.migration-set-digest'] !== record.databaseSchemaCompatibility.migrationSetDigest
    || labels['ai.senecapp.d1.database-current-epoch'] !== String(record.databaseSchemaCompatibility.currentEpoch)) {
    throw DATABASE_COMPATIBILITY_FAILURE
  }
  return Object.freeze({ imageId, imageDefaults: Object.freeze({ path, nodeVersion, yarnVersion }) })
}

function validateIngress(record: ApprovedD1HostReleaseRecordV1, inspectValue: unknown): Sha256Digest {
  if (!D1_CADDY_IMAGE.endsWith(`@${record.ingressImageDigest}`)) throw new Error()
  const image = oneImage(inspectValue)
  const imageId = imageIdentity(image, D1_CADDY_IMAGE)
  if (imageId !== D1_CADDY_AMD64_ID) throw new Error()
  const config = dataRecord(image.Config, ['Cmd', 'WorkingDir', 'Env'])
  if (Object.hasOwn(config, 'Entrypoint') && config.Entrypoint !== null) throw new Error()
  exactArray(config.Cmd, D1_CADDY_COMMAND)
  if (config.WorkingDir !== '/srv' || (Object.hasOwn(config, 'User') && config.User !== '')) throw new Error()
  const expectedEnv = D1_CADDY_IMAGE_DEFAULTS as Readonly<Record<string, string>>
  environment(config.Env, expectedEnv, Object.keys(expectedEnv))
  return imageId
}

function snapshotBytes(value: unknown, maxLength = 64 * 1024): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) throw new Error()
  if (value.byteLength < 1 || value.byteLength > maxLength) throw new Error()
  const keys = Reflect.ownKeys(value); const expected = Array.from({ length: value.byteLength }, (_, index) => String(index))
  if (keys.some((key) => typeof key !== 'string')
    || keys.length !== expected.length || expected.some((key) => !keys.includes(key))) throw new Error()
  const copy = new Uint8Array(expected.length)
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number') throw new Error()
    copy[Number(key)] = descriptor.value
  }
  return copy
}

function validateCaddyfile(record: ApprovedD1HostReleaseRecordV1, value: unknown): Sha256Digest {
  const bytes = snapshotBytes(value)
  const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Digest
  if (actual !== D1_CADDYFILE_DIGEST || actual !== record.caddyfileDigest) throw new Error()
  return actual
}

function guarded<T>(field: EvidenceField, action: () => T): T {
  try { return action() } catch (error) {
    if (error === DATABASE_COMPATIBILITY_FAILURE) return unavailable('databaseSchemaCompatibility')
    return unavailable(field)
  }
}

export function createD1ApprovedHostArtifactEvidence(
  recordValue: ApprovedD1HostReleaseRecordV1,
  coreImageRef: unknown,
  coreInspect: unknown,
  ingressInspect: unknown,
  caddyfileBytes: unknown,
): D1ApprovedHostArtifactEvidenceV1 {
  const record = decodeApprovedD1HostReleaseRecord(recordValue)
  const core = guarded('coreImage', () => validateCore(record, coreImageRef, coreInspect))
  const ingressImageId = guarded('ingressImage', () => validateIngress(record, ingressInspect))
  const caddyfileDigest = guarded('caddyfile', () => validateCaddyfile(record, caddyfileBytes))
  return Object.freeze({
    coreImageId: core.imageId,
    ingressImageId,
    imageDefaults: core.imageDefaults,
    executionPolicyRevision: record.executionPolicyRevision,
    migrationSetDigest: record.databaseSchemaCompatibility.migrationSetDigest,
    currentEpoch: record.databaseSchemaCompatibility.currentEpoch,
    caddyfileDigest,
  })
}
