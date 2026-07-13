import { readFile } from 'node:fs/promises'

import { createCoreApp } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { D1ActiveCollection, D1ActiveCollectionReader } from '../activeCollectionReader.js'
import { registerD1ReadinessRoute } from '../d1Readiness.js'
import { createD1AgentEffectAdmission, createD1ServerWiring } from '../d1ServerWiring.js'
import { D1HostErrorCode } from '../d1Plan.js'
import { createD1HostSurfaceResolver, D1_TRUSTED_CADDY_PEER } from '../hostSurface.js'

const HOST = 'insurance.example.test'
const DIGEST = `sha256:${'a'.repeat(64)}`
const CONFIG = {
  appId: 'test', appName: 'Test', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
  databaseUrl: null, stores: 'local', cors: { origins: [], credentials: true }, bodyLimit: 1024, logLevel: 'fatal',
  security: { csp: { enabled: false }, trustedProxy: { cidrs: [`${D1_TRUSTED_CADDY_PEER}/32`], hops: 1 } },
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: { secret: 's'.repeat(64), url: 'http://localhost', sessionTtlSeconds: 3600, sessionCookieSecure: false },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: false, sendWelcomeEmail: false, inviteTtlDays: 7 },
} satisfies CoreConfig

function collection(ready = true): D1ActiveCollection {
  const binding = { bindingId: 'z-binding', hostname: HOST, workspaceId: 'workspace:z', defaultDeploymentId: 'deployment:z' }
  return {
    active: { schemaVersion: 1, revisionId: 'r0000000042', desiredStateDigest: DIGEST },
    desired: { plan: { bindings: [binding, { ...binding, bindingId: 'a-binding', hostname: 'other.example.test' }] } },
    observation: { bindings: [{ bindingId: 'a-binding', ready: true }, { bindingId: 'z-binding', ready }] },
  } as unknown as D1ActiveCollection
}

function reader(value: D1ActiveCollection | null, rejects = false): D1ActiveCollectionReader {
  return { async read() { if (rejects) throw new Error('/private/revision'); return value } }
}

let app: Awaited<ReturnType<typeof createCoreApp>> | undefined
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks() })

async function build(activeReader: D1ActiveCollectionReader) {
  app = await createCoreApp(CONFIG, {
    manageShutdown: false,
    requestScopeResolver: createD1HostSurfaceResolver({ activeReader, trustedPeer: D1_TRUSTED_CADDY_PEER }),
  })
  app.get('/health', async () => ({ ok: true }))
  registerD1ReadinessRoute(app, { activeReader })
  await app.ready()
  return app
}

