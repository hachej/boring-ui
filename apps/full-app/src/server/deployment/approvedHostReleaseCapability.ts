import { readCoreSecurityConfigProjection } from '@hachej/boring-core/server'
import type postgres from 'postgres'

import { createD1ApprovedHostArtifactEvidence, type D1ApprovedHostArtifactEvidenceV1 } from './approvedHostArtifactEvidence.js'
import { D1_SELECTOR_INVENTORY_REVISION, type ApprovedD1HostReleaseRecordV1 } from './approvedHostRelease.js'
import { readApprovedD1HostReleaseFile } from './approvedHostReleaseFile.js'
import type { D1AdmissionLedger } from './admissionLedger.js'
import { readD1CaddyfileAuthority } from './d1CaddyfileAuthority.js'
import { readD1CoreEnvAuthority, type D1CoreEnvV1 } from './d1CoreEnvAuthority.js'
import { D1_CADDY_IMAGE } from './d1IngressArtifacts.js'
import { D1HostError, D1HostErrorCode, strictD1HostId } from './d1Plan.js'
import { createD1HostSecurityConfig, type D1HostSecurityConfigV1 } from './hostSecurityConfig.js'
import type { D1HostProcess, D1HostRunner } from './edgeNetworkPreflight.js'

const COMPOSE_DIRECTORY = '/opt/boring/d1'
const MAX_INSPECT_BYTES = 512 * 1024
const PINNED_IMAGE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/
const approvedCapabilities = new WeakSet<object>()

export interface ApprovedD1HostRelease {
  readonly hostId: string
  readonly coreImageRef: string
  readonly databaseRef: string
  readonly observedDatabaseEpoch: number
  readonly record: ApprovedD1HostReleaseRecordV1
  readonly artifacts: D1ApprovedHostArtifactEvidenceV1
  readonly security: D1HostSecurityConfigV1
}

export interface D1HostReleaseApprovalInput {
  readonly hostId: string
  readonly ownerUid: number
  readonly coreImageRef: string
  readonly runner: D1HostRunner
  readonly admissionLedger: D1AdmissionLedger
}

type ApprovalField = 'approvedHostRelease' | 'coreImage' | 'ingressImage' | 'hostSecurityConfig' | 'databaseSchemaCompatibility'

function unavailable(field: ApprovalField): never {
  throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field })
}

function inspectProcess(imageRef: string): D1HostProcess {
  return Object.freeze({
    command: 'docker',
    args: Object.freeze(['image', 'inspect', imageRef]),
    cwd: COMPOSE_DIRECTORY,
    env: Object.freeze({}),
    shell: false,
    maxStdoutBytes: MAX_INSPECT_BYTES,
  })
}

function intendedCoreImageRef(value: unknown, record: ApprovedD1HostReleaseRecordV1): string {
  if (typeof value !== 'string' || !PINNED_IMAGE.test(value) || !value.endsWith(`@${record.hostAppImageDigest}`)) unavailable('coreImage')
  return value
}

async function inspectImage(runner: D1HostRunner, imageRef: string, field: ApprovalField): Promise<unknown> {
  try {
    const result = await runner(inspectProcess(imageRef))
    if (result.exitCode !== 0 || typeof result.stdout !== 'string' || new TextEncoder().encode(result.stdout).byteLength > MAX_INSPECT_BYTES) unavailable(field)
    return JSON.parse(result.stdout)
  } catch {
    return unavailable(field)
  }
}

async function databaseEpoch(sql: postgres.ReservedSql): Promise<number> {
  const rows = await sql<{ epoch: number }[]>`SELECT count(*)::int AS epoch FROM drizzle.__drizzle_migrations`
  const epoch = rows.length === 1 ? rows[0]?.epoch : undefined
  if (!Number.isSafeInteger(epoch) || (epoch as number) < 0) throw new Error()
  return epoch as number
}

async function liveDatabaseEpoch(ledger: D1AdmissionLedger, hostId: string): Promise<number> {
  try {
    return await ledger.withBindingFences([{ hostId, bindingId: 'd1-host-release-approval' }], databaseEpoch)
  } catch {
    return unavailable('databaseSchemaCompatibility')
  }
}

function rawEnvironment(hostId: string, coreEnv: D1CoreEnvV1, artifacts: D1ApprovedHostArtifactEvidenceV1): Readonly<Record<string, string>> {
  return Object.freeze({
    PATH: artifacts.imageDefaults.path,
    NODE_VERSION: artifacts.imageDefaults.nodeVersion,
    YARN_VERSION: artifacts.imageDefaults.yarnVersion,
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '3000',
    BORING_AGENT_MODE: 'vercel-sandbox',
    BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces',
    BORING_AGENT_SESSION_ROOT: '/data/pi-sessions',
    TRUST_PROXY_CIDRS: '192.168.255.250/32',
    TRUST_PROXY_HOPS: '1',
    BORING_D1_HOST_ID: hostId,
    ...coreEnv,
  })
}

