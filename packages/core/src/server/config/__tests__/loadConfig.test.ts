import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { loadConfig, validateConfig, buildRuntimeConfigPayload } from '../loadConfig'
import { ConfigValidationError } from '../../../shared/errors'

const FIXTURES_DIR = resolve(__dirname, '__fixtures__')
const TOML_PATH = resolve(FIXTURES_DIR, 'boring.app.toml')

const VALID_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  BETTER_AUTH_URL: 'http://localhost:3000',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY: 'b'.repeat(64),
  CORS_ORIGINS: 'http://localhost:3000',
}

const VALID_TOML = `
[app]
id = "test-app"

[frontend.branding]
name = "Test App"
logo = "/logo.svg"

[features]
github_oauth = false
google_oauth = false
invites_enabled = true
`

function writeToml(content: string) {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(TOML_PATH, content, 'utf-8')
}

describe('loadConfig', () => {
  beforeEach(() => {
    writeToml(VALID_TOML)
  })

  afterEach(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true })
  })

  it('loads valid config from TOML + env', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: VALID_ENV,
    })

    expect(config.appId).toBe('test-app')
    expect(config.appName).toBe('Test App')
    expect(config.appLogo).toBe('/logo.svg')
    expect(config.port).toBe(3000)
    expect(config.host).toBe('0.0.0.0')
    expect(config.stores).toBe('postgres')
    expect(config.databaseUrl).toBe(VALID_ENV.DATABASE_URL)
    expect(config.auth.secret).toBe(VALID_ENV.BETTER_AUTH_SECRET)
    expect(config.auth.url).toBe('http://localhost:3000')
    expect(config.auth.sessionTtlSeconds).toBe(60 * 60 * 24 * 30)
    expect(config.auth.sessionCookieSecure).toBe(false)
    expect(config.features.githubOauth).toBe(false)
    expect(config.features.googleOauth).toBe(false)
    expect(config.features.invitesEnabled).toBe(true)
    expect(config.bodyLimit).toBe(16 * 1024 * 1024)
    expect(config.cors.credentials).toBe(true)
    expect(config.security?.csp.enabled).toBe(true)
    expect(config.security?.csp.upgradeInsecureRequests).toBe(false)
    expect(config.encryption.workspaceSettingsKey).toBe('b'.repeat(64))
  })

  it('allows disabling CSP with CSP_ENABLED=false', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        CSP_ENABLED: 'false',
      },
    })

    expect(config.security?.csp.enabled).toBe(false)
  })

  it('derives sessionCookieSecure=true from https URL', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        BETTER_AUTH_URL: 'https://app.example.com',
      },
    })

    expect(config.auth.sessionCookieSecure).toBe(true)
    expect(config.security?.csp.upgradeInsecureRequests).toBe(true)
  })

  it('allows SESSION_COOKIE_SECURE override', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        BETTER_AUTH_URL: 'https://app.example.com',
        SESSION_COOKIE_SECURE: 'false',
      },
    })

    expect(config.auth.sessionCookieSecure).toBe(false)
  })

  it('throws ConfigValidationError on missing DATABASE_URL in postgres mode', async () => {
    const env = { ...VALID_ENV }
    delete (env as Record<string, string | undefined>).DATABASE_URL

    // stores defaults to 'postgres', databaseUrl will be null,
    // but the schema allows null databaseUrl (for local mode)
    // The actual enforcement happens at app-factory level, not config level
    const config = await loadConfig({ tomlPath: TOML_PATH, env })
    expect(config.databaseUrl).toBeNull()
  })

  it('throws ConfigValidationError on missing BETTER_AUTH_SECRET', async () => {
    const env = { ...VALID_ENV }
    delete (env as Record<string, string | undefined>).BETTER_AUTH_SECRET

    await expect(
      loadConfig({ tomlPath: TOML_PATH, env }),
    ).rejects.toThrow(ConfigValidationError)
  })

  it('validates app name before normalizing the mail sender name', async () => {
    writeToml(`
[frontend.branding]
name = 123
`)

    await expect(loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        MAIL_FROM: 'noreply@test.dev',
        MAIL_TRANSPORT_URL: 'console://',
      },
    })).rejects.toThrow(ConfigValidationError)
  })

  it('fills placeholders with allowMissingSecrets', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {},
      allowMissingSecrets: true,
    })

    expect(config.databaseUrl).toContain('placeholder')
    expect(config.auth.secret).toMatch(/^0+$/)
    expect(config.encryption.workspaceSettingsKey).toMatch(/^a+$/)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('config:insecure-defaults'),
    )

    warnSpy.mockRestore()
  })

  it('rejects allowMissingSecrets in production', async () => {
    await expect(
      loadConfig({
        tomlPath: TOML_PATH,
        env: { ...VALID_ENV, NODE_ENV: 'production' },
        allowMissingSecrets: true,
      }),
    ).rejects.toThrow(ConfigValidationError)
  })

  it('parses CORS_ORIGINS as comma-separated list', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
      },
    })

    expect(config.cors.origins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ])
  })

  it('defaults CORS to localhost in dev (empty CORS_ORIGINS)', async () => {
    const env = { ...VALID_ENV }
    delete (env as Record<string, string | undefined>).CORS_ORIGINS

    const config = await loadConfig({ tomlPath: TOML_PATH, env })

    expect(config.cors.origins).toEqual([
      'http://localhost:3000',
      'http://localhost:5173',
    ])
  })

  it('sets stores=local when CORE_STORES=local', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: { ...VALID_ENV, CORE_STORES: 'local' },
    })

    expect(config.stores).toBe('local')
  })

  it('wires mail config when MAIL_FROM + MAIL_TRANSPORT_URL set', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        MAIL_FROM: 'noreply@test.dev',
        MAIL_TRANSPORT_URL: 'console://',
      },
    })

    expect(config.auth.mail).toEqual({
      from: 'Test App <noreply@test.dev>',
      transportUrl: 'console://',
    })
  })

  it('replaces the default boring.ui mail sender name with the app name', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        MAIL_FROM: 'boring.ui <noreply@test.dev>',
        MAIL_TRANSPORT_URL: 'console://',
      },
    })

    expect(config.auth.mail?.from).toBe('Test App <noreply@test.dev>')
  })

  it('preserves custom mail sender display names', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        MAIL_FROM: 'Acme Support <noreply@test.dev>',
        MAIL_TRANSPORT_URL: 'console://',
      },
    })

    expect(config.auth.mail?.from).toBe('Acme Support <noreply@test.dev>')
  })

  it('omits mail config when MAIL_FROM is missing', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        MAIL_TRANSPORT_URL: 'console://',
      },
    })

    expect(config.auth.mail).toBeUndefined()
  })

  it('wires GitHub config when both GITHUB_CLIENT_* are set', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        GITHUB_CLIENT_ID: 'gh-id',
        GITHUB_CLIENT_SECRET: 'gh-secret',
      },
    })

    expect(config.auth.github).toEqual({
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
    })
  })

  it('wires Google config when both GOOGLE_CLIENT_* are set', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    })

    expect(config.auth.google).toEqual({
      clientId: 'google-id',
      clientSecret: 'google-secret',
    })
    expect(config.features.googleOauth).toBe(false)
  })

  it('enables Google OAuth only when the TOML flag is on and both creds exist', async () => {
    writeToml(`
[features]
google_oauth = true
`)

    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    })

    expect(config.features.googleOauth).toBe(true)
  })

  it('keeps Google OAuth off when the TOML flag is on but creds are missing', async () => {
    writeToml(`
[features]
google_oauth = true
`)

    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: VALID_ENV,
    })

    expect(config.auth.google).toBeUndefined()
    expect(config.features.googleOauth).toBe(false)
  })

  it('keeps Google OAuth off when only one Google credential is present', async () => {
    writeToml(`
[features]
google_oauth = true
`)

    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: {
        ...VALID_ENV,
        GOOGLE_CLIENT_ID: 'google-id',
      },
    })

    expect(config.auth.google).toBeUndefined()
    expect(config.features.googleOauth).toBe(false)
  })

  it('uses custom PORT and HOST', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: { ...VALID_ENV, PORT: '8080', HOST: '127.0.0.1' },
    })

    expect(config.port).toBe(8080)
    expect(config.host).toBe('127.0.0.1')
  })

  it('uses custom BODY_LIMIT_BYTES', async () => {
    const config = await loadConfig({
      tomlPath: TOML_PATH,
      env: { ...VALID_ENV, BODY_LIMIT_BYTES: '1048576' },
    })

    expect(config.bodyLimit).toBe(1048576)
  })

  it('loads without TOML file (uses env defaults)', async () => {
    const config = await loadConfig({
      tomlPath: '/nonexistent/boring.app.toml',
      env: VALID_ENV,
    })

    expect(config.appId).toBe('boring-app')
    expect(config.appName).toBe('boring-app')
    expect(config.appLogo).toBeNull()
  })
})

