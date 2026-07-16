import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAgentHostSecurityConfig } from '../hostSecurityConfig.js'
import { AGENT_HOST_SELECTOR_INVENTORY_REVISION } from '../approvedHostRelease.js'
import { AGENT_HOST_CADDY_AMD64_ID, AGENT_HOST_CADDY_COMMAND, AGENT_HOST_CADDY_IMAGE, AGENT_HOST_CADDY_IMAGE_DEFAULTS, AGENT_HOST_CADDYFILE_DIGEST } from '../agentHostIngressArtifacts.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  coreEnv: vi.fn(),
  caddyfile: vi.fn(),
}))
vi.mock('../approvedHostReleaseFile.js', () => ({
  readApprovedAgentHostReleaseFile: mocks.release,
}))
vi.mock('../agentHostCoreEnvAuthority.js', () => ({
  readAgentHostCoreEnvAuthority: mocks.coreEnv,
}))
vi.mock('../agentHostCaddyfileAuthority.js', () => ({
  readAgentHostCaddyfileAuthority: mocks.caddyfile,
}))

import { approveAgentHostRelease, isApprovedAgentHostRelease, revalidateApprovedAgentHostReleaseDatabase } from '../approvedHostReleaseCapability.js'

const CANARY = 'approval-canary-never-leaks'
const digest = (character: string) => `sha256:${character.repeat(64)}`
const revision = (character: string) => character.repeat(40)
const CORE_DIGEST = digest('a')
const CORE_REF = `ghcr.io/hachej/boring-ui@${CORE_DIGEST}`
const CORE_ID = digest('f')
const HOST = 'eu-host-1'
const OWNER = 1000
const CADDY_BYTES = new TextEncoder().encode(
  ':8080 {\n\treverse_proxy core-app:3000 {\n\t\theader_up -Forwarded\n\t\theader_up Host {hostport}\n\t\theader_up X-Forwarded-Host {hostport}\n\t}\n}\n',
)

const coreEnv = () => ({
  BORING_AGENT_HOST_OWNER_UID: String(OWNER),
  DATABASE_URL_FILE: '/run/boring/agent-host/host-secrets/database-url',
  BETTER_AUTH_SECRET_FILE: '/run/boring/agent-host/host-secrets/better-auth-secret',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE: '/run/boring/agent-host/host-secrets/workspace-settings-encryption-key',
  BORING_PLUGIN_AUTHORING: '0',
  BETTER_AUTH_URL: 'https://auth.example.test',
  CORS_ORIGINS: 'https://app.example.test',
  CSP_ENABLED: 'true',
  CSP_UPGRADE_INSECURE_REQUESTS: 'true',
  SESSION_COOKIE_SECURE: 'true',
  BORING_MCP_PROD_ENABLED: '0',
  BORING_MANAGED_AGENT_MCP_ENABLED: '0',
  BORING_AGENT_HOST_MAX_BINDINGS: '20',
  BORING_AGENT_HOST_MAX_BUNDLE_BYTES: '1000000',
  BORING_AGENT_HOST_MAX_TOTAL_BUNDLE_BYTES: '10000000',
  BORING_AGENT_HOST_MAX_CONCURRENT_PRELOADS: '4',
})
const imageDefaults = {
  path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  nodeVersion: '22.23.1',
  yarnVersion: '1.22.22',
}
const rawEnv = () => ({
  PATH: imageDefaults.path,
  NODE_VERSION: imageDefaults.nodeVersion,
  YARN_VERSION: imageDefaults.yarnVersion,
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  PORT: '3000',
  BORING_AGENT_MODE: 'vercel-sandbox',
  BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces',
  BORING_AGENT_SESSION_ROOT: '/data/pi-sessions',
  TRUST_PROXY_CIDRS: '192.168.255.250/32',
  TRUST_PROXY_HOPS: '1',
  BORING_AGENT_HOST_ID: HOST,
  ...coreEnv(),
})
const effective = () => ({
  imageDefaults,
  agentHostId: HOST,
  publicationOwnerUid: OWNER,
  agentMode: 'vercel-sandbox',
  workspaceRoot: '/data/workspaces',
  sessionRoot: '/data/pi-sessions',
  trustedProxy: { cidrs: ['192.168.255.250/32'], hops: 1 },
  externalPlugins: false,
  pluginAuthoring: false,
  betterAuthUrl: 'https://auth.example.test',
  corsOrigins: ['https://app.example.test'],
  cspEnabled: true,
  cspUpgradeInsecureRequests: true,
  sessionCookieSecure: true,
  boringMcpEnabled: false,
  managedAgentMcp: { enabled: false },
  collectionPolicy: {
    maxBindings: 20,
    maxBundleBytes: 1000000,
    maxTotalBundleBytes: 10000000,
    maxConcurrentPreloads: 4,
  },
})