describe('D1 readiness and activation wiring', () => {
  it('keeps literal-IPv4 health available before publication while readiness is redacted', async () => {
    const instance = await build(reader(null))
    expect((await instance.inject({ method: 'GET', url: '/health', remoteAddress: '127.0.0.1' })).body).toBe('{"ok":true}')
    const response = await instance.inject({ method: 'GET', url: '/internal/d1/readiness', remoteAddress: '127.0.0.1' })
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      error: D1HostErrorCode.COLLECTION_NOT_READY, code: D1HostErrorCode.COLLECTION_NOT_READY,
      message: D1HostErrorCode.COLLECTION_NOT_READY, requestId: expect.any(String),
    })
  })

  it('returns only the sorted ready collection projection and rechecks local scope', async () => {
    const instance = await build(reader(collection()))
    const response = await instance.inject({ method: 'GET', url: '/internal/d1/readiness', remoteAddress: '127.0.0.1' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      schemaVersion: 1, activeRevision: 'r0000000042', desiredStateDigest: DIGEST,
      bindings: [{ bindingId: 'a-binding', ready: true }, { bindingId: 'z-binding', ready: true }],
    })
    const remote = await instance.inject({ method: 'GET', url: '/internal/d1/readiness', remoteAddress: '198.51.100.7', headers: { host: HOST } })
    expect(remote.statusCode).toBe(421)
    expect(remote.json()).toMatchObject({ code: D1HostErrorCode.HOST_SCOPE_VIOLATION, requestId: expect.any(String) })

    await instance.close(); app = Fastify(); app.decorateRequest('requestScope')
    app.addHook('onRequest', async (request) => { request.requestScope = {} as never })
    registerD1ReadinessRoute(app, { activeReader: reader(collection()) }); await app.ready()
    const independentlyRejected = await app.inject({ method: 'GET', url: '/internal/d1/readiness', remoteAddress: '127.0.0.1' })
    expect(independentlyRejected.statusCode).toBe(421)
    expect(independentlyRejected.json()).toMatchObject({ code: D1HostErrorCode.HOST_SCOPE_VIOLATION, requestId: expect.any(String) })
  })

  it.each([[null, false], [collection(), true], [collection(false), false]] as const)(
    'fails closed on absent, corrupt, or incomplete state', async (value, rejects) => {
      const response = await (await build(reader(value, rejects))).inject({ method: 'GET', url: '/internal/d1/readiness', remoteAddress: '127.0.0.1' })
      expect(response.statusCode).toBe(503)
      expect(response.body).not.toMatch(/private|workspace|deployment|revision/)
    },
  )

  it('constructs exact D1 wiring early and leaves generic mode untouched', async () => {
    const euid = vi.spyOn(process, 'geteuid').mockReturnValue(10001)
    vi.spyOn(process, 'getegid').mockReturnValue(10001)
    expect(createD1ServerWiring(CONFIG, {})).toBeUndefined()
    expect(euid).not.toHaveBeenCalled()
    const wiring = createD1ServerWiring(CONFIG, { BORING_D1_HOST_ID: 'eu-host-1', BORING_D1_OWNER_UID: '0' })!
    expect(Object.isFrozen(wiring)).toBe(true)
    expect(Object.keys(wiring)).toEqual(['requestScopeResolver', 'frontendRootHandler', 'admitAgentEffect', 'registerReadiness'])
    expect(createD1ServerWiring(CONFIG, { BORING_D1_HOST_ID: 'eu-host-1', BORING_D1_OWNER_UID: '4294967294' })).toBeDefined()

    const source = await readFile(new URL('../d1ServerWiring.ts', import.meta.url), 'utf8')
    const main = await readFile(new URL('../../main.ts', import.meta.url), 'utf8')
    expect(source.match(/createD1ActiveCollectionReader\(/g)).toHaveLength(1)
    expect(source).toContain("path.join('/var/lib/boring/d1', hostId)")
    expect(source).not.toMatch(/BORING_D1_(?:STATE_ROOT|APP_GID|ROOT)/)
    expect(main.indexOf('createD1ServerWiring(config)')).toBeLessThan(main.indexOf('createFullAppHostPluginComposition(config)'))
    expect(main).toContain('admitEffect: d1.admitAgentEffect')
    expect(main.indexOf('d1?.registerReadiness(app)')).toBeLessThan(main.indexOf('registerFullAppBoringMcpRoutes(app)'))
    expect(main.indexOf('registerFullAppBoringMcpRoutes(app)')).toBeLessThan(main.indexOf('app.listen('))
  })

  it('derives the unique current binding for each effect and fails closed without the one ledger', async () => {
    const current = collection()
    const activeReader = reader({
      ...current,
      desired: {
        ...current.desired,
        plan: {
          ...current.desired.plan,
          hostId: 'eu-host-1',
          bindings: current.desired.plan.bindings.map((binding) => binding.bindingId === 'a-binding'
            ? { ...binding, workspaceId: 'workspace:a', defaultDeploymentId: 'deployment:a' }
            : binding),
        },
      },
    } as D1ActiveCollection)
    const admit = vi.fn(async () => ({}) as never)
    const admitEffect = createD1AgentEffectAdmission({
      hostId: 'eu-host-1', activeReader, admissionLedger: { admit },
    })

    await admitEffect({ workspaceId: 'workspace:z', requestId: 'request-1' })
    expect(admit).toHaveBeenCalledWith(activeReader, {
      hostId: 'eu-host-1', bindingId: 'z-binding', workspaceId: 'workspace:z', defaultDeploymentId: 'deployment:z',
    })
    await expect(createD1AgentEffectAdmission({ hostId: 'eu-host-1', activeReader })({
      workspaceId: 'workspace:z', requestId: 'request-2',
    })).rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED, details: { field: 'admission' } })
    const duplicateReader = reader({
      ...current,
      desired: { ...current.desired, plan: { ...current.desired.plan, hostId: 'eu-host-1' } },
    } as D1ActiveCollection)
    await expect(createD1AgentEffectAdmission({
      hostId: 'eu-host-1', activeReader: duplicateReader, admissionLedger: { admit },
    })({ workspaceId: 'workspace:z', requestId: 'request-3' }))
      .rejects.toMatchObject({ code: D1HostErrorCode.ADMISSION_RECORD_FAILED })
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('rejects noncanonical owner, identity, and proxy inputs with field-only errors', () => {
    const euid = vi.spyOn(process, 'geteuid').mockReturnValue(10001)
    const egid = vi.spyOn(process, 'getegid').mockReturnValue(10001)
    const env = { BORING_D1_HOST_ID: 'eu-host-1', BORING_D1_OWNER_UID: '0' }
    const invalid = (change: Record<string, string | undefined>, field: string, config: CoreConfig = CONFIG) => {
      expect(() => createD1ServerWiring(config, { ...env, ...change })).toThrow(expect.objectContaining({ details: { field } }))
    }
    for (const owner of [undefined, '00', '+1', '10001', '1.0', ' 1', '4294967295', '9007199254740991']) {
      invalid({ BORING_D1_OWNER_UID: owner }, 'ownerUid')
    }
    invalid({ BORING_D1_HOST_ID: '../host' }, 'hostId')
    expect(() => createD1ServerWiring({ ...CONFIG, security: { ...CONFIG.security, trustedProxy: null } }, env))
      .toThrow(expect.objectContaining({ details: { field: 'trustedProxy' } }))
    euid.mockReturnValue(0); invalid({}, 'processUid')
    euid.mockReturnValue(10001); egid.mockReturnValue(0); invalid({}, 'processGid')
  })
})
