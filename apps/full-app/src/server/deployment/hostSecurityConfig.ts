import { createAgentAssetDigest, type Sha256Digest } from '@hachej/boring-agent/shared'

export const D1_HOST_SECURITY_CONFIG_ERROR = 'D1_HOST_SECURITY_CONFIG_INVALID'
const DOMAIN = 'boring-d1-host-security-config:v1' as const
const FILE_SECRET_ENV = Object.freeze({
  DATABASE_URL_FILE: '/run/boring/d1/host-secrets/database-url',
  BETTER_AUTH_SECRET_FILE: '/run/boring/d1/host-secrets/better-auth-secret',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE: '/run/boring/d1/host-secrets/workspace-settings-encryption-key',
})
const FIXED_ENV = Object.freeze({
  NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '3000', BORING_AGENT_MODE: 'vercel-sandbox',
  BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces', BORING_AGENT_SESSION_ROOT: '/data/pi-sessions',
  TRUST_PROXY_CIDRS: '192.168.255.250/32', TRUST_PROXY_HOPS: '1',
  BORING_PLUGIN_AUTHORING: '0', CSP_ENABLED: 'true',
  CSP_UPGRADE_INSECURE_REQUESTS: 'true', SESSION_COOKIE_SECURE: 'true',
  BORING_MANAGED_AGENT_MCP_ENABLED: '0',
  ...FILE_SECRET_ENV,
})
const VARIABLE_ENV = ['PATH', 'NODE_VERSION', 'YARN_VERSION', 'BORING_D1_HOST_ID', 'BORING_D1_OWNER_UID', 'BETTER_AUTH_URL', 'CORS_ORIGINS',
  'BORING_MCP_PROD_ENABLED', 'BORING_D1_MAX_BINDINGS', 'BORING_D1_MAX_BUNDLE_BYTES',
  'BORING_D1_MAX_TOTAL_BUNDLE_BYTES', 'BORING_D1_MAX_CONCURRENT_PRELOADS'] as const
export const D1_HOST_SECURITY_ENV_POLICY = Object.freeze(Object.fromEntries(
  [...Object.keys(FIXED_ENV), ...VARIABLE_ENV].map((key) => [key, 'fixed-exact' as const]),
))
const FORBIDDEN_LOADER_KEYS = new Set(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH'])
const FILE_SECRET_KEYS = new Set(Object.keys(FILE_SECRET_ENV))
const SECRET_KEY = /(?:SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|API[_-]?KEY|BEARER|DATABASE|DB_|MODEL_|COMPOSIO|CREDITS)/i
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,249}$/

export class D1HostSecurityConfigError extends Error {
  readonly code = D1_HOST_SECURITY_CONFIG_ERROR
  constructor() { super(D1_HOST_SECURITY_CONFIG_ERROR); this.name = 'D1HostSecurityConfigError' }
}

export interface D1HostSecurityConfigV1 {
  readonly schemaVersion: 1
  readonly domain: typeof DOMAIN
  readonly nodeEnv: 'production'
  readonly host: '0.0.0.0'
  readonly port: 3000
  readonly imageDefaults: Readonly<{ path: string; nodeVersion: string; yarnVersion: string }>
  readonly fileSecretSelectors: Readonly<{ databaseUrlFile: string; betterAuthSecretFile: string; workspaceSettingsEncryptionKeyFile: string }>
  readonly d1HostId: string
  readonly publicationOwnerUid: number
  readonly agentMode: 'vercel-sandbox'
  readonly workspaceRoot: '/data/workspaces'
  readonly sessionRoot: '/data/pi-sessions'
  readonly trustedProxy: Readonly<{ cidrs: readonly ['192.168.255.250/32']; hops: 1 }>
  readonly externalPlugins: false
  readonly pluginAuthoring: false
  readonly betterAuthUrl: string
  readonly corsOrigins: readonly string[]
  readonly cspEnabled: true
  readonly cspUpgradeInsecureRequests: true
  readonly sessionCookieSecure: true
  readonly boringMcpEnabled: boolean
  readonly managedAgentMcp: Readonly<{ enabled: false }>
  readonly collectionPolicy: Readonly<{ maxBindings: number; maxBundleBytes: number; maxTotalBundleBytes: number; maxConcurrentPreloads: number }>
  readonly digest: Sha256Digest
}