function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error()
  return parsed
}

async function securityIdentity(
  hostId: string,
  ownerUid: number,
  coreEnv: D1CoreEnvV1,
  artifacts: D1ApprovedHostArtifactEvidenceV1,
): Promise<D1HostSecurityConfigV1> {
  try {
    if (!Number.isSafeInteger(ownerUid) || ownerUid < 0 || coreEnv.BORING_D1_OWNER_UID !== String(ownerUid)) throw new Error()
    const env = rawEnvironment(hostId, coreEnv, artifacts)
    const core = readCoreSecurityConfigProjection(env)
    return await createD1HostSecurityConfig(env, {
      imageDefaults: artifacts.imageDefaults,
      d1HostId: hostId,
      publicationOwnerUid: ownerUid,
      agentMode: 'vercel-sandbox',
      workspaceRoot: '/data/workspaces',
      sessionRoot: '/data/pi-sessions',
      trustedProxy: core.trustedProxy,
      externalPlugins: false,
      pluginAuthoring: false,
      betterAuthUrl: core.betterAuthUrl,
      corsOrigins: core.corsOrigins,
      cspEnabled: core.cspEnabled,
      cspUpgradeInsecureRequests: core.cspUpgradeInsecureRequests,
      sessionCookieSecure: core.sessionCookieSecure,
      boringMcpEnabled: coreEnv.BORING_MCP_PROD_ENABLED === '1',
      managedAgentMcp: { enabled: false },
      collectionPolicy: {
        maxBindings: positiveInteger(coreEnv.BORING_D1_MAX_BINDINGS),
        maxBundleBytes: positiveInteger(coreEnv.BORING_D1_MAX_BUNDLE_BYTES),
        maxTotalBundleBytes: positiveInteger(coreEnv.BORING_D1_MAX_TOTAL_BUNDLE_BYTES),
        maxConcurrentPreloads: positiveInteger(coreEnv.BORING_D1_MAX_CONCURRENT_PRELOADS),
      },
    })
  } catch {
    return unavailable('hostSecurityConfig')
  }
}

export function isApprovedD1HostRelease(value: unknown): value is ApprovedD1HostRelease {
  return typeof value === 'object' && value !== null && approvedCapabilities.has(value)
}

export async function approveD1HostRelease(input: D1HostReleaseApprovalInput): Promise<ApprovedD1HostRelease> {
  const hostId = strictD1HostId(input.hostId, 'hostId')
  const record = await readApprovedD1HostReleaseFile(hostId)
  if (record.selectorInventoryRevision !== D1_SELECTOR_INVENTORY_REVISION) unavailable('approvedHostRelease')
  const coreImageRef = intendedCoreImageRef(input.coreImageRef, record)
  const coreEnv = await readD1CoreEnvAuthority()
  const caddyfile = await readD1CaddyfileAuthority()
  const databaseEpoch = await liveDatabaseEpoch(input.admissionLedger, hostId)
  const readable = record.databaseSchemaCompatibility.readableEpochRange
  if (databaseEpoch < readable.min || databaseEpoch > readable.max) unavailable('databaseSchemaCompatibility')
  const coreInspect = await inspectImage(input.runner, coreImageRef, 'coreImage')
  const ingressInspect = await inspectImage(input.runner, D1_CADDY_IMAGE, 'ingressImage')
  const artifacts = createD1ApprovedHostArtifactEvidence(record, coreImageRef, coreInspect, ingressInspect, caddyfile)
  const security = await securityIdentity(hostId, input.ownerUid, coreEnv, artifacts)
  if (security.digest !== record.hostSecurityConfigDigest) unavailable('hostSecurityConfig')
  const capability = Object.freeze({
    hostId,
    coreImageRef,
    databaseRef: input.admissionLedger.databaseRef,
    observedDatabaseEpoch: databaseEpoch,
    record,
    artifacts,
    security,
  })
  approvedCapabilities.add(capability)
  return capability
}

/** D1-005b passes the reserved SQL handle from its operation-fence callback immediately before host mutation. */
export async function revalidateApprovedD1HostReleaseDatabase(
  value: unknown,
  admissionLedger: D1AdmissionLedger,
  sql: postgres.ReservedSql,
): Promise<ApprovedD1HostRelease> {
  if (!isApprovedD1HostRelease(value) || admissionLedger.databaseRef !== value.databaseRef) unavailable('databaseSchemaCompatibility')
  let epoch: number
  try {
    epoch = await databaseEpoch(sql)
  } catch {
    return unavailable('databaseSchemaCompatibility')
  }
  if (epoch !== value.observedDatabaseEpoch) unavailable('databaseSchemaCompatibility')
  return value
}
