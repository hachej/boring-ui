import { readCoreSecurityConfigProjection } from '@hachej/boring-core/server'
import type postgres from 'postgres'

import { createAgentHostApprovedHostArtifactEvidence, type AgentHostApprovedHostArtifactEvidenceV1 } from './approvedHostArtifactEvidence.js'
import { AGENT_HOST_SELECTOR_INVENTORY_REVISION, type ApprovedAgentHostReleaseRecordV1 } from './approvedHostRelease.js'
import { readApprovedAgentHostReleaseFile } from './approvedHostReleaseFile.js'
import type { AgentHostAdmissionLedger } from './admissionLedger.js'
import { readAgentHostCaddyfileAuthority } from './agentHostCaddyfileAuthority.js'
import { readAgentHostCoreEnvAuthority, type AgentHostCoreEnvV1 } from './agentHostCoreEnvAuthority.js'
import { AGENT_HOST_CADDY_IMAGE } from './agentHostIngressArtifacts.js'
import { AgentHostError, AgentHostErrorCode, strictAgentHostId } from './agentHostPlan.js'
import { createAgentHostSecurityConfig, type AgentHostSecurityConfigV1 } from './hostSecurityConfig.js'
import type { AgentHostProcess, AgentHostRunner } from './edgeNetworkPreflight.js'

const COMPOSE_DIRECTORY = '/opt/boring/agent-host'
const MAX_INSPECT_BYTES = 512 * 1024
const PINNED_IMAGE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/
const approvedCapabilities = new WeakSet<object>()

export interface ApprovedAgentHostRelease {
  readonly hostId: string
  readonly databaseRef: string
  readonly observedDatabaseEpoch: number
  readonly record: ApprovedAgentHostReleaseRecordV1
  readonly artifacts: AgentHostApprovedHostArtifactEvidenceV1
  readonly security: AgentHostSecurityConfigV1
}

export interface AgentHostReleaseApprovalInput {
  readonly hostId: string
  readonly ownerUid: number
  readonly coreImageRef: string
  readonly runner: AgentHostRunner
  readonly admissionLedger: AgentHostAdmissionLedger
}

type ApprovalField = 'approvedHostRelease' | 'coreImage' | 'ingressImage' | 'hostSecurityConfig' | 'databaseSchemaCompatibility'

function unavailable(field: ApprovalField): never {
  throw new AgentHostError(AgentHostErrorCode.COLLECTION_NOT_READY, { field })
}

function inspectProcess(imageRef: string): AgentHostProcess {
  return Object.freeze({
    command: 'docker',
    args: Object.freeze(['image', 'inspect', imageRef]),
    cwd: COMPOSE_DIRECTORY,
    env: Object.freeze({}),
    shell: false,
    maxStdoutBytes: MAX_INSPECT_BYTES,
  })
}

function intendedCoreImageRef(value: unknown, record: ApprovedAgentHostReleaseRecordV1): string {
  if (typeof value !== 'string' || !PINNED_IMAGE.test(value) || !value.endsWith(`@${record.hostAppImageDigest}`)) unavailable('coreImage')
  return value
}