const FACT_KEYS = ['imageDefaults', 'd1HostId', 'publicationOwnerUid', 'agentMode', 'workspaceRoot', 'sessionRoot', 'trustedProxy',
  'externalPlugins', 'pluginAuthoring', 'betterAuthUrl', 'corsOrigins', 'cspEnabled', 'cspUpgradeInsecureRequests',
  'sessionCookieSecure', 'boringMcpEnabled', 'managedAgentMcp', 'collectionPolicy'] as const

function dataRecord(value: unknown, expected: readonly string[]): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error()
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expected.length
    || expected.some((key) => !keys.includes(key))) throw new Error()
  const snapshot: Record<string, unknown> = {}
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    snapshot[key] = descriptor.value
  }
  return Object.freeze(snapshot)
}
function dataArray(value: unknown, maxLength = 1_000): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error()
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > maxLength) throw new Error()
  const expected = Array.from({ length: length.value }, (_, index) => String(index))
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expected.length + 1
    || !keys.includes('length') || expected.some((key) => !keys.includes(key))) throw new Error()
  return Object.freeze(expected.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error()
    return descriptor.value
  }))
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\0-\x1f\x7f]/.test(value)) throw new Error()
  return value
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error()
  return value
}
function origin(value: unknown): string {
  const raw = string(value); const parsed = new URL(raw)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin === 'null' || raw !== parsed.origin) throw new Error()
  return raw
}
function origins(value: unknown): readonly string[] {
  const values = dataArray(value)
  if (values.length === 0) throw new Error()
  return Object.freeze([...new Set(values.map(origin))].sort())
}
async function parse(rawEnv: unknown, effective: unknown): Promise<D1HostSecurityConfigV1> {
  const env = dataRecord(rawEnv, [...Object.keys(FIXED_ENV), ...VARIABLE_ENV])
  for (const key of Object.keys(env)) if (FORBIDDEN_LOADER_KEYS.has(key) || (SECRET_KEY.test(key) && !FILE_SECRET_KEYS.has(key))) throw new Error()
  for (const [key, value] of Object.entries(FIXED_ENV)) if (env[key] !== value) throw new Error()
  const facts = dataRecord(effective, FACT_KEYS)
  const imageInput = dataRecord(facts.imageDefaults, ['path', 'nodeVersion', 'yarnVersion'])
  const proxyInput = dataRecord(facts.trustedProxy, ['cidrs', 'hops'])
  const managedInput = dataRecord(facts.managedAgentMcp, ['enabled'])
  const policyInput = dataRecord(facts.collectionPolicy, ['maxBindings', 'maxBundleBytes', 'maxTotalBundleBytes', 'maxConcurrentPreloads'])
  const proxyCidrs = dataArray(proxyInput.cidrs, 1)
  const hostId = string(facts.d1HostId)
  if (!HOST_ID.test(hostId) || hostId !== env.BORING_D1_HOST_ID) throw new Error()
  const owner = facts.publicationOwnerUid
  if (typeof owner !== 'number' || !Number.isSafeInteger(owner) || owner < 0 || owner > 0xffff_fffe || owner === 10001
    || String(owner) !== env.BORING_D1_OWNER_UID) throw new Error()
  const url = origin(facts.betterAuthUrl); const cors = origins(facts.corsOrigins)
  const policy = Object.freeze({
    maxBindings: integer(policyInput.maxBindings, 1_000),
    maxBundleBytes: integer(policyInput.maxBundleBytes, 64 * 1024 * 1024),
    maxTotalBundleBytes: integer(policyInput.maxTotalBundleBytes, 1024 * 1024 * 1024),
    maxConcurrentPreloads: integer(policyInput.maxConcurrentPreloads, 64),
  })
  if (policy.maxConcurrentPreloads > policy.maxBindings || policy.maxBundleBytes > policy.maxTotalBundleBytes) throw new Error()
  if (typeof facts.boringMcpEnabled !== 'boolean') throw new Error()
  const imageDefaults = Object.freeze({ path: string(imageInput.path), nodeVersion: string(imageInput.nodeVersion), yarnVersion: string(imageInput.yarnVersion) })
  const expectedVariables = {
    PATH: imageDefaults.path, NODE_VERSION: imageDefaults.nodeVersion, YARN_VERSION: imageDefaults.yarnVersion,
    BORING_D1_HOST_ID: hostId, BORING_D1_OWNER_UID: String(owner), BETTER_AUTH_URL: url,
    CORS_ORIGINS: cors.join(','), BORING_MCP_PROD_ENABLED: facts.boringMcpEnabled === true ? '1' : '0',
    BORING_D1_MAX_BINDINGS: String(policy.maxBindings), BORING_D1_MAX_BUNDLE_BYTES: String(policy.maxBundleBytes),
    BORING_D1_MAX_TOTAL_BUNDLE_BYTES: String(policy.maxTotalBundleBytes),
    BORING_D1_MAX_CONCURRENT_PRELOADS: String(policy.maxConcurrentPreloads),
  }
  if (Object.entries(expectedVariables).some(([key, value]) => key === 'CORS_ORIGINS'
    ? string(env[key]).split(',').map((item) => item.trim()).filter(Boolean).map(origin).filter((item, index, all) => all.indexOf(item) === index).sort().join(',') !== value
    : env[key] !== value)) throw new Error()
  if (facts.agentMode !== 'vercel-sandbox' || facts.workspaceRoot !== '/data/workspaces'
    || facts.sessionRoot !== '/data/pi-sessions' || facts.externalPlugins !== false || facts.pluginAuthoring !== false
    || facts.cspEnabled !== true || facts.cspUpgradeInsecureRequests !== true || facts.sessionCookieSecure !== true
    || managedInput.enabled !== false || proxyInput.hops !== 1 || proxyCidrs.length !== 1 || proxyCidrs[0] !== '192.168.255.250/32') throw new Error()
  const fileSecretSelectors = Object.freeze({ databaseUrlFile: FILE_SECRET_ENV.DATABASE_URL_FILE,
    betterAuthSecretFile: FILE_SECRET_ENV.BETTER_AUTH_SECRET_FILE,
    workspaceSettingsEncryptionKeyFile: FILE_SECRET_ENV.WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE })
  const projection = Object.freeze({ schemaVersion: 1 as const, domain: DOMAIN, nodeEnv: 'production' as const,
    host: '0.0.0.0' as const, port: 3000 as const, imageDefaults, fileSecretSelectors,
    d1HostId: hostId, publicationOwnerUid: owner, agentMode: 'vercel-sandbox' as const,
    workspaceRoot: '/data/workspaces' as const, sessionRoot: '/data/pi-sessions' as const,
    trustedProxy: Object.freeze({ cidrs: Object.freeze(['192.168.255.250/32'] as const), hops: 1 as const }),
    externalPlugins: false as const, pluginAuthoring: false as const, betterAuthUrl: url, corsOrigins: cors,
    cspEnabled: true as const, cspUpgradeInsecureRequests: true as const, sessionCookieSecure: true as const,
    boringMcpEnabled: facts.boringMcpEnabled, managedAgentMcp: Object.freeze({ enabled: false as const }), collectionPolicy: policy })
  return Object.freeze({ ...projection, digest: await createAgentAssetDigest(JSON.stringify(projection)) })
}

export async function createD1HostSecurityConfig(rawEnv: unknown, effective: unknown): Promise<D1HostSecurityConfigV1> {
  try { return await parse(rawEnv, effective) } catch { throw new D1HostSecurityConfigError() }
}
