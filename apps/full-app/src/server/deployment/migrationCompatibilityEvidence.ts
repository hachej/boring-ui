import { createHash } from 'node:crypto'
import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'
import { isApprovedD1HostRelease, type ApprovedD1HostRelease } from './approvedHostReleaseCapability.js'
import { d1Digest, D1HostError, D1HostErrorCode } from './d1Plan.js'
import type { D1HostProcess } from './edgeNetworkPreflight.js'

const DOMAIN = 'boring-d1-migration-compatibility:v1' as const
const DIRECTORY = '/opt/boring/d1'; const NETWORK = 'boring-d1_migration-db'
const SECRET_TARGET = '/run/boring/d1/host-secrets/database-url'
const MAX_INSPECT_BYTES = 512 * 1024
const OBSERVATION_KEYS = ['schemaVersion', 'domain', 'hostId', 'currentImageId', 'previousImageId', 'migrationSetDigest', 'currentEpoch', 'policyDigest', 'rehearsal'] as const
const verifiedEvidence = new WeakSet<object>()
const stoppedSpecs = new WeakSet<object>(); const stoppedProcesses = new WeakMap<object, D1HostProcess>()
const stoppedApprovals = new WeakMap<object, ApprovedD1HostRelease>(); const previousImages = new WeakMap<object, ApprovedD1HostRelease>()

export interface D1StoppedMigrationSpec { readonly containerName: string; readonly policyDigest: Sha256Digest }
export interface VerifiedD1PreviousReleaseImage { readonly imageRef: string; readonly imageId: Sha256Digest }
export interface D1MigrationCompatibilityObservationV1 {
  readonly schemaVersion: 1; readonly domain: typeof DOMAIN; readonly hostId: string
  readonly currentImageId: Sha256Digest; readonly previousImageId: Sha256Digest | null
  readonly migrationSetDigest: Sha256Digest; readonly currentEpoch: number; readonly policyDigest: Sha256Digest
  readonly rehearsal: 'first-boot' | 'cross-version-read-write'
}
export interface VerifiedD1MigrationCompatibility extends D1MigrationCompatibilityObservationV1 {}

function unavailable(): never { throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: 'migrationCompatibility' }) }
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
  const prototype = Object.getPrototypeOf(value); const keys = Reflect.ownKeys(value)
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== 'string')
    || keys.length !== OBSERVATION_KEYS.length || OBSERVATION_KEYS.some((key) => !keys.includes(key))) throw new Error()
  const output: Record<string, unknown> = {}
  for (const key of OBSERVATION_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(); output[key] = descriptor.value }
  return output
}
function array(value: unknown): readonly unknown[] { if (value === null) return []; if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(); return value }
function plain(value: unknown): Readonly<Record<string, unknown>> { if (!value || typeof value !== 'object' || Array.isArray(value)
  || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error(); return value as Readonly<Record<string, unknown>> }
function exactStrings(value: unknown, expected: readonly string[]): boolean { const actual = array(value); return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]) }
function parseInspect(raw: unknown): unknown { if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_INSPECT_BYTES) throw new Error(); return JSON.parse(raw) }
function migrationSource(hostId: string): string { return `/run/boring/d1/${hostId}/host-secrets/database-url` }
function name(approved: ApprovedD1HostRelease): string { return `boring-d1-migration-${createHash('sha256').update(`${approved.hostId}\0${approved.coreImageRef}`).digest('hex').slice(0, 24)}` }
function policy(approved: ApprovedD1HostRelease): Readonly<Record<string, unknown>> { return Object.freeze({
  schemaVersion: 1, domain: DOMAIN, hostId: approved.hostId, imageId: approved.artifacts.coreImageId, imageRef: approved.coreImageRef,
  command: approved.record.migrationProcess, runtime: 'runsc', network: NETWORK, databaseSecret: 'approved-host-database-url-file', mounts: ['database-secret:ro'],
}) }