const coreImage = () => [
  {
    Id: CORE_ID,
    RepoDigests: [CORE_REF],
    Architecture: 'amd64',
    Os: 'linux',
    Config: {
      Entrypoint: ['/usr/local/bin/web-entrypoint'],
      Cmd: ['node', 'apps/full-app/dist/server/main.js'],
      WorkingDir: '/app',
      Env: [
        `PATH=${imageDefaults.path}`,
        `NODE_VERSION=${imageDefaults.nodeVersion}`,
        `YARN_VERSION=${imageDefaults.yarnVersion}`,
        'NODE_ENV=production',
        'BORING_AGENT_MODE=vercel-sandbox',
        'BORING_AGENT_WORKSPACE_ROOT=/data/workspaces',
        'BORING_AGENT_SESSION_ROOT=/data/pi-sessions',
      ],
      Labels: {
        'boring.role': 'web',
        'org.opencontainers.image.revision': revision('b'),
        'ai.senecapp.agent-host.migration-set-digest': digest('e'),
        'ai.senecapp.agent-host.database-current-epoch': '2',
      },
    },
  },
]
const ingressImage = () => [
  {
    Id: AGENT_HOST_CADDY_AMD64_ID,
    RepoDigests: [AGENT_HOST_CADDY_IMAGE],
    Architecture: 'amd64',
    Os: 'linux',
    Config: {
      Cmd: [...AGENT_HOST_CADDY_COMMAND],
      WorkingDir: '/srv',
      Env: Object.entries(AGENT_HOST_CADDY_IMAGE_DEFAULTS).map(([key, value]) => `${key}=${value}`),
    },
  },
]
const ledger = (epoch = 1, events?: string[]) =>
  ({
    databaseRef: 'postgres-eu',
    withBindingFences: async (keys: unknown, operation: (sql: unknown) => Promise<unknown>) => {
      events?.push('database')
      expect(keys).toEqual([{ hostId: HOST, bindingId: 'agent-host-host-release-approval' }])
      return operation((() => Promise.resolve([{ epoch }])) as unknown)
    },
  }) as never
const reservedSql = (epoch: number) => vi.fn(() => Promise.resolve([{ epoch }])) as never
let record: Record<string, unknown>

