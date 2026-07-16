#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIGRATION_DOMAIN = 'boring-agent-host-migration-set:v1'
const MIGRATION_TAG = /^[a-z0-9][a-z0-9_]{0,127}$/
const INVALID_EVIDENCE = 'AgentHost migration evidence is invalid'

export const AGENT_HOST_DEPLOYMENT_MIGRATION_SOURCES = Object.freeze([
  'apps/full-app/src/server/migrate.ts',
  'packages/core/src/server/migrations.ts',
  'packages/core/src/server/db/migrate.ts',
  'plugins/boring-automation/src/server/migrations.ts',
])

function fail() {
  throw new Error(INVALID_EVIDENCE)
}

function dataRecord(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail()
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expected.length
    || expected.some((key) => !keys.includes(key))) fail()
  const snapshot = {}
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail()
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function dataArray(value, maxLength = 10_000) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail()
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value)
    || length.value < 0 || length.value > maxLength) fail()
  const indices = Array.from({ length: length.value }, (_, index) => String(index))
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== indices.length + 1
    || !keys.includes('length') || indices.some((key) => !keys.includes(key))) fail()
  return indices.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail()
    return descriptor.value
  })
}

function epoch(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail()
  return value
}

function rawDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function createEvidence(journalValue, sqlEntries, deploymentSourceEntries) {
  const journal = dataRecord(journalValue, ['version', 'dialect', 'entries'])
  if (journal.version !== '7' || journal.dialect !== 'postgresql') fail()
  const entries = dataArray(journal.entries)
  let previousWhen = -1
  const parsedEntries = entries.map((value, index) => {
    const input = dataRecord(value, ['idx', 'version', 'when', 'tag', 'breakpoints'])
    if (input.idx !== index || input.version !== journal.version || typeof input.breakpoints !== 'boolean'
      || typeof input.tag !== 'string' || !MIGRATION_TAG.test(input.tag)
      || !input.tag.startsWith(`${String(index).padStart(4, '0')}_`)) fail()
    const when = epoch(input.when)
    if (when <= previousWhen) fail()
    previousWhen = when
    return { idx: index, version: journal.version, when, tag: input.tag, breakpoints: input.breakpoints }
  })

  const sqlByFile = new Map()
  for (const input of sqlEntries) {
    if (typeof input.file !== 'string' || sqlByFile.has(input.file)) fail()
    sqlByFile.set(input.file, input.bytes)
  }
  const sourceByFile = new Map()
  for (const input of deploymentSourceEntries) {
    if (typeof input.file !== 'string' || sourceByFile.has(input.file)
      || !AGENT_HOST_DEPLOYMENT_MIGRATION_SOURCES.includes(input.file)) fail()
    sourceByFile.set(input.file, input.bytes)
  }
  if (sourceByFile.size !== AGENT_HOST_DEPLOYMENT_MIGRATION_SOURCES.length) fail()

  const migrations = parsedEntries.map((entry) => {
    const file = `${entry.tag}.sql`
    const bytes = sqlByFile.get(file)
    if (!bytes) fail()
    sqlByFile.delete(file)
    return { ...entry, file, sqlDigest: rawDigest(bytes) }
  })
  if (sqlByFile.size !== 0 || sqlEntries.length !== entries.length) fail()
  const deploymentSources = AGENT_HOST_DEPLOYMENT_MIGRATION_SOURCES.map((file) => ({
    file,
    sourceDigest: rawDigest(sourceByFile.get(file)),
  }))
  const manifest = {
    schemaVersion: 1,
    domain: MIGRATION_DOMAIN,
    journalVersion: journal.version,
    dialect: journal.dialect,
    migrations,
    deploymentSources,
  }
  return {
    schemaVersion: 1,
    domain: MIGRATION_DOMAIN,
    currentEpoch: entries.length,
    migrationSetDigest: rawDigest(JSON.stringify(manifest)),
    migrations,
    deploymentSources,
  }
}

export function createAgentHostMigrationSetEvidenceFromRepository(repositoryRoot) {
  try {
    const drizzleRoot = resolve(repositoryRoot, 'packages/core/drizzle')
    const journal = JSON.parse(readFileSync(resolve(drizzleRoot, 'meta/_journal.json'), 'utf8'))
    const sqlEntries = readdirSync(drizzleRoot)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => ({ file, bytes: readFileSync(resolve(drizzleRoot, file)) }))
    const deploymentSources = AGENT_HOST_DEPLOYMENT_MIGRATION_SOURCES.map((file) => ({
      file,
      bytes: readFileSync(resolve(repositoryRoot, file)),
    }))
    return createEvidence(journal, sqlEntries, deploymentSources)
  } catch {
    fail()
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return {}
  if (argv.length === 1 && argv[0] === '--github-output') return { githubOutput: true }
  fail()
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const evidence = createAgentHostMigrationSetEvidenceFromRepository(repositoryRoot)
  if (args.githubOutput) {
    process.stdout.write(`migration_set_digest=${evidence.migrationSetDigest}\ncurrent_epoch=${evidence.currentEpoch}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main()
  } catch {
    console.error(`ERR ${INVALID_EVIDENCE}`)
    process.exitCode = 1
  }
}
