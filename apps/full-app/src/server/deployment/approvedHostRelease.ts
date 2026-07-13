import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'

import { D1HostError, D1HostErrorCode } from './d1Plan.js'

const RELEASE_DOMAIN = 'boring-d1-approved-host-release:v1' as const
const MIGRATION_DOMAIN = 'boring-d1-migration-set:v1' as const
const SHA256 = /^sha256:[a-f0-9]{64}$/
const REVISION = /^[a-f0-9]{40}$/
const MIGRATION_TAG = /^[a-z0-9][a-z0-9_]{0,127}$/
const DEPLOYMENT_MIGRATION_SOURCES = ['apps/full-app/src/server/migrate.ts', 'packages/core/src/server/migrations.ts',
  'packages/core/src/server/db/migrate.ts', 'plugins/boring-automation/src/server/migrations.ts'] as const

const RELEASE_KEYS = ['schemaVersion', 'domain', 'hostAppImageDigest', 'coreCommand', 'migrationProcess',
  'ingressImageDigest', 'ingressCommand', 'caddyfileDigest', 'hostSecurityConfigDigest',
  'selectorInventoryRevision', 'executionPolicyRevision', 'databaseSchemaCompatibility'] as const
const EXPECTED_KEYS = ['hostAppImageDigest', 'ingressImageDigest', 'caddyfileDigest', 'hostSecurityConfigDigest',
  'selectorInventoryRevision', 'executionPolicyRevision', 'migrationEvidence'] as const

export interface ApprovedD1HostReleaseRecordV1 {
  readonly schemaVersion: 1
  readonly domain: typeof RELEASE_DOMAIN
  readonly hostAppImageDigest: Sha256Digest
  readonly coreCommand: Readonly<{ entrypoint: readonly ['/usr/local/bin/web-entrypoint']; cmd: readonly ['node', 'apps/full-app/dist/server/main.js'] }>
  readonly migrationProcess: Readonly<{ entrypoint: readonly ['node']; cmd: readonly ['apps/full-app/dist/server/migrate.js']; user: '10001:10001'; readonlyRootfs: true; privileged: false; noNewPrivileges: true; addedCapabilities: readonly [] }>
  readonly ingressImageDigest: Sha256Digest
  readonly ingressCommand: Readonly<{ entrypoint: null; cmd: readonly ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'] }>
  readonly caddyfileDigest: Sha256Digest
  readonly hostSecurityConfigDigest: Sha256Digest
  readonly selectorInventoryRevision: string
  readonly executionPolicyRevision: string
  readonly databaseSchemaCompatibility: Readonly<{ migrationSetDigest: Sha256Digest; currentEpoch: number; readableEpochRange: Readonly<{ min: number; max: number }>; readableByPreviousRelease: boolean }>
}

export interface D1MigrationSetEvidenceV1 {
  readonly schemaVersion: 1
  readonly domain: typeof MIGRATION_DOMAIN
  readonly currentEpoch: number
  readonly migrationSetDigest: Sha256Digest
  readonly migrations: readonly Readonly<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean; file: string; sqlDigest: Sha256Digest }>[]
  readonly deploymentSources: readonly Readonly<{ file: string; sourceDigest: Sha256Digest }>[]
}

export interface ExpectedD1HostReleaseV1 {
  readonly hostAppImageDigest: Sha256Digest
  readonly ingressImageDigest: Sha256Digest
  readonly caddyfileDigest: Sha256Digest
  readonly hostSecurityConfigDigest: Sha256Digest
  readonly selectorInventoryRevision: string
  readonly executionPolicyRevision: string
  readonly migrationEvidence: D1MigrationSetEvidenceV1
}

function fail(field: 'approvedHostRelease' | 'databaseSchemaCompatibility'): never {
  throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field })
}

function dataRecord(value: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expected.length || expected.some((key) => !keys.includes(key))) throw new Error()
  const snapshot: Record<string, unknown> = {}
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    snapshot[key] = descriptor.value
  }
  return Object.freeze(snapshot)
}

