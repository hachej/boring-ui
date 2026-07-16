import { describe, expect, it, vi } from 'vitest'

vi.mock('../fileSecrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fileSecrets')>()
  return {
    ...actual,
    resolveConfigFileSecrets: vi.fn(actual.resolveConfigFileSecrets),
  }
})

import {
  loadConfig,
  readCoreSecurityConfigProjection,
} from '../index.js'
import { resolveConfigFileSecrets } from '../fileSecrets.js'
import { ConfigValidationError } from '../../../shared/errors.js'

const REQUIRED_SECRETS = Object.freeze({
  DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  WORKSPACE_SETTINGS_ENCRYPTION_KEY: 'b'.repeat(64),
})

function selectSecurityConfig(config: Awaited<ReturnType<typeof loadConfig>>) {
  return {
    host: config.host,
    port: config.port,
    betterAuthUrl: config.auth.url,
    corsOrigins: config.cors.origins,
    cspEnabled: config.security?.csp.enabled,
    cspUpgradeInsecureRequests:
      config.security?.csp.upgradeInsecureRequests,
    sessionCookieSecure: config.auth.sessionCookieSecure,
    trustedProxy: config.security?.trustedProxy,
  }
}

describe('readCoreSecurityConfigProjection', () => {
  it.each([
    ['defaults', {}],
    [
      'representative overrides',
      {
        HOST: '127.0.0.1',
        PORT: '4100',
        BETTER_AUTH_URL: 'https://app.example.test',
        CORS_ORIGINS:
          'https://app.example.test, https://admin.example.test',
        CSP_ENABLED: 'false',
        CSP_UPGRADE_INSECURE_REQUESTS: 'false',
        SESSION_COOKIE_SECURE: 'false',
        TRUST_PROXY_LEGACY_UNSAFE: '1',
      },
    ],
    [
      'AgentHost production policy',
      {
        NODE_ENV: 'production',
        BORING_AGENT_HOST_ID: 'eu-host-1',
        HOST: '0.0.0.0',
        PORT: '3000',
        BETTER_AUTH_URL: 'https://insurance.example.test',
        CORS_ORIGINS: 'https://insurance.example.test',
        CSP_ENABLED: 'true',
        CSP_UPGRADE_INSECURE_REQUESTS: 'true',
        SESSION_COOKIE_SECURE: 'true',
        TRUST_PROXY_CIDRS: '192.168.255.250/32',
        TRUST_PROXY_HOPS: '1',
      },
    ],
  ] as const)('matches loadConfig for %s', async (_name, overrides) => {
    const env = { ...REQUIRED_SECRETS, ...overrides }

    const projection = readCoreSecurityConfigProjection(env)
    const config = await loadConfig({
      env,
      tomlPath: '/projection-test-does-not-exist.toml',
    })

    expect(projection).toEqual(selectSecurityConfig(config))
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.corsOrigins)).toBe(true)
    if (
      projection.trustedProxy &&
      projection.trustedProxy !== 'legacy-unsafe'
    ) {
      expect(Object.isFrozen(projection.trustedProxy)).toBe(true)
      expect(Object.isFrozen(projection.trustedProxy.cidrs)).toBe(true)
    }
  })

  it('preserves pre-schema proxy parsing while loadConfig rejects invalid input', async () => {
    const env = {
      ...REQUIRED_SECRETS,
      TRUST_PROXY_CIDRS: 'not-a-cidr',
      TRUST_PROXY_HOPS: '9',
    }

    const projection = readCoreSecurityConfigProjection(env)

    expect(projection.trustedProxy).toMatchObject({
      cidrs: ['not-a-cidr'],
      hops: Number.NaN,
    })
    await expect(
      loadConfig({
        env,
        tomlPath: '/projection-test-does-not-exist.toml',
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError)
  })

  it('keeps proxy policy errors identical to loadConfig', async () => {
    const env = {
      ...REQUIRED_SECRETS,
      BORING_AGENT_HOST_ID: 'eu-host-1',
    }

    expect(() => readCoreSecurityConfigProjection(env)).toThrow(
      ConfigValidationError,
    )
    await expect(
      loadConfig({
        env,
        tomlPath: '/projection-test-does-not-exist.toml',
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError)
  })

  it('returns detached values that do not follow later input mutation', () => {
    const env: Record<string, string | undefined> = {
      BETTER_AUTH_URL: 'https://app.example.test',
      CORS_ORIGINS: 'https://app.example.test,https://admin.example.test',
      TRUST_PROXY_CIDRS: '192.168.255.250/32',
      TRUST_PROXY_HOPS: '1',
    }

    const projection = readCoreSecurityConfigProjection(env)
    env.BETTER_AUTH_URL = 'http://mutated.invalid'
    env.CORS_ORIGINS = 'http://mutated.invalid'
    env.TRUST_PROXY_CIDRS = '10.0.0.0/8'

    expect(projection.betterAuthUrl).toBe('https://app.example.test')
    expect(projection.corsOrigins).toEqual([
      'https://app.example.test',
      'https://admin.example.test',
    ])
    expect(projection.trustedProxy).toEqual({
      cidrs: ['192.168.255.250/32'],
      hops: 1,
    })
  })

  it('reads only the explicit nonsecret projection env allowlist', () => {
    vi.mocked(resolveConfigFileSecrets).mockClear()
    const accessed: string[] = []
    const projectionEnvKeys = [
      'BETTER_AUTH_URL',
      'BORING_AGENT_HOST_ID',
      'CORS_ORIGINS',
      'CSP_ENABLED',
      'CSP_UPGRADE_INSECURE_REQUESTS',
      'HOST',
      'PORT',
      'SESSION_COOKIE_SECURE',
      'TRUST_PROXY_CIDRS',
      'TRUST_PROXY_HOPS',
      'TRUST_PROXY_LEGACY_UNSAFE',
    ].sort()
    const envCanaries = {
      DATABASE_URL: 'inline-database-canary',
      DATABASE_URL_FILE: '/secret-file-canary/database-url',
      BETTER_AUTH_SECRET: 'inline-auth-canary',
      BETTER_AUTH_SECRET_FILE: '/secret-file-canary/auth-secret',
      WORKSPACE_SETTINGS_ENCRYPTION_KEY: 'inline-encryption-canary',
      WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE:
        '/secret-file-canary/encryption-key',
      GITHUB_CLIENT_ID: 'github-client-canary',
      GITHUB_CLIENT_SECRET: 'github-secret-canary',
      GOOGLE_CLIENT_ID: 'google-client-canary',
      GOOGLE_CLIENT_SECRET: 'google-secret-canary',
      MAIL_FROM: 'mail-from-canary@example.test',
      MAIL_TRANSPORT_URL: 'smtp://mail-transport-canary',
      BETTER_AUTH_URL: 'https://app.example.test',
    }
    const env = new Proxy(envCanaries, {
      get(target, property, receiver) {
        if (typeof property === 'string') accessed.push(property)
        return Reflect.get(target, property, receiver)
      },
    })

    expect(readCoreSecurityConfigProjection(env).betterAuthUrl).toBe(
      'https://app.example.test',
    )
    expect([...new Set(accessed)].sort()).toEqual(projectionEnvKeys)
    expect(resolveConfigFileSecrets).not.toHaveBeenCalled()
  })
})
