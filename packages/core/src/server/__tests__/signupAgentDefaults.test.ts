import { describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../shared/types.js'
import type { WorkspaceStore } from '../app/types.js'
import { createPostSignupHook, type PostSignupContext } from '../auth/postSignupHook.js'
import {
  SignupAgentDefaultsConfigError,
  assertSignupAgentDefaultsInFleet,
  normalizeSignupHostname,
  parseSignupAgentDefaults,
  resolveSignupDefaultAgentTypeId,
} from '../signupAgentDefaults.js'

describe('normalizeSignupHostname', () => {
  it('normalizes case, port, and trailing dot to an exact hostname', () => {
    expect(normalizeSignupHostname('App.Seneca.EXAMPLE:443')).toBe('app.seneca.example')
    expect(normalizeSignupHostname('app.example.')).toBe('app.example')
    expect(normalizeSignupHostname('  app.example  ')).toBe('app.example')
  })

  it('uses only the first entry of a comma-joined forwarded host', () => {
    expect(normalizeSignupHostname('app.example, evil.example')).toBe('app.example')
  })

  it('returns null for absent or malformed hosts instead of guessing', () => {
    expect(normalizeSignupHostname(null)).toBeNull()
    expect(normalizeSignupHostname(undefined)).toBeNull()
    expect(normalizeSignupHostname('')).toBeNull()
    expect(normalizeSignupHostname('[::1]:3000')).toBeNull()
    expect(normalizeSignupHostname('exa mple.com')).toBeNull()
    expect(normalizeSignupHostname('http://app.example')).toBeNull()
    expect(normalizeSignupHostname('app_example.com')).toBeNull()
    expect(normalizeSignupHostname(`${'a'.repeat(260)}.example`)).toBeNull()
  })
})

describe('parseSignupAgentDefaults', () => {
  it('accepts an exact-hostname map and freezes it', () => {
    const map = parseSignupAgentDefaults({ 'legal.example': 'legal', 'app.example': 'boring-v2' })
    expect(map).toEqual({ 'legal.example': 'legal', 'app.example': 'boring-v2' })
    expect(Object.isFrozen(map)).toBe(true)
  })

  it('maps absent config to an empty map', () => {
    expect(parseSignupAgentDefaults(undefined)).toEqual({})
    expect(parseSignupAgentDefaults(null)).toEqual({})
  })

  it('fail-fast rejects non-exact or malformed hostname keys', () => {
    for (const key of ['Legal.example', 'legal.example:443', 'https://legal.example', 'legal.example.', '*.example', '']) {
      expect(() => parseSignupAgentDefaults({ [key]: 'legal' })).toThrow(SignupAgentDefaultsConfigError)
    }
  })

  it('fail-fast rejects malformed agent type ids and non-object shapes', () => {
    expect(() => parseSignupAgentDefaults({ 'legal.example': 'Legal' })).toThrow(SignupAgentDefaultsConfigError)
    expect(() => parseSignupAgentDefaults({ 'legal.example': 7 })).toThrow(SignupAgentDefaultsConfigError)
    expect(() => parseSignupAgentDefaults(['legal.example'])).toThrow(SignupAgentDefaultsConfigError)
    expect(() => parseSignupAgentDefaults('legal.example=legal')).toThrow(SignupAgentDefaultsConfigError)
  })
})

describe('assertSignupAgentDefaultsInFleet (boot fail-fast)', () => {
  const fleet = ['default', 'boring-v2', 'legal']

  it('accepts mappings whose values all name validated fleet members', () => {
    expect(() =>
      assertSignupAgentDefaultsInFleet({ 'legal.example': 'legal', 'app.example': 'boring-v2' }, fleet),
    ).not.toThrow()
    expect(() => assertSignupAgentDefaultsInFleet(undefined, fleet)).not.toThrow()
  })

  it('rejects boot when a mapping names an unknown fleet member', () => {
    expect(() =>
      assertSignupAgentDefaultsInFleet({ 'legal.example': 'ghost-agent' }, fleet),
    ).toThrow(SignupAgentDefaultsConfigError)
    expect(() =>
      assertSignupAgentDefaultsInFleet({ 'legal.example': 'legal' }, []),
    ).toThrow(SignupAgentDefaultsConfigError)
  })
})

describe('resolveSignupDefaultAgentTypeId', () => {
  const map = parseSignupAgentDefaults({ 'legal.example': 'legal' })

  it('matches only the exact configured hostname', () => {
    expect(resolveSignupDefaultAgentTypeId(map, 'legal.example')).toBe('legal')
    // No suffix/wildcard/subdomain matching.
    expect(resolveSignupDefaultAgentTypeId(map, 'sub.legal.example')).toBeUndefined()
    expect(resolveSignupDefaultAgentTypeId(map, 'example')).toBeUndefined()
    expect(resolveSignupDefaultAgentTypeId(map, 'other.example')).toBeUndefined()
  })

  it('yields nothing for absent maps, null hostnames, and prototype keys', () => {
    expect(resolveSignupDefaultAgentTypeId(undefined, 'legal.example')).toBeUndefined()
    expect(resolveSignupDefaultAgentTypeId(map, null)).toBeUndefined()
    expect(resolveSignupDefaultAgentTypeId(map, 'constructor')).toBeUndefined()
    expect(resolveSignupDefaultAgentTypeId(map, 'toString')).toBeUndefined()
  })
})

// --- Signup path behavior --------------------------------------------------

function makeConfig(overrides?: Partial<CoreConfig>): CoreConfig {
  return {
    appId: 'test-app',
    appName: 'Test App',
    appLogo: null,
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    databaseUrl: null,
    stores: 'local',
    cors: { origins: [], credentials: true },
    bodyLimit: 1024,
    logLevel: 'silent' as CoreConfig['logLevel'],
    encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: { secret: 's'.repeat(64), url: 'http://localhost:3000', sessionTtlSeconds: 3600, sessionCookieSecure: false },
    features: { githubOauth: false, googleOauth: false, invitesEnabled: true, sendWelcomeEmail: false, inviteTtlDays: 7 },
    signupAgentDefaults: { 'legal.example': 'legal' },
    defaultAgentTypeId: 'boring-v2',
    ...overrides,
  } as CoreConfig
}

interface FakeStoreState {
  invite?: {
    id: string
    workspaceId: string
    email: string
    expiresAt: string
    acceptedAt: string | null
    lockedUntil?: string | null
  }
}

function makeFakeStore(state: FakeStoreState = {}) {
  const create = vi.fn(async () => ({ id: 'ws-1' }))
  const acceptInvite = vi.fn(async () => {})
  const store = {
    create,
    acceptInvite,
    getInviteByTokenHash: vi.fn(async () => state.invite ?? null),
  } as unknown as WorkspaceStore
  return { store, create, acceptInvite }
}

function ctxWithHeaders(headers: Record<string, string>): PostSignupContext {
  return {
    getHeader: (key: string) => headers[key.toLowerCase()] ?? null,
  }
}

const user = { id: 'user-1', email: 'someone@legal.example', name: 'Someone' }

async function runSignup(opts: {
  config?: CoreConfig
  headers?: Record<string, string>
  state?: FakeStoreState
}) {
  const config = opts.config ?? makeConfig()
  const { store, create, acceptInvite } = makeFakeStore(opts.state)
  const hook = createPostSignupHook({ config, workspaceStore: store, transport: null })
  await hook({ ...user }, ctxWithHeaders(opts.headers ?? {}))
  return { create, acceptInvite }
}

describe('signup-domain default-agent initialization (Decision 28 hook)', () => {
  it('initializes the new default workspace from the exact trusted host mapping', async () => {
    const { create } = await runSignup({ headers: { host: 'legal.example' } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(user.id, 'Default workspace', 'test-app', {
      isDefault: true,
      defaultAgentTypeId: 'legal',
    })
  })

  it('normalizes the host (case/port) before the exact lookup', async () => {
    const { create } = await runSignup({ headers: { host: 'Legal.Example:443' } })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'legal' })
  })

  it('falls back to the boot default for unmapped hosts; email domain never selects', async () => {
    // User email is someone@legal.example, but the request host is unmapped:
    // the email domain must have no effect on seat selection.
    const { create } = await runSignup({ headers: { host: 'unmapped.example' } })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'boring-v2' })
  })

  it('persists no default when neither mapping nor boot default apply', async () => {
    const { create } = await runSignup({
      config: makeConfig({ defaultAgentTypeId: undefined, signupAgentDefaults: undefined }),
      headers: { host: 'legal.example' },
    })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true })
  })

  it('never reads the agent id from bodies, queries, or arbitrary headers', async () => {
    const { create } = await runSignup({
      headers: {
        host: 'unmapped.example',
        'x-agent-type-id': 'legal',
        'x-default-agent': 'legal',
      },
    })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'boring-v2' })
  })

  it('ignores x-forwarded-host unless a trusted proxy is configured', async () => {
    const spoofed = await runSignup({
      headers: { host: 'unmapped.example', 'x-forwarded-host': 'legal.example' },
    })
    expect(spoofed.create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'boring-v2' })

    const trusted = await runSignup({
      config: makeConfig({
        security: { csp: { enabled: false }, trustedProxy: { cidrs: ['10.0.0.0/8'], hops: 1 } },
      }),
      headers: { host: 'internal.lb', 'x-forwarded-host': 'legal.example' },
    })
    expect(trusted.create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'legal' })
  })

  it('does not persist the signup hostname as product identity', async () => {
    const { create } = await runSignup({ headers: { host: 'legal.example' } })
    const [, name, appId, options] = create.mock.calls[0]!
    expect(name).toBe('Default workspace')
    expect(appId).toBe('test-app')
    expect(Object.keys(options as object).sort()).toEqual(['defaultAgentTypeId', 'isDefault'])
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('legal.example')
  })

  it('invite acceptance joins the invited workspace and never creates or rewrites a default', async () => {
    const { create, acceptInvite } = await runSignup({
      headers: { host: 'legal.example', 'x-invite-token': 'tok' },
      state: {
        invite: {
          id: 'inv-1',
          workspaceId: 'ws-invited',
          email: user.email,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          acceptedAt: null,
        },
      },
    })
    expect(acceptInvite).toHaveBeenCalledWith('ws-invited', 'inv-1', user.id)
    // No workspace creation at all: an existing workspace's persisted default
    // is untouched by the signup hostname.
    expect(create).not.toHaveBeenCalled()
  })
})