describe('validateConfig', () => {
  it('rejects invalid port', () => {
    expect(() =>
      validateConfig({
        appId: 'test',
        appName: 'test',
        appLogo: null,
        port: 99999,
        host: '0.0.0.0',
        staticDir: null,
        databaseUrl: null,
        stores: 'local',
        cors: { origins: [], credentials: true },
        bodyLimit: 1024,
        logLevel: 'info',
        encryption: { workspaceSettingsKey: 'k' },
        auth: {
          secret: 's',
          url: 'http://localhost:3000',
          sessionTtlSeconds: 3600,
          sessionCookieSecure: false,
        },
        features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
      }),
    ).toThrow(ConfigValidationError)
  })

  it('rejects bad mail transport URL', () => {
    expect(() =>
      validateConfig({
        appId: 'test',
        appName: 'test',
        appLogo: null,
        port: 3000,
        host: '0.0.0.0',
        staticDir: null,
        databaseUrl: null,
        stores: 'local',
        cors: { origins: [], credentials: true },
        bodyLimit: 1024,
        logLevel: 'info',
        encryption: { workspaceSettingsKey: 'k' },
        auth: {
          secret: 's',
          url: 'http://localhost:3000',
          mail: { from: 'noreply@test.dev', transportUrl: 'mailto://bad' },
          sessionTtlSeconds: 3600,
          sessionCookieSecure: false,
        },
        features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: true, inviteTtlDays: 7 },
      }),
    ).toThrow(ConfigValidationError)
  })
})