function dataArray(value: unknown, maxLength = 10_000): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error()
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > maxLength) throw new Error()
  const indices = Array.from({ length: length.value }, (_, index) => String(index))
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== indices.length + 1 || !keys.includes('length') || indices.some((key) => !keys.includes(key))) throw new Error()
  return Object.freeze(indices.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    return descriptor.value
  }))
}

function exactArray(value: unknown, expected: readonly unknown[]): readonly unknown[] {
  const actual = dataArray(value, expected.length)
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) throw new Error()
  return Object.freeze([...expected])
}

function digest(value: unknown): Sha256Digest {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error()
  return value as Sha256Digest
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !REVISION.test(value)) throw new Error()
  return value
}

function epoch(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error()
  return value
}

function parseRelease(value: unknown): ApprovedD1HostReleaseRecordV1 {
  const input = dataRecord(value, RELEASE_KEYS)
  const core = dataRecord(input.coreCommand, ['entrypoint', 'cmd'])
  const migration = dataRecord(input.migrationProcess, ['entrypoint', 'cmd', 'user', 'readonlyRootfs', 'privileged', 'noNewPrivileges', 'addedCapabilities'])
  const ingress = dataRecord(input.ingressCommand, ['entrypoint', 'cmd'])
  const compatibility = dataRecord(input.databaseSchemaCompatibility, ['migrationSetDigest', 'currentEpoch', 'readableEpochRange', 'readableByPreviousRelease'])
  const range = dataRecord(compatibility.readableEpochRange, ['min', 'max'])
  if (input.schemaVersion !== 1 || input.domain !== RELEASE_DOMAIN || migration.user !== '10001:10001'
    || migration.readonlyRootfs !== true || migration.privileged !== false || migration.noNewPrivileges !== true
    || ingress.entrypoint !== null || typeof compatibility.readableByPreviousRelease !== 'boolean') throw new Error()
  const currentEpoch = epoch(compatibility.currentEpoch); const min = epoch(range.min); const max = epoch(range.max)
  if (min > max || max !== currentEpoch) throw new Error()
  return Object.freeze({
    schemaVersion: 1, domain: RELEASE_DOMAIN, hostAppImageDigest: digest(input.hostAppImageDigest),
    coreCommand: Object.freeze({ entrypoint: exactArray(core.entrypoint, ['/usr/local/bin/web-entrypoint']) as ['/usr/local/bin/web-entrypoint'],
      cmd: exactArray(core.cmd, ['node', 'apps/full-app/dist/server/main.js']) as ['node', 'apps/full-app/dist/server/main.js'] }),
    migrationProcess: Object.freeze({ entrypoint: exactArray(migration.entrypoint, ['node']) as ['node'],
      cmd: exactArray(migration.cmd, ['apps/full-app/dist/server/migrate.js']) as ['apps/full-app/dist/server/migrate.js'], user: '10001:10001',
      readonlyRootfs: true, privileged: false, noNewPrivileges: true, addedCapabilities: exactArray(migration.addedCapabilities, []) as [] }),
    ingressImageDigest: digest(input.ingressImageDigest),
    ingressCommand: Object.freeze({ entrypoint: null, cmd: exactArray(ingress.cmd, ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']) as ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'] }),
    caddyfileDigest: digest(input.caddyfileDigest), hostSecurityConfigDigest: digest(input.hostSecurityConfigDigest),
    selectorInventoryRevision: revision(input.selectorInventoryRevision), executionPolicyRevision: revision(input.executionPolicyRevision),
    databaseSchemaCompatibility: Object.freeze({ migrationSetDigest: digest(compatibility.migrationSetDigest), currentEpoch,
      readableEpochRange: Object.freeze({ min, max }), readableByPreviousRelease: compatibility.readableByPreviousRelease }),
  })
}

export function decodeApprovedD1HostReleaseRecord(value: unknown): ApprovedD1HostReleaseRecordV1 {
  try { return parseRelease(value) } catch { return fail('approvedHostRelease') }
}

function snapshotBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) throw new Error()
  const keys = Reflect.ownKeys(value); const expected = Array.from({ length: value.length }, (_, index) => String(index))
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expected.length || expected.some((key) => !keys.includes(key))) throw new Error()
  const copy = new Uint8Array(expected.length)
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number') throw new Error()
    copy[Number(key)] = descriptor.value
  }
  return copy
}

async function rawDigest(bytes: Uint8Array): Promise<Sha256Digest> {
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function migrationEvidence(journalValue: unknown, sqlValue: unknown, sourceValue: unknown): Promise<D1MigrationSetEvidenceV1> {
  const journal = dataRecord(journalValue, ['version', 'dialect', 'entries'])
  if (journal.version !== '7' || journal.dialect !== 'postgresql') throw new Error()
  const entries = dataArray(journal.entries)
  let previousWhen = -1
  const parsedEntries = entries.map((value, index) => {
    const input = dataRecord(value, ['idx', 'version', 'when', 'tag', 'breakpoints'])
    if (input.idx !== index || input.version !== journal.version || typeof input.breakpoints !== 'boolean'
      || typeof input.tag !== 'string' || !MIGRATION_TAG.test(input.tag)
      || !input.tag.startsWith(`${String(index).padStart(4, '0')}_`)) throw new Error()
    const when = epoch(input.when)
    if (when <= previousWhen) throw new Error()
    previousWhen = when
    return Object.freeze({ idx: index, version: journal.version as string, when, tag: input.tag, breakpoints: input.breakpoints })
  })
  const sqlInputs = dataArray(sqlValue)
  const sqlByFile = new Map<string, Uint8Array>()
  for (const value of sqlInputs) {
    const input = dataRecord(value, ['file', 'bytes'])
    if (typeof input.file !== 'string' || sqlByFile.has(input.file)) throw new Error()
    sqlByFile.set(input.file, snapshotBytes(input.bytes))
  }
  const sourceInputs = dataArray(sourceValue, DEPLOYMENT_MIGRATION_SOURCES.length)
  const sourceByFile = new Map<string, Uint8Array>()
  for (const value of sourceInputs) {
    const input = dataRecord(value, ['file', 'bytes'])
    if (typeof input.file !== 'string' || sourceByFile.has(input.file) || !DEPLOYMENT_MIGRATION_SOURCES.includes(input.file as never)) throw new Error()
    sourceByFile.set(input.file, snapshotBytes(input.bytes))
  }
  if (sourceByFile.size !== DEPLOYMENT_MIGRATION_SOURCES.length) throw new Error()
  const migrations: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean; file: string; sqlDigest: Sha256Digest }> = []
  for (const entry of parsedEntries) {
    const file = `${entry.tag}.sql`; const bytes = sqlByFile.get(file)
    if (!bytes) throw new Error()
    sqlByFile.delete(file)
    migrations.push(Object.freeze({ ...entry, file, sqlDigest: await rawDigest(bytes) }))
  }
  if (sqlByFile.size !== 0 || sqlInputs.length !== entries.length) throw new Error()
  const frozenMigrations = Object.freeze(migrations)
  const deploymentSources = Object.freeze(await Promise.all(DEPLOYMENT_MIGRATION_SOURCES.map(async (file) => Object.freeze({
    file, sourceDigest: await rawDigest(sourceByFile.get(file) as Uint8Array),
  }))))
  const manifest = Object.freeze({ schemaVersion: 1 as const, domain: MIGRATION_DOMAIN, journalVersion: journal.version,
    dialect: journal.dialect, migrations: frozenMigrations, deploymentSources })
  return Object.freeze({ schemaVersion: 1, domain: MIGRATION_DOMAIN, currentEpoch: entries.length,
    migrationSetDigest: await createAgentAssetDigest(JSON.stringify(manifest)), migrations: frozenMigrations, deploymentSources })
}

export async function createD1MigrationSetEvidence(journal: unknown, sqlEntries: unknown, deploymentSources: unknown): Promise<D1MigrationSetEvidenceV1> {
  try { return await migrationEvidence(journal, sqlEntries, deploymentSources) } catch { return fail('databaseSchemaCompatibility') }
}

