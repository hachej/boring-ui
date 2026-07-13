import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, statfsSync, type Stats } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'

import {
  closeAttestedD1DatabaseConnection,
  createD1AdmissionLedger,
  type AttestedD1DatabaseConnection,
  type D1AdmissionLedger,
} from './admissionLedger.js'
import { createD1CommandEngine, type D1CommandEngineOptions, type D1MutationGuard } from './d1Command.js'
import { parseD1CliInput } from './d1CommandCliProtocol.js'
import { isSupportedLocalD1LockFilesystem } from './d1CommandLockPolicy.js'
import { createD1DestructivePublicationJournalStore } from './destructivePublicationJournal.js'
import { createD1FileRuntimeInputsProvider } from './d1FileRuntimeInputsProvider.js'
import { createD1FencedDestructivePublication } from './fencedDestructivePublication.js'
import { D1HostError, D1HostErrorCode } from './d1Plan.js'
import { createD1BindingSecretMaterializer, createD1RuntimeInputsInspector } from './d1SecretMaterializer.js'
import { createHostRevisionStore } from './hostRevisionStore.js'

const MAX_BYTES = 1024 * 1024
const D1_APP_UID = 10001
const D1_APP_GID = 10001
export type D1EntryMode = '--read-only' | '--locked'
export interface D1EntryContext { readonly hostId: string; readonly ownerUid: number; readonly stateRoot: string; readonly mutationGuard: D1MutationGuard; readonly admissionLedger?: D1AdmissionLedger }
export type D1DependencyFactory = (context: D1EntryContext) => D1CommandEngineOptions
export interface D1EntryOptions { readonly stdin?: Readable; readonly mode: D1EntryMode; readonly dependencyFactory?: D1DependencyFactory; readonly databaseConnection?: AttestedD1DatabaseConnection }
export interface D1EntryOutput { readonly line: string; readonly exitCode: number }

function invalid(field: string): never { throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field }) }
function failure(code: D1HostErrorCode, field: string, exitCode: number): D1EntryOutput {
  return { line: `${JSON.stringify({ ok: false, error: { code, details: { field } } })}\n`, exitCode }
}
function absolute(value: string | undefined, field: string): string {
  if (!value || !path.isAbsolute(value) || path.resolve(value) !== value) invalid(field)
  return value
}
function configuredOwner(): number {
  const value = process.env.BORING_D1_OWNER_UID
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) invalid('ownerUid')
  const uid = Number(value)
  if (!Number.isSafeInteger(uid) || typeof process.geteuid !== 'function' || process.geteuid() !== uid) invalid('ownerUid')
  return uid
}
async function readBounded(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    size += chunk.length
    if (size > MAX_BYTES) invalid('stdin')
    chunks.push(chunk)
  }
  if (size === 0) invalid('stdin')
  return Buffer.concat(chunks)
}
function lockPathInfo(lockRoot: string, hostId: string, uid: number): { path: string; info: Stats } {
  let root: Stats
  try { root = lstatSync(lockRoot) } catch { invalid('lockRoot') }
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== uid || (root.mode & 0o777) !== 0o700 || realpathSync(lockRoot) !== lockRoot) invalid('lockRoot')
  if (!isSupportedLocalD1LockFilesystem(statfsSync(lockRoot).type)) invalid('lockRoot')
  const file = path.join(lockRoot, `${hostId}.lock`); let info: Stats
  try { info = lstatSync(file) } catch { invalid('hostLock') }
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.nlink !== 1) invalid('hostLock')
  return { path: file, info }
}
function assertInheritedIdentity(lockRoot: string, hostId: string, uid: number): void {
  const expected = lockPathInfo(lockRoot, hostId, uid).info; let actual: Stats
  try { actual = fstatSync(3) } catch { invalid('hostLock') }
  if (!actual.isFile() || expected.dev !== actual.dev || expected.ino !== actual.ino || actual.uid !== uid || (actual.mode & 0o777) !== 0o600 || actual.nlink !== 1) invalid('hostLock')
}
function probeRetainedLock(lockRoot: string, hostId: string, uid: number): void {
  const expected = lockPathInfo(lockRoot, hostId, uid); let fd: number
  try { fd = openSync(expected.path, constants.O_RDWR | constants.O_NOFOLLOW) } catch { invalid('hostLock') }
  try {
    const actual = fstatSync(fd)
    if (actual.dev !== expected.info.dev || actual.ino !== expected.info.ino || actual.uid !== uid || (actual.mode & 0o777) !== 0o600 || actual.nlink !== 1) invalid('hostLock')
    const probe = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], { shell: false, stdio: ['ignore', 'ignore', 'ignore', fd] })
    if (probe.error || probe.status !== 75) invalid('hostLock')
  } finally { closeSync(fd) }
}
function assertInheritedLock(lockRoot: string, hostId: string, uid: number): void {
  assertInheritedIdentity(lockRoot, hostId, uid)
  probeRetainedLock(lockRoot, hostId, uid)
  const acquired = spawnSync('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '3'], {
    shell: false, stdio: ['ignore', 'ignore', 'ignore', 3],
  })
  if (acquired.status === 75) throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'hostLock' })
  if (acquired.error || acquired.status !== 0) invalid('hostLock')
}
function unavailable(field: string): never { throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field }) }