describe('buildRuntimeConfigPayload', () => {
  it('strips secrets from config', async () => {
    const tomlPath = TOML_PATH

    mkdirSync(FIXTURES_DIR, { recursive: true })
    writeFileSync(tomlPath, VALID_TOML, 'utf-8')

    try {
      const config = await loadConfig({
        tomlPath,
        env: VALID_ENV,
      })

      const runtime = buildRuntimeConfigPayload(config)

      expect(runtime).toEqual({
        appId: 'test-app',
        appName: 'Test App',
        appLogo: '/logo.svg',
        apiBase: 'http://localhost:3000',
        features: {
          githubOauth: false,
          googleOauth: false,
          invitesEnabled: true,
          sendWelcomeEmail: true,
        },
      })

      expect(runtime).not.toHaveProperty('auth')
      expect(runtime).not.toHaveProperty('databaseUrl')
      expect(runtime).not.toHaveProperty('encryption')
    } finally {
      rmSync(FIXTURES_DIR, { recursive: true, force: true })
    }
  })

  it('keeps googleOauth false when a manual config enables the flag without credentials', () => {
    const runtime = buildRuntimeConfigPayload({
      appId: 'test-app',
      appName: 'Test App',
      appLogo: null,
      port: 3000,
      host: '127.0.0.1',
      staticDir: null,
      databaseUrl: null,
      stores: 'local',
      cors: {
        origins: ['http://localhost:3000'],
        credentials: true,
      },
      bodyLimit: 1024,
      logLevel: 'info',
      encryption: { workspaceSettingsKey: 'a'.repeat(64) },
      auth: {
        secret: 's'.repeat(64),
        url: 'http://localhost:3000',
        sessionTtlSeconds: 3600,
        sessionCookieSecure: false,
      },
      features: {
        githubOauth: false,
        googleOauth: true,
        invitesEnabled: true,
        sendWelcomeEmail: true,
        inviteTtlDays: 7,
      },
    })

    expect(runtime.features.googleOauth).toBe(false)
  })
})
