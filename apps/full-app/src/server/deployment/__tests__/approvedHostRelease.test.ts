import { describe, expect, it } from 'vitest'

import { D1HostErrorCode } from '../d1Plan.js'
import {
  createD1MigrationSetEvidence,
  decodeApprovedD1HostReleaseRecord,
  validateApprovedD1HostRelease,
} from '../approvedHostRelease.js'

const digest = (character: string) => `sha256:${character.repeat(64)}`
const revision = (character: string) => character.repeat(40)
const CANARY = 'secret-canary-never-serialize'

const journal = () => ({
  version: '7', dialect: 'postgresql', entries: [
    { idx: 0, version: '7', when: 100, tag: '0000_first', breakpoints: true },
    { idx: 1, version: '7', when: 200, tag: '0001_second', breakpoints: true },
  ],
})
const sql = () => [
  { file: '0000_first.sql', bytes: new TextEncoder().encode('select 1;\n') },
  { file: '0001_second.sql', bytes: new TextEncoder().encode('select 2;\n') },
]
const sources = () => [
  { file: 'apps/full-app/src/server/migrate.ts', bytes: new TextEncoder().encode('register core and automation\n') },
  { file: 'packages/core/src/server/migrations.ts', bytes: new TextEncoder().encode('load config and invoke core migrations\n') },
  { file: 'packages/core/src/server/db/migrate.ts', bytes: new TextEncoder().encode('lock, extension, drizzle, additional\n') },
  { file: 'plugins/boring-automation/src/server/migrations.ts', bytes: new TextEncoder().encode('create automation tables\n') },
]
const release = () => ({
  schemaVersion: 1,
  domain: 'boring-d1-approved-host-release:v1',
  hostAppImageDigest: digest('a'),
  previousCoreImageRef: `ghcr.io/hachej/boring-ui@${digest('f')}`,
  coreCommand: { entrypoint: ['/usr/local/bin/web-entrypoint'], cmd: ['node', 'apps/full-app/dist/server/main.js'] },
  migrationProcess: { entrypoint: ['node'], cmd: ['apps/full-app/dist/server/migrate.js'], user: '10001:10001',
    readonlyRootfs: true, privileged: false, noNewPrivileges: true, addedCapabilities: [] },
  ingressImageDigest: digest('b'),
  ingressCommand: { entrypoint: null, cmd: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'] },
  caddyfileDigest: digest('c'), hostSecurityConfigDigest: digest('d'),
  selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b'),
  databaseSchemaCompatibility: { migrationSetDigest: digest('e'), currentEpoch: 2,
    readableEpochRange: { min: 1, max: 2 }, readableByPreviousRelease: true, rehearsalEvidenceDigest: digest('9') },
})
const frozen = (value: unknown): boolean => !value || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(frozen))
const rejectsRelease = (value: unknown) => expect(() => decodeApprovedD1HostReleaseRecord(value)).toThrow(expect.objectContaining({
  code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'approvedHostRelease' },
}))
const rejectsEvidence = (journalValue: unknown, sqlValue: unknown = sql(), sourceValue: unknown = sources()) => expect(createD1MigrationSetEvidence(journalValue, sqlValue, sourceValue))
  .rejects.toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'databaseSchemaCompatibility' } })

