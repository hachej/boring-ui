import { readFile } from 'node:fs/promises'

import { createCoreApp, type CoreRequestScope } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import type { FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import type { D1ActiveCollection, D1ActiveCollectionReader } from '../activeCollectionReader.js'
import { D1HostErrorCode } from '../d1Plan.js'
import { createD1HostSurfaceResolver, D1_TRUSTED_CADDY_PEER } from '../hostSurface.js'

const HOST = 'insurance.example.test'
const CLIENT = '198.51.100.7'
const scope = {
  bindingId: 'insurance', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', activeRevision: 'r0000000042',
  resolvedDigest: `sha256:${'b'.repeat(64)}`,
} as const

function collection(hostnames: readonly string[] = [HOST]): D1ActiveCollection {
  return {
    active: { schemaVersion: 1, revisionId: scope.activeRevision, desiredStateDigest: `sha256:${'a'.repeat(64)}` },
    desired: { plan: { bindings: hostnames.map((hostname, index) => ({
      hostname, bindingId: index === 0 ? scope.bindingId : `binding-${index}`,
      workspaceId: index === 0 ? scope.workspaceId : `workspace:${index}`,
      defaultDeploymentId: index === 0 ? scope.defaultDeploymentId : `deployment:${index}`,
    })) }, resolvedBindings: hostnames.map((_hostname, index) => ({
      bindingId: index === 0 ? scope.bindingId : `binding-${index}`,
      resolvedDigest: index === 0 ? scope.resolvedDigest : `sha256:${String(index).padStart(64, '0')}`,
    })) },
  } as unknown as D1ActiveCollection
}

function reader(value: D1ActiveCollection | null = collection(), failure = false) {
  let calls = 0
  const activeReader: D1ActiveCollectionReader = {
    async read() {
      calls += 1
      if (failure) throw new Error('/private/host')
      return value
    },
  }
  return { activeReader, calls: () => calls }
}

function request(rawHeaders: string[], peer: string | undefined, ips: string[], method = 'GET', url = '/'): FastifyRequest {
  return { raw: { rawHeaders, socket: { remoteAddress: peer }, method, url }, ips } as unknown as FastifyRequest
}

function resolver(activeReader: D1ActiveCollectionReader) {
  return createD1HostSurfaceResolver({ activeReader, trustedPeer: D1_TRUSTED_CADDY_PEER })
}

async function violation(action: Promise<unknown>): Promise<void> {
  const error = await action.catch((caught) => caught)
  expect(error).toMatchObject({ status: 421, code: D1HostErrorCode.HOST_SCOPE_VIOLATION, message: D1HostErrorCode.HOST_SCOPE_VIOLATION })
  expect(JSON.stringify(error)).not.toMatch(/insurance|workspace|private|host-1|198\.51/)
}

const TEST_CONFIG: CoreConfig = {
  appId: 'test', appName: 'Test', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
  databaseUrl: null, stores: 'local', cors: { origins: [], credentials: true }, bodyLimit: 1024 * 1024, logLevel: 'fatal',
  security: { trustedProxy: { cidrs: [`${D1_TRUSTED_CADDY_PEER}/32`], hops: 1 }, csp: { enabled: false } },
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: { secret: 's'.repeat(64), url: 'http://localhost:3000', sessionTtlSeconds: 3600, sessionCookieSecure: false },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: false, sendWelcomeEmail: false, inviteTtlDays: 7 },
}

let app: Awaited<ReturnType<typeof createCoreApp>> | undefined
afterEach(async () => { await app?.close(); app = undefined })

