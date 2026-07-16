import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, statfsSync, type Stats } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable } from 'node:stream'
import { AgentDefinitionValidationError, AgentDeploymentValidationError } from '@hachej/boring-agent/shared'
import postgres from 'postgres'

import {
  closeAttestedAgentHostDatabaseConnection,
  createAgentHostAdmissionLedger,
  mintAttestedAgentHostDatabaseConnection,
  type AttestedAgentHostDatabaseConnection,
  type AgentHostAdmissionLedger,
} from './admissionLedger.js'
import { createAgentHostCommandEngine, type AgentHostCommandEngineOptions, type AgentHostMutationGuard } from './agentHostCommand.js'
import {
  AGENT_HOST_AUTHORITY_FILE_ENV,
  createDefaultAgentHostAuthority,
  readAgentHostAuthorityDatabaseUrl,
  readInheritedAgentHostAuthorityDescriptor,
  type AgentHostAuthorityDescriptorV1,
} from './agentHostAuthority.js'
import { runAgentHostComposeAction, type AgentHostComposeProcess } from './composeAdapter.js'
import { parseAgentHostCliInput } from './agentHostCommandCliProtocol.js'
import { isSupportedLocalAgentHostLockFilesystem } from './agentHostCommandLockPolicy.js'
import { createAgentHostDestructivePublicationJournalStore } from './destructivePublicationJournal.js'
import { createAgentHostFileRuntimeInputsProvider } from './agentHostFileRuntimeInputsProvider.js'
import { createAgentHostFencedDestructivePublication } from './fencedDestructivePublication.js'
import { AgentHostError, AgentHostErrorCode } from './agentHostPlan.js'
import { createAgentHostRootPublicationClient } from './agentHostPublicationControl.js'
import { createAgentHostRootDesiredResolver } from './agentHostRootDesiredResolver.js'
import { createAgentHostBindingSecretMaterializer, createAgentHostRuntimeInputsInspector } from './agentHostSecretMaterializer.js'
import { createHostRevisionStore } from './hostRevisionStore.js'
import { loadAgentHostAgentArtifactInputs } from './agentHostAgentArtifactSnapshot.js'
import { AGENT_HOST_V1_COLLECTION_LIMITS, type AgentHostCollectionLimits } from './bootCollection.js'

const MAX_BYTES = 1024 * 1024
const AGENT_HOST_APP_UID = 10001
const AGENT_HOST_APP_GID = 10001
export type AgentHostEntryMode = '--read-only' | '--locked'
export interface AgentHostEntryContext { readonly hostId: string; readonly ownerUid: number; readonly stateRoot: string; readonly authority?: AgentHostAuthorityDescriptorV1; readonly collectionLimits: AgentHostCollectionLimits; readonly mutationGuard: AgentHostMutationGuard; readonly admissionLedger?: AgentHostAdmissionLedger }
export type AgentHostDependencyFactory = (context: AgentHostEntryContext) => AgentHostCommandEngineOptions
export interface AgentHostEntryOptions { readonly stdin?: Readable; readonly mode: AgentHostEntryMode; readonly collectionLimits?: AgentHostCollectionLimits; readonly dependencyFactory?: AgentHostDependencyFactory; readonly databaseConnection?: AttestedAgentHostDatabaseConnection }
export interface AgentHostEntryOutput { readonly line: string; readonly exitCode: number }

function invalid(field: string): never { throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field }) }
function failure(code: AgentHostErrorCode, field: string, exitCode: number): AgentHostEntryOutput {
  return { line: `${JSON.stringify({ ok: false, error: { code, details: { field } } })}\n`, exitCode }
}
function absolute(value: string | undefined, field: string): string {
  if (!value || !path.isAbsolute(value) || path.resolve(value) !== value) invalid(field)
  return value
}
function configuredOwner(): number {
  const value = process.env.BORING_AGENT_HOST_OWNER_UID
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
  if (!isSupportedLocalAgentHostLockFilesystem(statfsSync(lockRoot).type)) invalid('lockRoot')
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
  if (acquired.status === 75) throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'hostLock' })
  if (acquired.error || acquired.status !== 0) invalid('hostLock')
}
function unavailable(field: string): never { throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field }) }
function composeImages() {
  const ingressImage = process.env.AGENT_HOST_INGRESS_IMAGE; const coreAppImage = process.env.AGENT_HOST_CORE_APP_IMAGE
  if (!ingressImage || !coreAppImage) invalid('composeImages')
  return Object.freeze({ schemaVersion: 1 as const, ingressImage, coreAppImage })
}
const runComposeProcess = (value: AgentHostComposeProcess) => new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(value.command, value.args, { cwd: value.cwd, env: { ...process.env, ...value.env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { if ((stdout += chunk).length > 1024 * 1024) child.kill() })
  child.stderr.on('data', (chunk: string) => { if ((stderr += chunk).length > 1024 * 1024) child.kill() })
  child.once('error', reject); child.once('close', (code) => resolve({ exitCode: code ?? 70, stdout, stderr }))
})

