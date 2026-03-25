import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, validateConfig, type ServerConfig } from '../config.js'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns default config when no env vars are set', () => {
    const config = loadConfig()
    expect(config.port).toBe(8000)
    expect(config.host).toBe('0.0.0.0')
    expect(config.corsOrigins).toBeInstanceOf(Array)
    expect(config.corsOrigins.length).toBeGreaterThan(0)
  })

  it('reads PORT from env', () => {
    process.env.PORT = '9000'
    const config = loadConfig()
    expect(config.port).toBe(9000)
  })

  it('reads DATABASE_URL from env', () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb'
    const config = loadConfig()
    expect(config.databaseUrl).toBe('postgres://test:test@localhost:5432/testdb')
  })

  it('reads CORS_ORIGINS from env as comma-separated', () => {
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:5173'
    const config = loadConfig()
    expect(config.corsOrigins).toEqual([
      'http://localhost:3000',
      'http://localhost:5173',
    ])
  })

  it('reads workspace root from env', () => {
    process.env.WORKSPACE_ROOT = '/tmp/workspaces'
    const config = loadConfig()
    expect(config.workspaceRoot).toBe('/tmp/workspaces')
  })

  // Session secret precedence: BORING_UI_SESSION_SECRET → BORING_SESSION_SECRET → auto-gen
  it('prefers BORING_UI_SESSION_SECRET over BORING_SESSION_SECRET', () => {
    process.env.BORING_UI_SESSION_SECRET = 'ui-secret'
    process.env.BORING_SESSION_SECRET = 'legacy-secret'
    const config = loadConfig()
    expect(config.sessionSecret).toBe('ui-secret')
  })

  it('falls back to BORING_SESSION_SECRET', () => {
    delete process.env.BORING_UI_SESSION_SECRET
    process.env.BORING_SESSION_SECRET = 'legacy-secret'
    const config = loadConfig()
    expect(config.sessionSecret).toBe('legacy-secret')
  })

  it('auto-generates session secret when neither env var is set', () => {
    delete process.env.BORING_UI_SESSION_SECRET
    delete process.env.BORING_SESSION_SECRET
    const config = loadConfig()
    expect(config.sessionSecret).toBeTruthy()
    expect(config.sessionSecret!.length).toBeGreaterThan(20)
  })

  // Auto-detect neon
  it('auto-detects neon provider when NEON_AUTH_BASE_URL is set', () => {
    process.env.NEON_AUTH_BASE_URL = 'https://neon.example.com'
    delete process.env.CONTROL_PLANE_PROVIDER
    const config = loadConfig()
    expect(config.controlPlaneProvider).toBe('neon')
  })

  it('defaults to local when no neon URL', () => {
    delete process.env.NEON_AUTH_BASE_URL
    delete process.env.CONTROL_PLANE_PROVIDER
    const config = loadConfig()
    expect(config.controlPlaneProvider).toBe('local')
  })

  // Agents mode
  it('reads agents mode from env', () => {
    process.env.AGENTS_MODE = 'backend'
    const config = loadConfig()
    expect(config.agentsMode).toBe('backend')
  })

  it('defaults agents mode to frontend', () => {
    delete process.env.AGENTS_MODE
    delete process.env.BUI_AGENTS_MODE
    const config = loadConfig()
    expect(config.agentsMode).toBe('frontend')
  })

  // Workspace backend
  it('defaults workspace backend to bwrap', () => {
    const config = loadConfig()
    expect(config.workspaceBackend).toBe('bwrap')
  })

  // Agent runtime
  it('defaults agent runtime to pi', () => {
    const config = loadConfig()
    expect(config.agentRuntime).toBe('pi')
  })

  // Agent placement
  it('defaults agent placement to browser', () => {
    const config = loadConfig()
    expect(config.agentPlacement).toBe('browser')
  })

  // Neon Auth JWKS URL
  it('reads NEON_AUTH_JWKS_URL from env', () => {
    process.env.NEON_AUTH_JWKS_URL = 'https://neon.example.com/.well-known/jwks.json'
    const config = loadConfig()
    expect(config.neonAuthJwksUrl).toBe('https://neon.example.com/.well-known/jwks.json')
  })

  // GitHub App config
  it('reads GitHub App config from env', () => {
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_APP_SLUG = 'my-app'
    const config = loadConfig()
    expect(config.githubAppId).toBe('12345')
    expect(config.githubAppSlug).toBe('my-app')
  })

  // GitHub slug validation
  it('rejects invalid GitHub app slug', () => {
    process.env.GITHUB_APP_SLUG = '../malicious'
    const config = loadConfig()
    expect(config.githubAppSlug).toBeUndefined()
  })

  // Public origin validation
  it('normalizes valid public origin', () => {
    process.env.BORING_UI_PUBLIC_ORIGIN = 'https://myapp.example.com'
    const config = loadConfig()
    expect(config.publicAppOrigin).toBe('https://myapp.example.com')
  })

  it('rejects invalid public origin', () => {
    process.env.BORING_UI_PUBLIC_ORIGIN = 'not-a-url'
    const config = loadConfig()
    expect(config.publicAppOrigin).toBeUndefined()
  })
})

describe('validateConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('passes for local mode without DATABASE_URL', () => {
    const config = loadConfig()
    // Should not throw for local mode
    expect(() => validateConfig({ ...config, controlPlaneProvider: 'local' })).not.toThrow()
  })

  it('throws for neon mode without DATABASE_URL', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({
        ...config,
        controlPlaneProvider: 'neon',
        databaseUrl: undefined,
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('throws for neon mode without NEON_AUTH_BASE_URL', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({
        ...config,
        controlPlaneProvider: 'neon',
        databaseUrl: 'postgres://test@localhost/test',
        neonAuthBaseUrl: undefined,
      }),
    ).toThrow(/NEON_AUTH_BASE_URL/)
  })

  it('passes for neon mode with all required fields', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({
        ...config,
        controlPlaneProvider: 'neon',
        databaseUrl: 'postgres://test@localhost/test',
        neonAuthBaseUrl: 'https://neon.example.com',
      }),
    ).not.toThrow()
  })

  it('throws for invalid workspace backend', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({ ...config, workspaceBackend: 'invalid' as any }),
    ).toThrow(/workspace.backend/)
  })

  it('throws for invalid agent runtime', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({ ...config, agentRuntime: 'invalid' as any }),
    ).toThrow(/agent.runtime/)
  })

  it('throws for invalid agent placement', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({ ...config, agentPlacement: 'invalid' as any }),
    ).toThrow(/agent.placement/)
  })

  it('throws when placement=server without DATABASE_URL', () => {
    const config = loadConfig()
    expect(() =>
      validateConfig({
        ...config,
        agentPlacement: 'server',
        workspaceBackend: 'bwrap',
        databaseUrl: undefined,
        controlPlaneProvider: 'local',
      }),
    ).toThrow(/placement.*server.*DATABASE_URL/)
  })
})