describe('D1 host surface resolver', () => {
  it('bypasses scope only for exact unforwarded loopback bootstrap requests', async () => {
    const state = reader(null); const resolve = resolver(state.activeReader)
    for (const url of ['/health', '/internal/d1/readiness']) {
      expect(await resolve(request(['Host', 'ignored'], '127.0.0.1', ['127.0.0.1'], 'GET', url))).toBeUndefined()
    }
    expect(state.calls()).toBe(0)
  })

  it.each([
    ['query', '127.0.0.1', 'GET', '/health?probe=1', ['Host', HOST]],
    ['encoded', '127.0.0.1', 'GET', '/he%61lth', ['Host', HOST]],
    ['double encoded', '127.0.0.1', 'GET', '/internal/d1/read%2569ness', ['Host', HOST]],
    ['deep encoded', '127.0.0.1', 'GET', '/he%252525252561lth', ['Host', HOST]],
    ['malformed encoded', '127.0.0.1', 'GET', '/health%ZZ', ['Host', HOST]],
    ['suffix', '127.0.0.1', 'GET', '/health/more', ['Host', HOST]],
    ['prefix', '127.0.0.1', 'GET', '/private/health', ['Host', HOST]],
    ['HEAD', '127.0.0.1', 'HEAD', '/health', ['Host', HOST]],
    ['POST', '127.0.0.1', 'POST', '/internal/d1/readiness', ['Host', HOST]],
    ['IPv6', '::1', 'GET', '/health', ['Host', HOST]],
    ['mapped IPv6', '::ffff:127.0.0.1', 'GET', '/health', ['Host', HOST]],
    ['Caddy', D1_TRUSTED_CADDY_PEER, 'GET', '/health', ['Host', HOST]],
    ['forwarding spoof', '127.0.0.1', 'GET', '/health', ['Host', HOST, 'X-Forwarded-Proto', 'https']],
  ])('rejects non-exact local bootstrap variant %s', async (_name, peer, method, url, headers) => {
    await violation(Promise.resolve(resolver(reader().activeReader)(request(headers, peer, [peer], method, url))))
  })

  it('resolves direct and exact-Caddy authorities per request as frozen scopes', async () => {
    const state = reader(); const resolve = resolver(state.activeReader)
    const direct = await resolve(request(['Host', HOST], CLIENT, [CLIENT]))
    const caddy = await resolve(request(
      ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', CLIENT],
      D1_TRUSTED_CADDY_PEER,
      [D1_TRUSTED_CADDY_PEER, CLIENT],
    ))
    for (const result of [direct, caddy]) {
      expect(result).toEqual(scope)
      if (result === undefined) throw new Error('expected resolved D1 request scope')
      expect(Object.keys(result)).toEqual(['bindingId', 'workspaceId', 'defaultDeploymentId', 'activeRevision', 'resolvedDigest'])
      expect(Object.isFrozen(result)).toBe(true)
    }
    expect(state.calls()).toBe(2)
  })

  it.each([
    ['Forwarded empty/repeated', ['Host', HOST, 'Forwarded', '', 'FORWARDED', 'for=evil'], CLIENT, [CLIENT]],
    ['missing Host', [], CLIENT, [CLIENT]],
    ['repeated Host', ['Host', HOST, 'host', HOST], CLIENT, [CLIENT]],
    ['direct XFH', ['Host', HOST, 'X-Forwarded-Host', HOST], CLIENT, [CLIENT]],
    ['direct XFF', ['Host', HOST, 'X-Forwarded-For', CLIENT], CLIENT, [CLIENT]],
    ['direct proxy chain', ['Host', HOST], CLIENT, [CLIENT, '192.0.2.1']],
    ['missing direct peer', ['Host', HOST], undefined, []],
    ['Caddy missing XFH', ['Host', HOST], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy missing XFF', ['Host', HOST, 'X-Forwarded-Host', HOST], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy empty XFF', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', ''], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy comma XFF', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', `${CLIENT}, 192.0.2.1`], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy repeated XFF', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', CLIENT, 'x-forwarded-for', CLIENT], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy mismatched XFF', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', '192.0.2.1'], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy repeated XFH', ['Host', HOST, 'X-Forwarded-Host', HOST, 'x-forwarded-host', HOST, 'X-Forwarded-For', CLIENT], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy mismatched XFH', ['Host', HOST, 'X-Forwarded-Host', 'other.example.test', 'X-Forwarded-For', CLIENT], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER, CLIENT]],
    ['Caddy short chain', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', CLIENT], D1_TRUSTED_CADDY_PEER, [D1_TRUSTED_CADDY_PEER]],
    ['Caddy wrong chain', ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', CLIENT], D1_TRUSTED_CADDY_PEER, [CLIENT, D1_TRUSTED_CADDY_PEER]],
    ['odd raw headers', ['Host'], CLIENT, [CLIENT]],
  ])('rejects malformed %s input', async (_name, headers, peer, ips) => {
    await violation(Promise.resolve(resolver(reader().activeReader)(request(headers, peer, ips))))
  })

  it.each([
    'Insurance.example.test', 'insurance.example.test:443', 'insurance.example.test.', '*.example.test',
    'https://insurance.example.test', 'example.test/path', 'user@example.test', 'éxample.test',
    ' example.test', 'example.test ', 'example.test,evil.test', '192.168.1.1', '127.1',
    '127.0.0.01', '0127.0.0.1', '0x7f.0.0.1', 'localhost',
  ])('rejects noncanonical hostname %s', async (hostname) => {
    await violation(Promise.resolve(resolver(reader().activeReader)(request(['Host', hostname], CLIENT, [CLIENT]))))
  })

  it('rejects absent, unreadable, unknown, and duplicate active bindings', async () => {
    for (const state of [reader(null), reader(collection(), true), reader(collection(['other.example.test'])), reader(collection([HOST, HOST]))]) {
      await violation(Promise.resolve(resolver(state.activeReader)(request(['Host', HOST], CLIENT, [CLIENT]))))
    }
    expect(() => createD1HostSurfaceResolver({ activeReader: reader().activeReader, trustedPeer: '192.168.255.251' }))
      .toThrow(expect.objectContaining({ code: D1HostErrorCode.PLAN_INVALID, details: { field: 'trustedPeer' } }))
  })

  it('fails with exact generic 421 before later auth/rate/handler effects', async () => {
    const order: string[] = []
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false, requestScopeResolver: resolver(reader(collection(['other.example.test'])).activeReader) })
    app.addHook('onRequest', async () => { order.push('auth') })
    app.post('/auth/sign-in/email', async () => { order.push('handler'); return { ok: true } })
    await app.ready()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/auth/sign-in/email', remoteAddress: CLIENT, headers: { host: HOST } })
      expect(response.statusCode).toBe(421)
      expect(JSON.parse(response.body)).toMatchObject({
        error: D1HostErrorCode.HOST_SCOPE_VIOLATION, code: D1HostErrorCode.HOST_SCOPE_VIOLATION,
        message: D1HostErrorCode.HOST_SCOPE_VIOLATION, requestId: expect.any(String),
      })
      expect(response.body).not.toMatch(/insurance|workspace|other\.example/)
    }
    expect(order).toEqual([])
  })

  it('uses Fastify exact-proxy ordering and rejects a forwarded extra hop', async () => {
    app = await createCoreApp(TEST_CONFIG, {
      manageShutdown: false,
      requestScopeResolver: resolver(reader().activeReader),
    })
    app.get('/scope', async (request) => request.requestScope)
    await app.ready()

    const accepted = await app.inject({
      method: 'GET',
      url: '/scope',
      remoteAddress: D1_TRUSTED_CADDY_PEER,
      headers: { host: HOST, 'x-forwarded-host': HOST, 'x-forwarded-for': CLIENT },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual(scope)

    const rejected = await app.inject({
      method: 'GET',
      url: '/scope',
      remoteAddress: D1_TRUSTED_CADDY_PEER,
      headers: {
        host: HOST,
        'x-forwarded-host': HOST,
        'x-forwarded-for': `${CLIENT}, 192.0.2.1`,
      },
    })
    expect(rejected.statusCode).toBe(421)
    expect(rejected.json()).toMatchObject({
      error: D1HostErrorCode.HOST_SCOPE_VIOLATION,
      code: D1HostErrorCode.HOST_SCOPE_VIOLATION,
      message: D1HostErrorCode.HOST_SCOPE_VIOLATION,
    })
    expect(rejected.body).not.toMatch(/insurance|192\.0\.2/)
  })

  it('keeps generic apps undecorated and response bytes unchanged when absent', async () => {
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false })
    expect(app.hasRequestDecorator('requestScope')).toBe(false)
    app.get('/generic', async () => ({ ok: true })); await app.ready()
    expect((await app.inject({ method: 'GET', url: '/generic' })).body).toBe('{"ok":true}')
  })

  it('attaches only the frozen deployment scope and performs no auth or membership lookup', async () => {
    const extra = { ...scope, ignored: 'value' } as CoreRequestScope
    app = await createCoreApp(TEST_CONFIG, { manageShutdown: false, requestScopeResolver: async () => extra })
    app.get('/scope', async (request) => ({ keys: Object.keys(request.requestScope!), frozen: Object.isFrozen(request.requestScope) }))
    await app.ready()
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/scope' })).body)).toEqual({
      keys: ['bindingId', 'workspaceId', 'defaultDeploymentId', 'activeRevision', 'resolvedDigest'], frozen: true,
    })
    const source = await readFile(new URL('../hostSurface.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/workspaceStore|isMember|membership|authenticate|cache|watch|landing/)
  })
})