export const createProductionAgentHostDependencies: AgentHostDependencyFactory = ({ hostId, ownerUid, stateRoot, authority: suppliedAuthority, collectionLimits, mutationGuard, admissionLedger }) => {
  const authority = suppliedAuthority ?? createDefaultAgentHostAuthority({ hostId, operatorUid: ownerUid, stateRoot, lockRoot: process.env.BORING_AGENT_HOST_LOCK_ROOT ?? '/run/boring/agent-host/locks' })
  const provider = createAgentHostFileRuntimeInputsProvider({ hostId, ownerUid })
  const store = createHostRevisionStore({ root: authority.stateRoot, ownerUid, appGid: AGENT_HOST_APP_GID }); const invocationId = randomUUID()
  const publication = createAgentHostRootPublicationClient({ hostId, hostRoot: path.join(authority.stateRoot, hostId), ownerUid, appGid: AGENT_HOST_APP_GID,
    operationId: invocationId, revisionStore: store, controlRoot: authority.controlRoot,
    startCore: (candidate) => runAgentHostComposeAction('initial', { ...candidate.desired.plan, expectedHostRevision: null }, composeImages(), runComposeProcess, authority),
    startIngress: (candidate) => runAgentHostComposeAction('start-ingress', { ...candidate.desired.plan, expectedHostRevision: null }, composeImages(), runComposeProcess, authority),
  })
  const fencedPublication = admissionLedger
    ? createAgentHostFencedDestructivePublication({ admissionLedger, journalStore: createAgentHostDestructivePublicationJournalStore(), revisionStore: store, publicationControl: publication })
    : undefined
  return {
    store,
    resolver: createAgentHostRootDesiredResolver({ hostId, ownerUid, limits: collectionLimits, revisionStore: store }),
    effects: {
      loadAgentArtifacts: (desired) => loadAgentHostAgentArtifactInputs({
        hostId, ownerUid, limits: collectionLimits,
        inputs: desired.plan.bindings.map((binding, index) => ({ binding, compositionDigest: desired.resolvedBindings[index]!.composition.digest })),
      }),
      loadRevisionAgentArtifacts: async (target) => Promise.all(target.desired.plan.bindings.map(async (binding, index) => {
        const envelope = await store.readAgentArtifact(hostId, target.revisionId, binding.bindingId)
        if (!envelope) throw new AgentHostError(AgentHostErrorCode.PUBLICATION_FAILED, { field: 'agentArtifacts' })
        return Object.freeze({ envelope })
      })),
      loadAdmittedBindingIds: admissionLedger
        ? (requestedHostId, databaseRef) => admissionLedger.listBindingIds(requestedHostId, databaseRef)
        : async () => unavailable('admissions'),
      materialize: createAgentHostBindingSecretMaterializer({ root: authority.materializedRoot, ownerUid, appUid: AGENT_HOST_APP_UID, appGid: AGENT_HOST_APP_GID, provider }),
      preload: publication.preload,
      verifyActive: publication.verifyActive,
    },
    inspectRuntimeInputs: createAgentHostRuntimeInputsInspector(provider),
    mutationGuard,
    ...(fencedPublication ? { fencedPublication } : {}),
    operator: { uid: ownerUid, effectiveUser: os.userInfo().username, invocationId },
    clock: () => new Date().toISOString(),
  }
}