describe('approved D1 host release', () => {
  it('decodes the exact command and policy closure into a deeply frozen record', () => {
    const decoded = decodeApprovedD1HostReleaseRecord(release())
    expect(decoded).toEqual(release())
    expect(frozen(decoded)).toBe(true)
  })

  it.each([
    ['schema version', (value: ReturnType<typeof release>) => { value.schemaVersion = 2 }],
    ['domain', (value: ReturnType<typeof release>) => { value.domain = 'other' }],
    ['host digest', (value: ReturnType<typeof release>) => { value.hostAppImageDigest = digest('A') }],
    ['previous image', (value: ReturnType<typeof release>) => { value.previousCoreImageRef = 'image:latest' }],
    ['same previous image', (value: ReturnType<typeof release>) => { value.previousCoreImageRef = `other@${digest('a')}` }],
    ['core entrypoint', (value: ReturnType<typeof release>) => { value.coreCommand.entrypoint[0] = '/bin/sh' }],
    ['core command', (value: ReturnType<typeof release>) => { value.coreCommand.cmd[1] = 'other.js' }],
    ['migration entrypoint', (value: ReturnType<typeof release>) => { value.migrationProcess.entrypoint[0] = '/bin/sh' }],
    ['migration command', (value: ReturnType<typeof release>) => { value.migrationProcess.cmd[0] = 'other.js' }],
    ['migration user', (value: ReturnType<typeof release>) => { value.migrationProcess.user = '0:0' }],
    ['migration rootfs', (value: ReturnType<typeof release>) => { value.migrationProcess.readonlyRootfs = false }],
    ['migration privileged', (value: ReturnType<typeof release>) => { value.migrationProcess.privileged = true }],
    ['migration privileges', (value: ReturnType<typeof release>) => { value.migrationProcess.noNewPrivileges = false }],
    ['migration capabilities', (value: ReturnType<typeof release>) => { value.migrationProcess.addedCapabilities.push('NET_ADMIN' as never) }],
    ['ingress digest', (value: ReturnType<typeof release>) => { value.ingressImageDigest = 'latest' }],
    ['ingress entrypoint', (value: ReturnType<typeof release>) => { value.ingressCommand.entrypoint = [] as never }],
    ['ingress command', (value: ReturnType<typeof release>) => { value.ingressCommand.cmd[0] = 'sh' }],
    ['Caddy digest', (value: ReturnType<typeof release>) => { value.caddyfileDigest = digest('z') }],
    ['security digest', (value: ReturnType<typeof release>) => { value.hostSecurityConfigDigest = digest('z') }],
    ['selector revision', (value: ReturnType<typeof release>) => { value.selectorInventoryRevision = revision('A') }],
    ['policy revision', (value: ReturnType<typeof release>) => { value.executionPolicyRevision = 'main' }],
    ['migration digest', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.migrationSetDigest = digest('z') }],
    ['epoch', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.currentEpoch = -1 }],
    ['range minimum', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.readableEpochRange.min = 3 }],
    ['range maximum', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.readableEpochRange.max = 1 }],
    ['previous-release policy', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.readableByPreviousRelease = 1 as never }],
    ['rehearsal digest', (value: ReturnType<typeof release>) => { value.databaseSchemaCompatibility.rehearsalEvidenceDigest = digest('z') }],
  ])('rejects %s drift', (_label, mutate) => { const value = release(); mutate(value); rejectsRelease(value) })

  it('accepts a first boot only when no previous release is declared', () => {
    const value = release(); value.previousCoreImageRef = null as never
    value.databaseSchemaCompatibility.readableByPreviousRelease = false
    expect(decodeApprovedD1HostReleaseRecord(value).previousCoreImageRef).toBeNull()
  })

  it('rejects extras, hidden keys, symbols, accessors, prototypes, holes, and custom array properties', () => {
    rejectsRelease({ ...release(), extra: true })
    const hidden = release(); Object.defineProperty(hidden, 'extra', { value: CANARY }); rejectsRelease(hidden)
    const symbol = release() as Record<PropertyKey, unknown>; symbol[Symbol('secret')] = CANARY; rejectsRelease(symbol)
    let reads = 0
    const accessor = release(); Object.defineProperty(accessor, 'hostAppImageDigest', { enumerable: true, get: () => { reads += 1; return digest('a') } })
    rejectsRelease(accessor); expect(reads).toBe(0)
    const nestedAccessor = release(); Object.defineProperty(nestedAccessor.databaseSchemaCompatibility.readableEpochRange, 'max', { enumerable: true, get: () => 2 })
    rejectsRelease(nestedAccessor)
    rejectsRelease(Object.assign(Object.create({ inherited: true }), release()))
    const hole = release(); hole.coreCommand.cmd = new Array(2) as never; rejectsRelease(hole)
    const custom = release(); Object.defineProperty(custom.ingressCommand.cmd, 'toJSON', { enumerable: true, value: () => [] }); rejectsRelease(custom)
    const hiddenArray = release(); Object.defineProperty(hiddenArray.migrationProcess.addedCapabilities, 'secret', { value: CANARY }); rejectsRelease(hiddenArray)
  })

  it('maps malformed values to one stable redacted public failure', () => {
    try { decodeApprovedD1HostReleaseRecord({ ...release(), hostAppImageDigest: CANARY }); throw new Error('accepted') }
    catch (error) {
      expect(error).toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY, message: D1HostErrorCode.COLLECTION_NOT_READY,
        details: { field: 'approvedHostRelease' } })
      expect(JSON.stringify(error)).not.toContain(CANARY)
      expect(String(error)).not.toContain(CANARY)
    }
  })
})