async function validateMigrationEvidence(value: unknown): Promise<Readonly<{ currentEpoch: number; migrationSetDigest: Sha256Digest }>> {
  const evidence = dataRecord(value, ['schemaVersion', 'domain', 'currentEpoch', 'migrationSetDigest', 'migrations', 'deploymentSources'])
  if (evidence.schemaVersion !== 1 || evidence.domain !== MIGRATION_DOMAIN) throw new Error()
  const values = dataArray(evidence.migrations); const currentEpoch = epoch(evidence.currentEpoch)
  if (currentEpoch !== values.length) throw new Error()
  let previousWhen = -1
  const migrations = Object.freeze(values.map((value, index) => {
    const input = dataRecord(value, ['idx', 'version', 'when', 'tag', 'breakpoints', 'file', 'sqlDigest'])
    if (input.idx !== index || input.version !== '7' || typeof input.breakpoints !== 'boolean'
      || typeof input.tag !== 'string' || !MIGRATION_TAG.test(input.tag) || !input.tag.startsWith(`${String(index).padStart(4, '0')}_`)
      || input.file !== `${input.tag}.sql`) throw new Error()
    const when = epoch(input.when)
    if (when <= previousWhen) throw new Error()
    previousWhen = when
    return Object.freeze({ idx: index, version: '7', when, tag: input.tag, breakpoints: input.breakpoints,
      file: input.file, sqlDigest: digest(input.sqlDigest) })
  }))
  const sourceValues = dataArray(evidence.deploymentSources, DEPLOYMENT_MIGRATION_SOURCES.length)
  if (sourceValues.length !== DEPLOYMENT_MIGRATION_SOURCES.length) throw new Error()
  const deploymentSources = Object.freeze(sourceValues.map((value, index) => {
    const source = dataRecord(value, ['file', 'sourceDigest']); const file = DEPLOYMENT_MIGRATION_SOURCES[index]
    if (source.file !== file) throw new Error()
    return Object.freeze({ file, sourceDigest: digest(source.sourceDigest) })
  }))
  const manifest = Object.freeze({ schemaVersion: 1 as const, domain: MIGRATION_DOMAIN, journalVersion: '7',
    dialect: 'postgresql', migrations, deploymentSources })
  const migrationSetDigest = digest(evidence.migrationSetDigest)
  if (await createAgentAssetDigest(JSON.stringify(manifest)) !== migrationSetDigest) throw new Error()
  return Object.freeze({ currentEpoch, migrationSetDigest })
}

export async function validateApprovedD1HostRelease(recordValue: unknown, expectedValue: unknown): Promise<ApprovedD1HostReleaseRecordV1> {
  const record = decodeApprovedD1HostReleaseRecord(recordValue)
  let expected: Readonly<Record<string, unknown>>
  try {
    expected = dataRecord(expectedValue, EXPECTED_KEYS)
    const releaseMatches = record.hostAppImageDigest === digest(expected.hostAppImageDigest)
      && record.ingressImageDigest === digest(expected.ingressImageDigest) && record.caddyfileDigest === digest(expected.caddyfileDigest)
      && record.hostSecurityConfigDigest === digest(expected.hostSecurityConfigDigest)
      && record.selectorInventoryRevision === revision(expected.selectorInventoryRevision)
      && record.executionPolicyRevision === revision(expected.executionPolicyRevision)
    if (!releaseMatches) return fail('approvedHostRelease')
  } catch (error) {
    if (error instanceof D1HostError) throw error
    return fail('approvedHostRelease')
  }
  try {
    const evidence = await validateMigrationEvidence(expected.migrationEvidence)
    if (record.databaseSchemaCompatibility.migrationSetDigest !== evidence.migrationSetDigest
      || record.databaseSchemaCompatibility.currentEpoch !== evidence.currentEpoch) return fail('databaseSchemaCompatibility')
    return record
  } catch (error) {
    if (error instanceof D1HostError) throw error
    return fail('databaseSchemaCompatibility')
  }
}