export async function runAgentHostCommandEntry(options: AgentHostEntryOptions): Promise<AgentHostEntryOutput> {
  let locked = false
  let inheritedAuthority = false
  let databaseConnection = options.databaseConnection
  let admissionLedger: AgentHostAdmissionLedger | undefined
  try {
    if (options.mode !== '--read-only' && options.mode !== '--locked') invalid('mode')
    if (process.platform !== 'linux') invalid('platform')
    const ownerUid = configuredOwner()
    const { raw, identity: command } = parseAgentHostCliInput(await readBounded(options.stdin ?? process.stdin))
    const descriptorPath = process.env[AGENT_HOST_AUTHORITY_FILE_ENV]
    const authority = descriptorPath !== undefined
      ? await readInheritedAgentHostAuthorityDescriptor(4, descriptorPath, command.hostId)
      : createDefaultAgentHostAuthority({ hostId: command.hostId, operatorUid: ownerUid,
          stateRoot: absolute(process.env.BORING_AGENT_HOST_STATE_ROOT, 'stateRoot'),
          lockRoot: absolute(process.env.BORING_AGENT_HOST_LOCK_ROOT, 'lockRoot'),
          ...(process.env.BORING_AGENT_HOST_DATABASE_REF ? { databaseRef: process.env.BORING_AGENT_HOST_DATABASE_REF } : {}) })
    inheritedAuthority = descriptorPath !== undefined
    if (authority.operatorUid !== ownerUid) invalid('authority')
    const stateRoot = authority.stateRoot; const lockRoot = authority.lockRoot
    if ((options.mode === '--read-only') !== (command.kind === 'plan')) invalid('mode')
    let assertHeld: (hostId: string) => void = (_hostId) => { throw new AgentHostError(AgentHostErrorCode.REVISION_CONFLICT, { field: 'hostLock' }) }
    if (options.mode === '--locked') {
      assertInheritedLock(lockRoot, command.hostId, ownerUid)
      locked = true
      assertHeld = (hostId: string) => {
        if (hostId !== command.hostId) invalid('hostLock')
        assertInheritedLock(lockRoot, hostId, ownerUid)
      }
    }
    if (!databaseConnection && authority.databaseRef !== null) {
      const client = postgres(await readAgentHostAuthorityDatabaseUrl(authority), { max: 4 })
      databaseConnection = mintAttestedAgentHostDatabaseConnection(authority.databaseRef, client, { ownsClient: true })
    }
    admissionLedger = databaseConnection ? createAgentHostAdmissionLedger(databaseConnection) : undefined
    const engine = createAgentHostCommandEngine((options.dependencyFactory ?? createProductionAgentHostDependencies)({
      hostId: command.hostId, ownerUid, stateRoot, authority, collectionLimits: options.collectionLimits ?? AGENT_HOST_V1_COLLECTION_LIMITS, mutationGuard: { assertHeld }, admissionLedger,
    }))
    const result = await engine.execute(raw)
    return { line: `${JSON.stringify({ ok: true, result })}\n`, exitCode: 0 }
  } catch (error) {
    if (error instanceof AgentDefinitionValidationError || error instanceof AgentDeploymentValidationError) {
      return failure(AgentHostErrorCode.PUBLICATION_FAILED, 'agentArtifacts', 4)
    }
    if (error instanceof AgentHostError) {
      const field = typeof error.details.field === 'string' && /^[A-Za-z0-9.[\]_-]{1,80}$/.test(error.details.field) ? error.details.field : 'command'
      const exitCode = error.code === AgentHostErrorCode.PLAN_INVALID ? 2 : error.code === AgentHostErrorCode.REVISION_CONFLICT ? 3 : 4
      return failure(error.code, field, exitCode)
    }
    return failure(AgentHostErrorCode.PUBLICATION_FAILED, 'command', 70)
  } finally {
    if (admissionLedger) await admissionLedger.close().catch(() => {})
    else if (databaseConnection) await closeAttestedAgentHostDatabaseConnection(databaseConnection).catch(() => {})
    if (locked) closeSync(3)
    if (inheritedAuthority) try { closeSync(4) } catch {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const mode = args.length === 1 && (args[0] === '--read-only' || args[0] === '--locked') ? args[0] : null
  const output = mode ? await runAgentHostCommandEntry({ mode }) : failure(AgentHostErrorCode.PLAN_INVALID, 'mode', 2)
  process.stdout.write(output.line); process.exitCode = output.exitCode
}