async function inspectImage(runner: AgentHostRunner, imageRef: string, field: ApprovalField): Promise<unknown> {
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

async function liveDatabaseEpoch(ledger: AgentHostAdmissionLedger, hostId: string): Promise<number> {
  try {
    return await ledger.withBindingFences([{ hostId, bindingId: 'agent-host-release-approval' }], databaseEpoch)
  } catch {
    return unavailable('databaseSchemaCompatibility')
  }
}

function rawEnvironment(hostId: string, coreEnv: AgentHostCoreEnvV1, artifacts: AgentHostApprovedHostArtifactEvidenceV1): Readonly<Record<string, string>> {
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
    BORING_AGENT_HOST_ID: hostId,
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
  coreEnv: AgentHostCoreEnvV1,
  artifacts: AgentHostApprovedHostArtifactEvidenceV1,
): Promise<AgentHostSecurityConfigV1> {
  try {
    if (!Number.isSafeInteger(ownerUid) || ownerUid < 0 || coreEnv.BORING_AGENT_HOST_OWNER_UID !== String(ownerUid)) throw new Error()
    const env = rawEnvironment(hostId, coreEnv, artifacts)
    const core = readCoreSecurityConfigProjection(env)
    return await createAgentHostSecurityConfig(env, {
      imageDefaults: artifacts.imageDefaults,
      agentHostId: hostId,
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
        maxBindings: positiveInteger(coreEnv.BORING_AGENT_HOST_MAX_BINDINGS),
        maxBundleBytes: positiveInteger(coreEnv.BORING_AGENT_HOST_MAX_BUNDLE_BYTES),
        maxTotalBundleBytes: positiveInteger(coreEnv.BORING_AGENT_HOST_MAX_TOTAL_BUNDLE_BYTES),
        maxConcurrentPreloads: positiveInteger(coreEnv.BORING_AGENT_HOST_MAX_CONCURRENT_PRELOADS),
      },
    })
  } catch {
    return unavailable('hostSecurityConfig')
  }
}

export function isApprovedAgentHostRelease(value: unknown): value is ApprovedAgentHostRelease {
  return typeof value === 'object' && value !== null && approvedCapabilities.has(value)
}

export async function approveAgentHostRelease(input: AgentHostReleaseApprovalInput): Promise<ApprovedAgentHostRelease> {
  const hostId = strictAgentHostId(input.hostId, 'hostId')
  const record = await readApprovedAgentHostReleaseFile(hostId)
  if (record.selectorInventoryRevision !== AGENT_HOST_SELECTOR_INVENTORY_REVISION) unavailable('approvedHostRelease')
  const coreImageRef = intendedCoreImageRef(input.coreImageRef, record)
  const coreEnv = await readAgentHostCoreEnvAuthority()
  const caddyfile = await readAgentHostCaddyfileAuthority()
  const databaseEpoch = await liveDatabaseEpoch(input.admissionLedger, hostId)
  const readable = record.databaseSchemaCompatibility.readableEpochRange
  if (databaseEpoch < readable.min || databaseEpoch > readable.max) unavailable('databaseSchemaCompatibility')
  const coreInspect = await inspectImage(input.runner, coreImageRef, 'coreImage')
  const ingressInspect = await inspectImage(input.runner, AGENT_HOST_CADDY_IMAGE, 'ingressImage')
  const artifacts = createAgentHostApprovedHostArtifactEvidence(record, coreImageRef, coreInspect, ingressInspect, caddyfile)
  const security = await securityIdentity(hostId, input.ownerUid, coreEnv, artifacts)
  if (security.digest !== record.hostSecurityConfigDigest) unavailable('hostSecurityConfig')
  const capability = Object.freeze({
    hostId,
    databaseRef: input.admissionLedger.databaseRef,
    observedDatabaseEpoch: databaseEpoch,
    record,
    artifacts,
    security,
  })
  approvedCapabilities.add(capability)
  return capability
}

/** AgentHost-005b passes the reserved SQL handle from its operation-fence callback immediately before host mutation. */
export async function revalidateApprovedAgentHostReleaseDatabase(
  value: unknown,
  admissionLedger: AgentHostAdmissionLedger,
  sql: postgres.ReservedSql,
): Promise<ApprovedAgentHostRelease> {
  if (!isApprovedAgentHostRelease(value) || admissionLedger.databaseRef !== value.databaseRef) unavailable('databaseSchemaCompatibility')
  let epoch: number
  try {
    epoch = await databaseEpoch(sql)
  } catch {
    return unavailable('databaseSchemaCompatibility')
  }
  if (epoch !== value.observedDatabaseEpoch) unavailable('databaseSchemaCompatibility')
  return value
}