export const createProductionD1Dependencies: D1DependencyFactory = ({ hostId, ownerUid, stateRoot, mutationGuard, admissionLedger }) => {
  const provider = createD1FileRuntimeInputsProvider({ hostId, ownerUid })
  const store = createHostRevisionStore({ root: stateRoot, ownerUid, appGid: D1_APP_GID })
  const fencedPublication = admissionLedger
    ? createD1FencedDestructivePublication({ admissionLedger, journalStore: createD1DestructivePublicationJournalStore(), revisionStore: store })
    : undefined
  return {
    store,
    resolver: { resolvePlan: async () => unavailable('resolver'), reproduce: async () => unavailable('resolver') },
    effects: {
      loadAdmittedBindingIds: admissionLedger
        ? (requestedHostId, databaseRef) => admissionLedger.listBindingIds(requestedHostId, databaseRef)
        : async () => unavailable('admissions'),
      materialize: createD1BindingSecretMaterializer({ root: '/run/boring/d1', ownerUid, appUid: D1_APP_UID, appGid: D1_APP_GID, provider }),
      preload: async () => unavailable('preload'),
      verifyActive: async () => unavailable('active'),
    },
    inspectRuntimeInputs: createD1RuntimeInputsInspector(provider),
    mutationGuard,
    ...(fencedPublication ? { fencedPublication } : {}),
    operator: { uid: ownerUid, effectiveUser: os.userInfo().username, invocationId: randomUUID() },
    clock: () => new Date().toISOString(),
  }
}

export async function runD1CommandEntry(options: D1EntryOptions): Promise<D1EntryOutput> {
  let locked = false
  let admissionLedger: D1AdmissionLedger | undefined
  try {
    if (options.mode !== '--read-only' && options.mode !== '--locked') invalid('mode')
    if (process.platform !== 'linux') invalid('platform')
    const ownerUid = configuredOwner()
    const stateRoot = absolute(process.env.BORING_D1_STATE_ROOT, 'stateRoot')
    const lockRoot = absolute(process.env.BORING_D1_LOCK_ROOT, 'lockRoot')
    const { raw, identity: command } = parseD1CliInput(await readBounded(options.stdin ?? process.stdin))
    if ((options.mode === '--read-only') !== (command.kind === 'plan')) invalid('mode')
    let assertHeld: (hostId: string) => void = (_hostId) => { throw new D1HostError(D1HostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
    if (options.mode === '--locked') {
      assertInheritedLock(lockRoot, command.hostId, ownerUid)
      locked = true
      assertHeld = (hostId: string) => {
        if (hostId !== command.hostId) invalid('hostLock')
        assertInheritedLock(lockRoot, hostId, ownerUid)
      }
    }
    admissionLedger = options.databaseConnection ? createD1AdmissionLedger(options.databaseConnection) : undefined
    const engine = createD1CommandEngine((options.dependencyFactory ?? createProductionD1Dependencies)({
      hostId: command.hostId, ownerUid, stateRoot, mutationGuard: { assertHeld }, admissionLedger,
    }))
    const result = await engine.execute(raw)
    return { line: `${JSON.stringify({ ok: true, result })}\n`, exitCode: 0 }
  } catch (error) {
    if (error instanceof D1HostError) {
      const field = typeof error.details.field === 'string' && /^[A-Za-z0-9.[\]_-]{1,80}$/.test(error.details.field) ? error.details.field : 'command'
      const exitCode = error.code === D1HostErrorCode.PLAN_INVALID ? 2 : error.code === D1HostErrorCode.REVISION_CONFLICT ? 3 : 4
      return failure(error.code, field, exitCode)
    }
    return failure(D1HostErrorCode.PUBLICATION_FAILED, 'command', 70)
  } finally {
    if (admissionLedger) await admissionLedger.close().catch(() => {})
    else if (options.databaseConnection) await closeAttestedD1DatabaseConnection(options.databaseConnection).catch(() => {})
    if (locked) closeSync(3)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const mode = args.length === 1 && (args[0] === '--read-only' || args[0] === '--locked') ? args[0] : null
  const output = mode ? await runD1CommandEntry({ mode }) : failure(D1HostErrorCode.PLAN_INVALID, 'mode', 2)
  process.stdout.write(output.line); process.exitCode = output.exitCode
}
