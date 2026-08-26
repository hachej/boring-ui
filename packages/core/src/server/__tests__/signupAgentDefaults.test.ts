import { describe, expect, it, vi } from 'vitest'
import type { CoreConfig } from '../../shared/types.js'
import type { WorkspaceStore } from '../app/types.js'
import { createPostSignupHook, type PostSignupContext } from '../auth/postSignupHook.js'
import {
  SignupAgentDefaultsConfigError,
  TRUSTED_SIGNUP_HOSTNAME_HEADER,
  assertSignupAgentDefaultsInFleet,
  assertSignupAgentDefaultsUseBoundedProxy,
  compileSignupAgentDefaults,
  normalizeSignupHostname,
  parseSignupAgentDefaults,
  resolveSignupDefaultAgentTypeId,
} from '../signupAgentDefaults.js'
import { ERROR_CODES } from '../../shared/errors.js'

describe('normalizeSignupHostname', () => {
  it('normalizes case, port, and trailing dot to an exact hostname', () => {
    expect(normalizeSignupHostname('App.Seneca.EXAMPLE:443')).toBe('app.seneca.example')
    expect(normalizeSignupHostname('app.example.')).toBe('app.example')
    expect(normalizeSignupHostname('  app.example  ')).toBe('app.example')
  })

  it('returns null for absent or malformed hosts instead of guessing', () => {
    expect(normalizeSignupHostname(null)).toBeNull()
    expect(normalizeSignupHostname(undefined)).toBeNull()
    expect(normalizeSignupHostname('')).toBeNull()
    expect(normalizeSignupHostname('[::1]:3000')).toBeNull()
    expect(normalizeSignupHostname('exa mple.com')).toBeNull()
    expect(normalizeSignupHostname('http://app.example')).toBeNull()
    expect(normalizeSignupHostname('app.example,evil.example')).toBeNull()
    expect(normalizeSignupHostname('app.example:not-a-port')).toBeNull()
    expect(normalizeSignupHostname('app.example:65536')).toBeNull()
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
    expect(() => parseSignupAgentDefaults(new Map())).toThrow(SignupAgentDefaultsConfigError)
    expect(() => parseSignupAgentDefaults(new Date())).toThrow(SignupAgentDefaultsConfigError)
  })

  it('accepts exact hostname keys that shadow Object prototype properties', () => {
    expect(parseSignupAgentDefaults({ constructor: 'legal' })).toEqual({ constructor: 'legal' })
  })

  it('uses the canonical stable error code', () => {
    try {
      parseSignupAgentDefaults({ '*.example': 'legal' })
      expect.unreachable('invalid signup mapping should throw')
    } catch (error) {
      expect(error).toMatchObject({ code: ERROR_CODES.INVALID_SIGNUP_AGENT_DEFAULTS })
    }
  })
})

describe('assertSignupAgentDefaultsUseBoundedProxy', () => {
  it('rejects legacy unbounded forwarded-host trust for a non-empty mapping', () => {
    expect(() => assertSignupAgentDefaultsUseBoundedProxy(
      { 'legal.example': 'legal' },
      'legacy-unsafe',
    )).toThrow(SignupAgentDefaultsConfigError)
  })

  it('allows direct Host resolution, bounded proxy trust, and an empty mapping', () => {
    expect(() => assertSignupAgentDefaultsUseBoundedProxy({ 'legal.example': 'legal' }, undefined)).not.toThrow()
    expect(() => assertSignupAgentDefaultsUseBoundedProxy(
      { 'legal.example': 'legal' },
      { cidrs: ['10.0.0.0/8'], hops: 1 },
    )).not.toThrow()
    expect(() => assertSignupAgentDefaultsUseBoundedProxy({}, 'legacy-unsafe')).not.toThrow()
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
  const create = vi.fn(
    async (
      _userId: string,
      _name: string,
      _appId: string,
      _options?: Record<string, unknown>,
    ) => ({ id: 'ws-1' }),
  )
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
  rawContext?: unknown
}) {
  const config = opts.config ?? makeConfig()
  const { store, create, acceptInvite } = makeFakeStore(opts.state)
  const hook = createPostSignupHook({
    config,
    signupAgentDefaults: compileSignupAgentDefaults(
      config.signupAgentDefaults,
      ['boring-v2', 'legal'],
      config.security?.trustedProxy,
    ),
    workspaceStore: store,
    transport: null,
  })
  await hook({ ...user }, opts.rawContext ?? ctxWithHeaders(opts.headers ?? {}))
  return { create, acceptInvite }
}

describe('signup-domain default-agent initialization (Decision 28 hook)', () => {
  it('does not consume an uncompiled mapping directly from CoreConfig', async () => {
    const config = makeConfig()
    const { store, create } = makeFakeStore()
    const hook = createPostSignupHook({ config, workspaceStore: store, transport: null })

    await hook(user, ctxWithHeaders({ [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'legal.example' }))

    expect(create.mock.calls[0]![3]).toEqual({
      isDefault: true,
      defaultAgentTypeId: 'boring-v2',
    })
  })

  it('initializes the new default workspace from the exact trusted host mapping', async () => {
    const { create } = await runSignup({ headers: { [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'legal.example' } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(user.id, 'Default workspace', 'test-app', {
      isDefault: true,
      defaultAgentTypeId: 'legal',
    })
  })

  it('normalizes the host (case/port) before the exact lookup', async () => {
    const { create } = await runSignup({ headers: { [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'Legal.Example:443' } })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'legal' })
  })

  it('falls back to the boot default for unmapped hosts; email domain never selects', async () => {
    // User email is someone@legal.example, but the request host is unmapped:
    // the email domain must have no effect on seat selection.
    const { create } = await runSignup({ headers: { [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'unmapped.example' } })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'boring-v2' })
  })

  it('preserves legacy compatibility when no regular application default is configured', async () => {
    const config = makeConfig({ defaultAgentTypeId: undefined, signupAgentDefaults: undefined })
    const { store, create } = makeFakeStore()
    const hook = createPostSignupHook({ config, workspaceStore: store, transport: null })

    await hook(user, null)

    expect(create).toHaveBeenCalledWith(user.id, 'Default workspace', config.appId, {
      isDefault: true,
      defaultAgentTypeId: undefined,
    })
  })

  it('never reads the hostname or agent id from caller-controlled headers', async () => {
    const { create } = await runSignup({
      rawContext: {
        ...ctxWithHeaders({
          host: 'legal.example',
          'x-forwarded-host': 'legal.example',
          'x-agent-type-id': 'legal',
          'x-default-agent': 'legal',
        }),
        body: { hostname: 'legal.example', agentTypeId: 'legal' },
        query: { hostname: 'legal.example', agentTypeId: 'legal' },
      },
    })
    expect(create.mock.calls[0]![3]).toEqual({ isDefault: true, defaultAgentTypeId: 'boring-v2' })
  })

  it('does not persist the signup hostname as product identity', async () => {
    const { create } = await runSignup({ headers: { [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'legal.example' } })
    const [, name, appId, options] = create.mock.calls[0]!
    expect(name).toBe('Default workspace')
    expect(appId).toBe('test-app')
    expect(Object.keys(options as object).sort()).toEqual(['defaultAgentTypeId', 'isDefault'])
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('legal.example')
  })

  it('invite acceptance joins the invited workspace and never creates or rewrites a default', async () => {
    const { create, acceptInvite } = await runSignup({
      headers: { [TRUSTED_SIGNUP_HOSTNAME_HEADER]: 'legal.example', 'x-invite-token': 'tok' },
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
