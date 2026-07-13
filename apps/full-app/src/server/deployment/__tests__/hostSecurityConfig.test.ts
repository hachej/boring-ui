import { describe, expect, it } from 'vitest'

import {
  D1_HOST_SECURITY_CONFIG_ERROR,
  D1_HOST_SECURITY_ENV_POLICY,
  createD1HostSecurityConfig,
} from '../hostSecurityConfig.js'

const CANARY = 'secret-canary-never-serialize'
const facts = () => ({
  imageDefaults: { path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', nodeVersion: '22.22.1', yarnVersion: '1.22.22' },
  d1HostId: 'eu-host-1', publicationOwnerUid: 0, agentMode: 'vercel-sandbox',
  workspaceRoot: '/data/workspaces', sessionRoot: '/data/pi-sessions',
  trustedProxy: { cidrs: ['192.168.255.250/32'], hops: 1 }, externalPlugins: false, pluginAuthoring: false,
  betterAuthUrl: 'https://auth.example.test', corsOrigins: ['https://z.example.test', 'https://a.example.test'],
  cspEnabled: true, cspUpgradeInsecureRequests: true, sessionCookieSecure: true, boringMcpEnabled: false,
  managedAgentMcp: { enabled: false },
  collectionPolicy: { maxBindings: 20, maxBundleBytes: 1_000_000, maxTotalBundleBytes: 10_000_000, maxConcurrentPreloads: 4 },
})
const env = () => ({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', NODE_VERSION: '22.22.1', YARN_VERSION: '1.22.22',
  NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '3000', BORING_D1_HOST_ID: 'eu-host-1', BORING_D1_OWNER_UID: '0',
  BORING_AGENT_MODE: 'vercel-sandbox', BORING_AGENT_WORKSPACE_ROOT: '/data/workspaces',
  BORING_AGENT_SESSION_ROOT: '/data/pi-sessions', TRUST_PROXY_CIDRS: '192.168.255.250/32', TRUST_PROXY_HOPS: '1',
  DATABASE_URL_FILE: '/run/boring/d1/host-secrets/database-url', BETTER_AUTH_SECRET_FILE: '/run/boring/d1/host-secrets/better-auth-secret',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE: '/run/boring/d1/host-secrets/workspace-settings-encryption-key',
  BORING_PLUGIN_AUTHORING: '0', BETTER_AUTH_URL: 'https://auth.example.test',
  CORS_ORIGINS: 'https://z.example.test, https://a.example.test,https://z.example.test', CSP_ENABLED: 'true',
  CSP_UPGRADE_INSECURE_REQUESTS: 'true', SESSION_COOKIE_SECURE: 'true', BORING_MCP_PROD_ENABLED: '0',
  BORING_MANAGED_AGENT_MCP_ENABLED: '0', BORING_D1_MAX_BINDINGS: '20', BORING_D1_MAX_BUNDLE_BYTES: '1000000',
  BORING_D1_MAX_TOTAL_BUNDLE_BYTES: '10000000', BORING_D1_MAX_CONCURRENT_PRELOADS: '4',
})
const rejects = async (rawEnv: unknown, effective: unknown) => {
  await expect(createD1HostSecurityConfig(rawEnv, effective)).rejects.toMatchObject({ code: D1_HOST_SECURITY_CONFIG_ERROR })
}
const frozen = (value: unknown): boolean => !value || typeof value !== 'object'
  || (Object.isFrozen(value) && Object.values(value).every(frozen))

describe('D1 host security config', () => {
  it('canonicalizes order and duplicates into one deeply frozen deterministic identity', async () => {
    const first = await createD1HostSecurityConfig(env(), facts())
    const second = await createD1HostSecurityConfig({ ...env(), CORS_ORIGINS: 'https://a.example.test,https://z.example.test' },
      { ...facts(), corsOrigins: ['https://a.example.test', 'https://z.example.test'] })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ schemaVersion: 1, domain: 'boring-d1-host-security-config:v1',
      corsOrigins: ['https://a.example.test', 'https://z.example.test'], managedAgentMcp: { enabled: false },
      fileSecretSelectors: { databaseUrlFile: '/run/boring/d1/host-secrets/database-url' } })
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(frozen(first)).toBe(true)
    expect(new Set(Object.values(D1_HOST_SECURITY_ENV_POLICY))).toEqual(new Set(['fixed-exact']))
  })

  it('changes the digest when an allowed behavior value changes coherently', async () => {
    const before = await createD1HostSecurityConfig(env(), facts())
    const authChanged = await createD1HostSecurityConfig({ ...env(), BETTER_AUTH_URL: 'https://login.example.test' },
      { ...facts(), betterAuthUrl: 'https://login.example.test' })
    const mcpEnabled = await createD1HostSecurityConfig({ ...env(), BORING_MCP_PROD_ENABLED: '1' },
      { ...facts(), boringMcpEnabled: true })
    expect(authChanged.digest).not.toBe(before.digest)
    expect(mcpEnabled.boringMcpEnabled).toBe(true)
    expect(mcpEnabled.digest).not.toBe(before.digest)
  })

  it.each([
    ['host', (value: ReturnType<typeof facts>) => ({ ...value, d1HostId: 'eu-host-2' })],
    ['image defaults', (value: ReturnType<typeof facts>) => ({ ...value, imageDefaults: { ...value.imageDefaults, nodeVersion: '22.23.0' } })],
    ['owner', (value: ReturnType<typeof facts>) => ({ ...value, publicationOwnerUid: 1 })],
    ['mode', (value: ReturnType<typeof facts>) => ({ ...value, agentMode: 'direct' })],
    ['workspace root', (value: ReturnType<typeof facts>) => ({ ...value, workspaceRoot: '/tmp/workspaces' })],
    ['session root', (value: ReturnType<typeof facts>) => ({ ...value, sessionRoot: '/tmp/sessions' })],
    ['proxy', (value: ReturnType<typeof facts>) => ({ ...value, trustedProxy: { cidrs: ['10.0.0.1/32'], hops: 1 } })],
    ['auth URL', (value: ReturnType<typeof facts>) => ({ ...value, betterAuthUrl: 'https://other.example.test' })],
    ['CORS', (value: ReturnType<typeof facts>) => ({ ...value, corsOrigins: ['https://other.example.test'] })],
    ['CSP', (value: ReturnType<typeof facts>) => ({ ...value, cspEnabled: false })],
    ['cookie', (value: ReturnType<typeof facts>) => ({ ...value, sessionCookieSecure: false })],
    ['MCP', (value: ReturnType<typeof facts>) => ({ ...value, boringMcpEnabled: true })],
    ['collection policy', (value: ReturnType<typeof facts>) => ({ ...value, collectionPolicy: { ...value.collectionPolicy, maxBindings: 21 } })],
  ])('rejects %s drift between intended env and effective facts', async (_label, mutate) => rejects(env(), mutate(facts())))

  it.each(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH', 'UNKNOWN_BEHAVIOR',
    'DATABASE_URL', 'BETTER_AUTH_SECRET', 'WORKSPACE_SETTINGS_ENCRYPTION_KEY', 'OPENAI_API_KEY', 'COMPOSIO_API_KEY',
    'BORING_MANAGED_AGENT_MCP_BEARER_TOKEN', 'CREDITS_SIGNING_PRIVATE_KEY', 'DATABASE_URL_FILE',
    'BETTER_AUTH_SECRET_FILE', 'WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE'])
  ('rejects forbidden, unknown, and secret-bearing key %s without serializing bytes', async (key) => {
    try { await createD1HostSecurityConfig({ ...env(), [key]: CANARY }, facts()); throw new Error('accepted') }
    catch (error) {
      expect(error).toMatchObject({ code: D1_HOST_SECURITY_CONFIG_ERROR })
      expect(JSON.stringify(error)).not.toContain(CANARY)
      expect(String(error)).not.toContain(CANARY)
    }
  })

  it('rejects accessors, hidden keys, symbols, holes, and custom array properties without invoking getters', async () => {
    let reads = 0
    const changing = facts()
    Object.defineProperty(changing, 'boringMcpEnabled', { enumerable: true, get: () => { reads += 1; return reads === 1 } })
    await rejects(env(), changing)
    expect(reads).toBe(0)
    const nested = facts()
    Object.defineProperty(nested.collectionPolicy, 'maxBindings', { enumerable: true, get: () => 20 })
    await rejects(env(), nested)
    for (const key of ['UNKNOWN_BEHAVIOR', 'NODE_OPTIONS', 'DATABASE_URL']) {
      const raw = env(); Object.defineProperty(raw, key, { value: CANARY, enumerable: false })
      await rejects(raw, facts())
    }
    const symbolRaw = env() as Record<PropertyKey, unknown>; symbolRaw[Symbol('secret')] = CANARY
    await rejects(symbolRaw, facts())
    const accessorCors = facts()
    Object.defineProperty(accessorCors.corsOrigins, '0', { enumerable: true, get: () => 'https://a.example.test' })
    await rejects(env(), accessorCors)
    const customProxy = facts()
    Object.defineProperty(customProxy.trustedProxy.cidrs, 'toJSON', { enumerable: true, value: () => ['192.168.255.250/32'] })
    await rejects(env(), customProxy)
    await rejects(env(), { ...facts(), corsOrigins: new Array(1) })
  })

  it('fails closed on conditional managed target, malformed shapes, extras, and bounds', async () => {
    await rejects(env(), { ...facts(), managedAgentMcp: { enabled: true, workspaceId: 'w1', userId: 'u1' } })
    await rejects({ ...env(), HOST: '127.0.0.1' }, facts())
    await rejects({ ...env(), BORING_MANAGED_AGENT_MCP_WORKSPACE_ID: 'w1' }, facts())
    await rejects(env(), { ...facts(), extra: true })
    await rejects(env(), { ...facts(), boringMcpEnabled: 0 })
    await rejects(env(), { ...facts(), trustedProxy: null })
    await rejects(env(), { ...facts(), trustedProxy: { cidrs: { toJSON: () => ['192.168.255.250/32'] }, hops: 1 } })
    await rejects({ ...env(), CORS_ORIGINS: 'https://a.example.test/path' }, { ...facts(), corsOrigins: ['https://a.example.test/path'] })
    await rejects({ ...env(), CORS_ORIGINS: 'http://a.example.test' }, { ...facts(), corsOrigins: ['http://a.example.test'] })
    await rejects({ ...env(), BORING_D1_MAX_BINDINGS: '0' }, { ...facts(), collectionPolicy: { ...facts().collectionPolicy, maxBindings: 0 } })
    await rejects(env(), { ...facts(), collectionPolicy: { ...facts().collectionPolicy, maxConcurrentPreloads: 21 } })
  })
})