export async function createD1StoppedMigrationSpec(approved: ApprovedD1HostRelease): Promise<D1StoppedMigrationSpec> {
  if (!isApprovedD1HostRelease(approved)) return unavailable()
  const containerName = name(approved); const source = migrationSource(approved.hostId)
  const args = ['create', '--name', containerName, '--runtime', 'runsc', '--network', NETWORK, '--read-only', '--user', '10001:10001',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=bind,src=${source},dst=${SECRET_TARGET},readonly`,
    '--env', `DATABASE_URL_FILE=${SECRET_TARGET}`, '--entrypoint', 'node', approved.coreImageRef, 'apps/full-app/dist/server/migrate.js']
  const process = Object.freeze({
    command: 'docker', args: Object.freeze(args), cwd: DIRECTORY, env: Object.freeze({}), shell: false, maxStdoutBytes: 512 * 1024,
  }); const spec = Object.freeze({ containerName, policyDigest: await createAgentAssetDigest(JSON.stringify(policy(approved))) })
  stoppedSpecs.add(spec); stoppedProcesses.set(spec, process); stoppedApprovals.set(spec, approved); return spec
}

export function isD1StoppedMigrationSpec(value: unknown): value is D1StoppedMigrationSpec { return typeof value === 'object' && value !== null && stoppedSpecs.has(value) }
function expectedEnvironment(approved: ApprovedD1HostRelease): readonly string[] { const defaults = approved.artifacts.imageDefaults; return [
  `PATH=${defaults.path}`, `NODE_VERSION=${defaults.nodeVersion}`, `YARN_VERSION=${defaults.yarnVersion}`, 'NODE_ENV=production',
  'BORING_AGENT_MODE=vercel-sandbox', 'BORING_AGENT_WORKSPACE_ROOT=/data/workspaces', 'BORING_AGENT_SESSION_ROOT=/data/pi-sessions',
  `DATABASE_URL_FILE=${SECRET_TARGET}`,
] }

export function verifyD1StoppedMigrationInspect(approved: ApprovedD1HostRelease, spec: D1StoppedMigrationSpec, raw: string): void {
  try {
    const parsed: unknown = parseInspect(raw)
    if (!isApprovedD1HostRelease(approved) || !isD1StoppedMigrationSpec(spec) || !stoppedProcesses.has(spec)
      || stoppedApprovals.get(spec) !== approved || !Array.isArray(parsed) || parsed.length !== 1) throw new Error()
    const value = parsed[0] as Record<string, unknown>; const config = value.Config as Record<string, unknown>
    const host = value.HostConfig as Record<string, unknown>; const state = value.State as Record<string, unknown>; const mounts = array(value.Mounts); const mount = mounts[0] as Record<string, unknown>
    const network = plain(value.NetworkSettings); const networks = plain(network.Networks); const ports = plain(network.Ports)
    const bindings = host.PortBindings === null ? {} : plain(host.PortBindings)
    if (value.Name !== `/${spec.containerName}` || value.Image !== approved.artifacts.coreImageId || state.Status !== 'created' || state.Running !== false
      || config.Image !== approved.coreImageRef || config.User !== '10001:10001' || !exactStrings(config.Entrypoint, ['node'])
      || !exactStrings(config.Cmd, ['apps/full-app/dist/server/migrate.js']) || !exactStrings(config.Env, expectedEnvironment(approved))
      || host.ReadonlyRootfs !== true || host.Privileged !== false || host.Runtime !== 'runsc' || host.NetworkMode !== NETWORK || !exactStrings(host.CapDrop, ['ALL'])
      || !exactStrings(host.CapAdd, []) || !exactStrings(host.SecurityOpt, ['no-new-privileges:true']) || host.PidMode !== '' || host.IpcMode !== 'private'
      || host.UTSMode !== '' || host.UsernsMode !== '' || array(host.Devices).length !== 0 || array(host.DeviceRequests).length !== 0 || mounts.length !== 1
      || Object.keys(networks).length !== 1 || !Object.hasOwn(networks, NETWORK) || Object.keys(bindings).length !== 0
      || Object.values(ports).some((port) => port !== null) || mount.Type !== 'bind' || mount.Source !== migrationSource(approved.hostId)
      || mount.Destination !== SECRET_TARGET || mount.RW !== false) throw new Error()
  } catch { return unavailable() }
}

export function verifyD1PreviousReleaseInspect(approved: ApprovedD1HostRelease, raw: string): VerifiedD1PreviousReleaseImage {
  try {
    const parsed = parseInspect(raw); if (!isApprovedD1HostRelease(approved) || approved.record.previousCoreImageRef === null
      || !Array.isArray(parsed) || parsed.length !== 1) throw new Error()
    const image = parsed[0] as Record<string, unknown>; const imageId = d1Digest(image.Id, 'previousImageId')
    if (image.Architecture !== 'amd64' || image.Os !== 'linux' || !array(image.RepoDigests).includes(approved.record.previousCoreImageRef)) throw new Error()
    const evidence = Object.freeze({ imageRef: approved.record.previousCoreImageRef, imageId }); previousImages.set(evidence, approved); return evidence
  } catch { return unavailable() }
}

function observation(approved: ApprovedD1HostRelease, raw: unknown): D1MigrationCompatibilityObservationV1 {
  const value = record(raw); const previous = value.previousImageId === null ? null : d1Digest(value.previousImageId, 'previousImageId')
  const expectedRehearsal = approved.record.previousCoreImageRef === null ? 'first-boot' : 'cross-version-read-write'
  if (value.schemaVersion !== 1 || value.domain !== DOMAIN || value.hostId !== approved.hostId || value.currentImageId !== approved.artifacts.coreImageId
    || (previous === null) !== (approved.record.previousCoreImageRef === null) || value.migrationSetDigest !== approved.artifacts.migrationSetDigest
    || value.currentEpoch !== approved.artifacts.currentEpoch || !Number.isSafeInteger(value.currentEpoch) || value.rehearsal !== expectedRehearsal) throw new Error()
  return Object.freeze({ schemaVersion: 1, domain: DOMAIN, hostId: approved.hostId, currentImageId: approved.artifacts.coreImageId,
    previousImageId: previous, migrationSetDigest: approved.artifacts.migrationSetDigest, currentEpoch: approved.artifacts.currentEpoch,
    policyDigest: d1Digest(value.policyDigest, 'policyDigest'), rehearsal: expectedRehearsal })
}
export async function digestD1MigrationCompatibilityObservation(approved: ApprovedD1HostRelease, raw: unknown): Promise<Sha256Digest> {
  try { if (!isApprovedD1HostRelease(approved)) throw new Error(); const parsed = observation(approved, raw)
    if (parsed.policyDigest !== await createAgentAssetDigest(JSON.stringify(policy(approved)))) throw new Error()
    return await createAgentAssetDigest(JSON.stringify(parsed)) } catch { return unavailable() }
}
export async function approveD1MigrationCompatibility(approved: ApprovedD1HostRelease, raw: unknown, previousImage: unknown = null): Promise<VerifiedD1MigrationCompatibility> {
  let parsed: D1MigrationCompatibilityObservationV1
  try { if (!isApprovedD1HostRelease(approved)) throw new Error(); parsed = observation(approved, raw) } catch { return unavailable() }
  if (approved.record.previousCoreImageRef === null ? previousImage !== null
    : previousImages.get(previousImage as object) !== approved || (previousImage as VerifiedD1PreviousReleaseImage).imageRef !== approved.record.previousCoreImageRef
      || (previousImage as VerifiedD1PreviousReleaseImage).imageId !== parsed.previousImageId) unavailable()
  if (await digestD1MigrationCompatibilityObservation(approved, parsed) !== approved.record.databaseSchemaCompatibility.rehearsalEvidenceDigest) unavailable()
  const evidence = Object.freeze({ ...parsed }); verifiedEvidence.add(evidence); return evidence
}
export function isVerifiedD1MigrationCompatibility(value: unknown): value is VerifiedD1MigrationCompatibility {
  return typeof value === 'object' && value !== null && verifiedEvidence.has(value)
}