describe('D1 migration-set evidence', () => {
  it('hashes raw SQL into a deterministic journal-ordered frozen manifest', async () => {
    const first = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const reversed = await createD1MigrationSetEvidence({ dialect: 'postgresql', entries: journal().entries, version: '7' }, sql().reverse(), sources().reverse())
    expect(first).toEqual(reversed)
    expect(first).toMatchObject({ schemaVersion: 1, domain: 'boring-d1-migration-set:v1', currentEpoch: 2 })
    expect(first.migrations[0]).toMatchObject({ idx: 0, file: '0000_first.sql', breakpoints: true,
      sqlDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
    expect(first.deploymentSources.map((source) => source.file)).toEqual([
      'apps/full-app/src/server/migrate.ts', 'packages/core/src/server/migrations.ts',
      'packages/core/src/server/db/migrate.ts', 'plugins/boring-automation/src/server/migrations.ts',
    ])
    expect(first.migrationSetDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(frozen(first)).toBe(true)
  })

  it('accepts an empty migration set at epoch zero', async () => {
    await expect(createD1MigrationSetEvidence({ version: '7', dialect: 'postgresql', entries: [] }, [], sources()))
      .resolves.toMatchObject({ currentEpoch: 0, migrations: [] })
  })

  it.each([
    ['gap', () => { const value = journal(); value.entries[1].idx = 2; return value }],
    ['journal schema version drift', () => ({ ...journal(), version: '8' })],
    ['version drift', () => { const value = journal(); value.entries[1].version = '6'; return value }],
    ['time order', () => { const value = journal(); value.entries[1].when = 50; return value }],
    ['duplicate time', () => { const value = journal(); value.entries[1].when = 100; return value }],
    ['unsafe time', () => { const value = journal(); value.entries[1].when = Number.MAX_SAFE_INTEGER + 1; return value }],
    ['unsafe tag', () => { const value = journal(); value.entries[1].tag = '../secret'; return value }],
    ['tag/index drift', () => { const value = journal(); value.entries[1].tag = '0002_second'; return value }],
    ['dialect drift', () => ({ ...journal(), dialect: 'sqlite' })],
    ['journal extra', () => ({ ...journal(), extra: CANARY })],
    ['entry extra', () => { const value = journal(); return { ...value, entries: [{ ...value.entries[0], extra: CANARY }, value.entries[1]] } }],
  ])('rejects journal %s', async (_label, create) => rejectsEvidence(create()))

  it('binds behavior-bearing breakpoint metadata into the migration identity', async () => {
    const before = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const changed = journal(); changed.entries[1].breakpoints = false
    const after = await createD1MigrationSetEvidence(changed, sql(), sources())
    expect(after.migrations[1]?.breakpoints).toBe(false)
    expect(after.migrationSetDigest).not.toBe(before.migrationSetDigest)
  })

  it('rejects missing, extra, duplicate, mismatched, and malformed SQL entries', async () => {
    await rejectsEvidence(journal(), sql().slice(0, 1))
    await rejectsEvidence(journal(), [...sql(), { file: 'extra.sql', bytes: new Uint8Array() }])
    await rejectsEvidence(journal(), [sql()[0], sql()[0], sql()[1]])
    await rejectsEvidence(journal(), [{ file: 'wrong.sql', bytes: new Uint8Array() }, sql()[1]])
    await rejectsEvidence(journal(), [{ ...sql()[0], extra: CANARY }, sql()[1]])
    const customBytes = sql(); Object.defineProperty(customBytes[0].bytes, 'secret', { value: CANARY })
    await rejectsEvidence(journal(), customBytes)
  })

  it('rejects missing, extra, duplicate, and malformed deployment migration sources', async () => {
    await rejectsEvidence(journal(), sql(), sources().slice(0, 1))
    await rejectsEvidence(journal(), sql(), [...sources(), { file: 'other.ts', bytes: new Uint8Array() }])
    await rejectsEvidence(journal(), sql(), [sources()[0], sources()[0], ...sources().slice(2)])
    await rejectsEvidence(journal(), sql(), [{ ...sources()[0], extra: CANARY }, ...sources().slice(1)])
  })

  it('binds deployment migration source bytes without incrementing the Drizzle epoch', async () => {
    const before = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const changed = sources(); changed[1].bytes[0] = 255
    const after = await createD1MigrationSetEvidence(journal(), sql(), changed)
    expect(after.currentEpoch).toBe(before.currentEpoch)
    expect(after.migrationSetDigest).not.toBe(before.migrationSetDigest)
  })

  it('snapshots all SQL bytes before yielding and never retains caller input', async () => {
    const input = sql(); const sourceInput = sources(); const journalInput = journal()
    const baseline = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const pending = createD1MigrationSetEvidence(journalInput, input, sourceInput)
    input[0].bytes.fill(255); input.reverse(); sourceInput[1].bytes.fill(255); sourceInput.reverse()
    journalInput.entries[1].tag = '0001_mutated'; journalInput.entries.reverse()
    await expect(pending).resolves.toEqual(baseline)
  })

  it('rejects journal and SQL accessors, hidden keys, symbols, holes, and custom properties', async () => {
    let reads = 0
    const accessor = journal(); Object.defineProperty(accessor.entries[0], 'tag', { enumerable: true, get: () => { reads += 1; return '0000_first' } })
    await rejectsEvidence(accessor); expect(reads).toBe(0)
    const hidden = journal(); Object.defineProperty(hidden.entries[0], 'secret', { value: CANARY }); await rejectsEvidence(hidden)
    const symbol = journal(); (symbol.entries[0] as Record<PropertyKey, unknown>)[Symbol('secret')] = CANARY; await rejectsEvidence(symbol)
    await rejectsEvidence({ version: '7', dialect: 'postgresql', entries: new Array(2) })
    const custom = journal(); Object.defineProperty(custom.entries, 'toJSON', { enumerable: true, value: () => [] }); await rejectsEvidence(custom)
    await rejectsEvidence(Object.assign(Object.create({ inherited: true }), journal()))
  })

  it('maps migration canaries to one stable redacted failure', async () => {
    try { await createD1MigrationSetEvidence({ ...journal(), version: CANARY }, sql(), sources()); throw new Error('accepted') }
    catch (error) {
      expect(error).toMatchObject({ code: D1HostErrorCode.COLLECTION_NOT_READY, message: D1HostErrorCode.COLLECTION_NOT_READY,
        details: { field: 'databaseSchemaCompatibility' } })
      expect(JSON.stringify(error)).not.toContain(CANARY)
      expect(String(error)).not.toContain(CANARY)
    }
  })
})

describe('approved release matching', () => {
  it('matches independently derived migration evidence and all expected release identities', async () => {
    const evidence = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const value = release(); value.databaseSchemaCompatibility.migrationSetDigest = evidence.migrationSetDigest
    const expected = { hostAppImageDigest: digest('a'), ingressImageDigest: digest('b'), caddyfileDigest: digest('c'),
      hostSecurityConfigDigest: digest('d'), selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b'), migrationEvidence: evidence }
    await expect(validateApprovedD1HostRelease(value, expected)).resolves.toEqual(value)
  })

  it.each(['hostAppImageDigest', 'ingressImageDigest', 'caddyfileDigest', 'hostSecurityConfigDigest'] as const)
  ('rejects expected %s mismatch as an approved-release failure', async (field) => {
    const evidence = await createD1MigrationSetEvidence(journal(), sql(), sources()); const value = release()
    value.databaseSchemaCompatibility.migrationSetDigest = evidence.migrationSetDigest
    const expected = { hostAppImageDigest: digest('a'), ingressImageDigest: digest('b'), caddyfileDigest: digest('c'),
      hostSecurityConfigDigest: digest('d'), selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b'), migrationEvidence: evidence,
      [field]: digest('f') }
    await expect(validateApprovedD1HostRelease(value, expected)).rejects.toMatchObject({
      details: { field: 'approvedHostRelease' },
    })
  })

  it.each(['selectorInventoryRevision', 'executionPolicyRevision'] as const)
  ('rejects expected %s mismatch as an approved-release failure', async (field) => {
    const evidence = await createD1MigrationSetEvidence(journal(), sql(), sources()); const value = release()
    value.databaseSchemaCompatibility.migrationSetDigest = evidence.migrationSetDigest
    const expected = { hostAppImageDigest: digest('a'), ingressImageDigest: digest('b'), caddyfileDigest: digest('c'),
      hostSecurityConfigDigest: digest('d'), selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b'), migrationEvidence: evidence,
      [field]: revision('c') }
    await expect(validateApprovedD1HostRelease(value, expected)).rejects.toMatchObject({ details: { field: 'approvedHostRelease' } })
  })

  it('rejects migration digest and epoch mismatches as database compatibility failures', async () => {
    const evidence = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const expected = { hostAppImageDigest: digest('a'), ingressImageDigest: digest('b'), caddyfileDigest: digest('c'),
      hostSecurityConfigDigest: digest('d'), selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b'), migrationEvidence: evidence }
    await expect(validateApprovedD1HostRelease(release(), expected)).rejects.toMatchObject({ details: { field: 'databaseSchemaCompatibility' } })
    const value = release(); value.databaseSchemaCompatibility.migrationSetDigest = evidence.migrationSetDigest; value.databaseSchemaCompatibility.currentEpoch = 3
    value.databaseSchemaCompatibility.readableEpochRange.max = 3
    await expect(validateApprovedD1HostRelease(value, expected)).rejects.toMatchObject({ details: { field: 'databaseSchemaCompatibility' } })
  })

  it('rejects forged or internally inconsistent migration evidence', async () => {
    const evidence = await createD1MigrationSetEvidence(journal(), sql(), sources())
    const value = release(); value.databaseSchemaCompatibility.migrationSetDigest = evidence.migrationSetDigest
    const identity = { hostAppImageDigest: digest('a'), ingressImageDigest: digest('b'), caddyfileDigest: digest('c'),
      hostSecurityConfigDigest: digest('d'), selectorInventoryRevision: revision('a'), executionPolicyRevision: revision('b') }
    const forged = { ...evidence, migrations: [], currentEpoch: 2 }
    await expect(validateApprovedD1HostRelease(value, { ...identity, migrationEvidence: forged }))
      .rejects.toMatchObject({ details: { field: 'databaseSchemaCompatibility' } })
    const inconsistent = { ...evidence, migrations: evidence.migrations.map((migration, index) => index === 0
      ? { ...migration, sqlDigest: digest('f') } : migration) }
    await expect(validateApprovedD1HostRelease(value, { ...identity, migrationEvidence: inconsistent }))
      .rejects.toMatchObject({ details: { field: 'databaseSchemaCompatibility' } })
  })
})