describe('AgentHost approved host release capability', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const security = await createAgentHostSecurityConfig(rawEnv(), effective())
    record = Object.freeze({
      schemaVersion: 1,
      domain: 'boring-agent-host-approved-host-release:v1',
      hostAppImageDigest: CORE_DIGEST,
      coreCommand: {
        entrypoint: ['/usr/local/bin/web-entrypoint'],
        cmd: ['node', 'apps/full-app/dist/server/main.js'],
      },
      migrationProcess: {
        entrypoint: ['node'],
        cmd: ['apps/full-app/dist/server/migrate.js'],
        user: '10001:10001',
        readonlyRootfs: true,
        privileged: false,
        noNewPrivileges: true,
        addedCapabilities: [],
      },
      ingressImageDigest: AGENT_HOST_CADDY_IMAGE.split('@')[1],
      ingressCommand: { entrypoint: null, cmd: [...AGENT_HOST_CADDY_COMMAND] },
      caddyfileDigest: AGENT_HOST_CADDYFILE_DIGEST,
      hostSecurityConfigDigest: security.digest,
      selectorInventoryRevision: AGENT_HOST_SELECTOR_INVENTORY_REVISION,
      executionPolicyRevision: revision('b'),
      databaseSchemaCompatibility: {
        migrationSetDigest: digest('e'),
        currentEpoch: 2,
        readableEpochRange: { min: 1, max: 2 },
        readableByPreviousRelease: true,
      },
    })
    mocks.release.mockResolvedValue(record)
    mocks.coreEnv.mockResolvedValue(Object.freeze(coreEnv()))
    mocks.caddyfile.mockResolvedValue(CADDY_BYTES.slice())
  })

  it('checks fixed authorities before bounded image inspection and mints an unforgeable frozen capability', async () => {
    const events: string[] = []
    mocks.release.mockImplementation(async () => {
      events.push('release')
      return record
    })
    mocks.coreEnv.mockImplementation(async () => {
      events.push('coreEnv')
      return Object.freeze(coreEnv())
    })
    mocks.caddyfile.mockImplementation(async () => {
      events.push('caddyfile')
      return CADDY_BYTES.slice()
    })
    const runner = vi.fn(async (process: { args: readonly string[]; maxStdoutBytes?: number }) => {
      events.push(process.args.at(-1) === CORE_REF ? 'coreInspect' : 'ingressInspect')
      expect(process.args.slice(0, 2)).toEqual(['image', 'inspect'])
      expect(process.maxStdoutBytes).toBe(512 * 1024)
      return {
        exitCode: 0,
        stdout: JSON.stringify(process.args.at(-1) === CORE_REF ? coreImage() : ingressImage()),
      }
    })
    const capability = await approveAgentHostRelease({
      hostId: HOST,
      ownerUid: OWNER,
      coreImageRef: CORE_REF,
      runner,
      admissionLedger: ledger(1, events),
    })
    expect(events).toEqual(['release', 'coreEnv', 'caddyfile', 'database', 'coreInspect', 'ingressInspect'])
    expect(capability.record.selectorInventoryRevision).not.toBe(capability.record.executionPolicyRevision)
    expect(runner.mock.calls.flatMap(([process]) => process.args)).not.toEqual(expect.arrayContaining(['compose', 'create', 'start', 'run']))
    expect(isApprovedAgentHostRelease(capability)).toBe(true)
    expect(capability).toMatchObject({ databaseRef: 'postgres-eu', observedDatabaseEpoch: 1 })
    expect(isApprovedAgentHostRelease(JSON.parse(JSON.stringify(capability)))).toBe(false)
    expect(Object.isFrozen(capability)).toBe(true)
    await expect(revalidateApprovedAgentHostReleaseDatabase(capability, ledger(), reservedSql(1))).resolves.toBe(capability)
    await expect(revalidateApprovedAgentHostReleaseDatabase(capability, ledger(), reservedSql(2))).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'databaseSchemaCompatibility' },
    })
    const forgedSql = reservedSql(1)
    await expect(revalidateApprovedAgentHostReleaseDatabase(JSON.parse(JSON.stringify(capability)), ledger(), forgedSql)).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
    })
    expect(forgedSql).not.toHaveBeenCalled()
  })

  it('fails closed on approved digest drift and runner output without leaking hostile values', async () => {
    mocks.release.mockResolvedValue({
      ...record,
      hostSecurityConfigDigest: digest('0'),
    })
    const runner = vi.fn(async (process: { args: readonly string[] }) => ({
      exitCode: 0,
      stdout: JSON.stringify(process.args.at(-1) === CORE_REF ? coreImage() : ingressImage()),
    }))
    await expect(
      approveAgentHostRelease({
        hostId: HOST,
        ownerUid: OWNER,
        coreImageRef: CORE_REF,
        runner,
        admissionLedger: ledger(),
      }),
    ).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'hostSecurityConfig' },
    })
    const failure = await approveAgentHostRelease({
      hostId: HOST,
      ownerUid: OWNER,
      coreImageRef: CORE_REF,
      runner: async () => ({ exitCode: 1, stdout: CANARY }),
      admissionLedger: ledger(),
    }).catch((error) => error)
    expect(JSON.stringify(failure)).not.toContain(CANARY)
    expect(String(failure)).not.toContain(CANARY)
  })

  it('rejects an unauthenticated selector revision and a live database epoch outside the approved range', async () => {
    const validRunner = async (process: { args: readonly string[] }) => ({
      exitCode: 0,
      stdout: JSON.stringify(process.args.at(-1) === CORE_REF ? coreImage() : ingressImage()),
    })
    mocks.release.mockResolvedValue({ ...record, selectorInventoryRevision: revision('a') })
    const runner = vi.fn(validRunner)
    const databaseEvents: string[] = []
    const database = ledger(1, databaseEvents)
    await expect(approveAgentHostRelease({ hostId: HOST, ownerUid: OWNER, coreImageRef: CORE_REF, runner, admissionLedger: database })).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'approvedHostRelease' },
    })
    expect(databaseEvents).toEqual([])
    expect(runner).not.toHaveBeenCalled()
    mocks.release.mockResolvedValue(record)
    await expect(
      approveAgentHostRelease({ hostId: HOST, ownerUid: OWNER, coreImageRef: CORE_REF, runner: validRunner, admissionLedger: ledger(0) }),
    ).rejects.toMatchObject({
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      details: { field: 'databaseSchemaCompatibility' },
    })
  })

  it('rejects a Docker option or unapproved digest before invoking the runner', async () => {
    const runner = vi.fn()
    for (const coreImageRef of ['--format={{json .Config}}', `ghcr.io/hachej/boring-ui@${digest('0')}`]) {
      await expect(approveAgentHostRelease({ hostId: HOST, ownerUid: OWNER, coreImageRef, runner, admissionLedger: ledger() })).rejects.toMatchObject({
        code: AgentHostErrorCode.COLLECTION_NOT_READY,
        details: { field: 'coreImage' },
      })
    }
    expect(runner).not.toHaveBeenCalled()
  })
})
