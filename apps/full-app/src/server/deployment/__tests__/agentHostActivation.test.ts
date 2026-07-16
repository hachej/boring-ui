import { readFile } from 'node:fs/promises'

import { createCoreApp } from '@hachej/boring-core/server'
import type { CoreConfig } from '@hachej/boring-core/shared'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentHostActiveCollection, AgentHostActiveCollectionReader } from '../activeCollectionReader.js'
import type { AgentHostServedCollectionAuthority } from '../bootCollection.js'
import { registerAgentHostReadinessRoute } from '../agentHostReadiness.js'
import { createAgentHostAgentEffectAdmission, createAgentHostServerWiring } from '../agentHostServerWiring.js'
import { AgentHostError, AgentHostErrorCode } from '../agentHostPlan.js'
import { createAgentHostSurfaceResolver, AGENT_HOST_TRUSTED_CADDY_PEER } from '../hostSurface.js'

const HOST = 'insurance.example.test'
const DIGEST = `sha256:${'a'.repeat(64)}`
const CONFIG = {
  appId: 'test', appName: 'Test', appLogo: null, port: 0, host: '127.0.0.1', staticDir: null,
  databaseUrl: null, stores: 'local', cors: { origins: [], credentials: true }, bodyLimit: 1024, logLevel: 'fatal',
  security: { csp: { enabled: false }, trustedProxy: { cidrs: [`${AGENT_HOST_TRUSTED_CADDY_PEER}/32`], hops: 1 } },
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: { secret: 's'.repeat(64), url: 'http://localhost', sessionTtlSeconds: 3600, sessionCookieSecure: false },
  features: { githubOauth: false, googleOauth: false, invitesEnabled: false, sendWelcomeEmail: false, inviteTtlDays: 7 },
} satisfies CoreConfig

function collection(ready = true): AgentHostActiveCollection {
  const binding = { bindingId: 'z-binding', hostname: HOST, workspaceId: 'workspace:z', defaultDeploymentId: 'deployment:z' }
  return {
    active: { schemaVersion: 1, revisionId: 'r0000000042', desiredStateDigest: DIGEST },
    desired: { plan: { bindings: [binding, { ...binding, bindingId: 'a-binding', hostname: 'other.example.test' }] } },
    observation: { bindings: [{ bindingId: 'a-binding', ready: true }, { bindingId: 'z-binding', ready }] },
  } as unknown as AgentHostActiveCollection
}

function reader(value: AgentHostActiveCollection | null, rejects = false): AgentHostActiveCollectionReader {
  return { async read() { if (rejects) throw new Error('/private/revision'); return value } }
}

let app: Awaited<ReturnType<typeof createCoreApp>> | undefined
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks() })

async function build(activeReader: AgentHostActiveCollectionReader) {
  app = await createCoreApp(CONFIG, {
    manageShutdown: false,
    requestScopeResolver: createAgentHostSurfaceResolver({ activeReader, trustedPeer: AGENT_HOST_TRUSTED_CADDY_PEER }),
  })
  app.get('/health', async () => ({ ok: true }))
  registerAgentHostReadinessRoute(app, { activeReader })
  await app.ready()
  return app
}

describe('AgentHost readiness and activation wiring', () => {
  it('keeps literal-IPv4 health available before publication while readiness is redacted', async () => {
    const instance = await build(reader(null))
    expect((await instance.inject({ method: 'GET', url: '/health', remoteAddress: '127.0.0.1' })).body).toBe('{"ok":true}')
    const response = await instance.inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '127.0.0.1' })
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      error: AgentHostErrorCode.COLLECTION_NOT_READY, code: AgentHostErrorCode.COLLECTION_NOT_READY,
      message: AgentHostErrorCode.COLLECTION_NOT_READY, requestId: expect.any(String),
    })
  })

  it('returns only the sorted ready collection projection and rechecks local scope', async () => {
    const instance = await build(reader(collection()))
    const response = await instance.inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '127.0.0.1' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      schemaVersion: 1, activeRevision: 'r0000000042', desiredStateDigest: DIGEST,
      bindings: [{ bindingId: 'a-binding', ready: true }, { bindingId: 'z-binding', ready: true }],
    })
    const remote = await instance.inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '198.51.100.7', headers: { host: HOST } })
    expect(remote.statusCode).toBe(421)
    expect(remote.json()).toMatchObject({ code: AgentHostErrorCode.HOST_SCOPE_VIOLATION, requestId: expect.any(String) })

    await instance.close(); app = Fastify(); app.decorateRequest('requestScope')
    app.addHook('onRequest', async (request) => { request.requestScope = {} as never })
    registerAgentHostReadinessRoute(app, { activeReader: reader(collection()) }); await app.ready()
    const independentlyRejected = await app.inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '127.0.0.1' })
    expect(independentlyRejected.statusCode).toBe(421)
    expect(independentlyRejected.json()).toMatchObject({ code: AgentHostErrorCode.HOST_SCOPE_VIOLATION, requestId: expect.any(String) })
  })

  it.each([[null, false], [collection(), true], [collection(false), false]] as const)(
    'fails closed on absent, corrupt, or incomplete state', async (value, rejects) => {
      const response = await (await build(reader(value, rejects))).inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '127.0.0.1' })
      expect(response.statusCode).toBe(503)
      expect(response.body).not.toMatch(/private|workspace|deployment|revision/)
    },
  )

  it('constructs exact AgentHost wiring early and leaves generic mode untouched', async () => {
    const euid = vi.spyOn(process, 'geteuid').mockReturnValue(10001)
    vi.spyOn(process, 'getegid').mockReturnValue(10001)
    expect(createAgentHostServerWiring(CONFIG, {})).toBeUndefined()
    expect(euid).not.toHaveBeenCalled()
    const wiring = createAgentHostServerWiring(CONFIG, { BORING_AGENT_HOST_ID: 'eu-host-1', BORING_AGENT_HOST_OWNER_UID: '0' })!
    expect(Object.isFrozen(wiring)).toBe(true)
    expect(Object.keys(wiring)).toEqual(['requestScopeResolver', 'frontendRootHandler', 'admitAgentEffect', 'resolveAgentRuntimeIdentity', 'resolveAgentRuntimeRecipe', 'registerReadiness'])
    const candidatePreloader = { prepare: vi.fn() } as never
    expect(createAgentHostServerWiring(CONFIG, { BORING_AGENT_HOST_ID: 'eu-host-1', BORING_AGENT_HOST_OWNER_UID: '0' }, { candidatePreloader })?.candidatePreloader).toBe(candidatePreloader)
    expect(createAgentHostServerWiring(CONFIG, { BORING_AGENT_HOST_ID: 'eu-host-1', BORING_AGENT_HOST_OWNER_UID: '4294967294' })).toBeDefined()

    const source = await readFile(new URL('../agentHostServerWiring.ts', import.meta.url), 'utf8')
    const main = await readFile(new URL('../../main.ts', import.meta.url), 'utf8')
    expect(source.match(/createAgentHostActiveCollectionReader\(/g)).toHaveLength(1)
    expect(source).toContain("path.join('/var/lib/boring/agent-host', hostId)")
    expect(source).not.toMatch(/BORING_AGENT_HOST_(?:STATE_ROOT|APP_GID|ROOT)/)
    expect(main.indexOf('createAgentHostServerWiring(config)')).toBeLessThan(main.indexOf('createFullAppHostPluginComposition(config)'))
    expect(main).toContain('admitEffect: agentHost.admitAgentEffect')
    expect(main).toContain('getRuntimeScopeContribution: async')
    expect(main.indexOf('agentHost?.registerReadiness(app)')).toBeLessThan(main.indexOf('registerFullAppBoringMcpRoutes(app)'))
    expect(main.indexOf('registerFullAppBoringMcpRoutes(app)')).toBeLessThan(main.indexOf('app.listen('))
  })

  it('routes every live consumer and the ledger reread through one served authority', async () => {
    vi.spyOn(process, 'geteuid').mockReturnValue(10001); vi.spyOn(process, 'getegid').mockReturnValue(10001)
    const binding = { bindingId: 'insurance', hostname: HOST, workspaceId: 'workspace:insurance', defaultDeploymentId: 'deployment:insurance',
      bundleRef: 'bundle', deploymentRef: 'deployment', workspaceAllocationRef: 'workspace', sessionAllocationRef: 'session',
      ownerPrincipalRef: 'owner', landing: { title: 'Insurance', summary: 'Compare policies.' }, environmentRef: 'production', secretRefs: [] }
    const current = { active: { schemaVersion: 1 as const, revisionId: 'r0000000042', desiredStateDigest: DIGEST },
      desired: { plan: { hostId: 'eu-host-1', bindings: [binding] }, resolvedBindings: [{ bindingId: binding.bindingId, resolvedDigest: DIGEST }] },
      observation: { bindings: [{ bindingId: binding.bindingId, ready: true }] } } as unknown as AgentHostActiveCollection
    const recipe = Object.freeze({ workspaceId: binding.workspaceId, defaultDeploymentId: binding.defaultDeploymentId,
      resolvedDigest: DIGEST, instructions: Object.freeze({ ref: 'instructions.md', content: 'trusted' }) })
    const read = vi.fn(async () => current); const readRecipe = vi.fn(async () => recipe)
    const authority = { read, readRecipe } as AgentHostServedCollectionAuthority
    const ledgerRead = vi.fn(async (source: AgentHostActiveCollectionReader) => { expect(source).toBe(authority); await source.read(); return {} as never })
    const wiring = createAgentHostServerWiring(CONFIG, { BORING_AGENT_HOST_ID: 'eu-host-1', BORING_AGENT_HOST_OWNER_UID: '0' },
      { servedCollection: authority, admissionLedger: { admit: ledgerRead } })!

    await wiring.requestScopeResolver({ raw: { rawHeaders: ['Host', HOST, 'X-Forwarded-Host', HOST, 'X-Forwarded-For', '198.51.100.7'],
      socket: { remoteAddress: AGENT_HOST_TRUSTED_CADDY_PEER }, method: 'GET', url: '/' }, ips: [AGENT_HOST_TRUSTED_CADDY_PEER, '198.51.100.7'] } as never)
    const reply = { status() { return this }, header() { return this }, type() { return this }, send() { return this } }
    await wiring.frontendRootHandler({ user: null, requestScope: { bindingId: binding.bindingId, workspaceId: binding.workspaceId,
      defaultDeploymentId: binding.defaultDeploymentId, activeRevision: current.active.revisionId, resolvedDigest: DIGEST } } as never, reply as never)
    await wiring.admitAgentEffect({ workspaceId: binding.workspaceId, requestId: 'request-1' })
    await expect(wiring.resolveAgentRuntimeIdentity(binding.workspaceId)).resolves.toMatchObject({ activeRevision: current.active.revisionId })
    await expect(wiring.resolveAgentRuntimeRecipe(binding.workspaceId)).resolves.toBe(recipe)
    const readiness = Fastify(); readiness.decorateRequest('requestScope'); wiring.registerReadiness(readiness); await readiness.ready()
    await expect(readiness.inject({ method: 'GET', url: '/internal/agent-host/readiness', remoteAddress: '127.0.0.1' })).resolves.toMatchObject({ statusCode: 200 })
    await readiness.close()
    expect(read).toHaveBeenCalledTimes(6); expect(readRecipe).toHaveBeenCalledOnce(); expect(ledgerRead).toHaveBeenCalledOnce()
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
    } as AgentHostActiveCollection)
    const admit = vi.fn(async () => ({}) as never)
    const admitEffect = createAgentHostAgentEffectAdmission({
      hostId: 'eu-host-1', activeReader, admissionLedger: { admit },
    })

    await admitEffect({ workspaceId: 'workspace:z', requestId: 'request-1' })
    expect(admit).toHaveBeenCalledWith(activeReader, {
      hostId: 'eu-host-1', bindingId: 'z-binding', workspaceId: 'workspace:z', defaultDeploymentId: 'deployment:z',
    })
    admit.mockRejectedValueOnce(new AgentHostError(AgentHostErrorCode.ADMISSION_IDENTITY_MISMATCH, { field: 'executionIdentityDigest' }))
    await expect(admitEffect({ workspaceId: 'workspace:z', requestId: 'identity-mismatch' })).rejects.toMatchObject({
      code: AgentHostErrorCode.ADMISSION_IDENTITY_MISMATCH,
      details: { field: 'executionIdentityDigest' },
    })
    await expect(createAgentHostAgentEffectAdmission({ hostId: 'eu-host-1', activeReader })({
      workspaceId: 'workspace:z', requestId: 'request-2',
    })).rejects.toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED, details: { field: 'admission' } })
    const duplicateReader = reader({
      ...current,
      desired: { ...current.desired, plan: { ...current.desired.plan, hostId: 'eu-host-1' } },
    } as AgentHostActiveCollection)
    await expect(createAgentHostAgentEffectAdmission({
      hostId: 'eu-host-1', activeReader: duplicateReader, admissionLedger: { admit },
    })({ workspaceId: 'workspace:z', requestId: 'request-3' }))
      .rejects.toMatchObject({ code: AgentHostErrorCode.ADMISSION_RECORD_FAILED })
    expect(admit).toHaveBeenCalledTimes(2)
  })

  it('rejects noncanonical owner, identity, and proxy inputs with field-only errors', () => {
    const euid = vi.spyOn(process, 'geteuid').mockReturnValue(10001)
    const egid = vi.spyOn(process, 'getegid').mockReturnValue(10001)
    const env = { BORING_AGENT_HOST_ID: 'eu-host-1', BORING_AGENT_HOST_OWNER_UID: '0' }
    const invalid = (change: Record<string, string | undefined>, field: string, config: CoreConfig = CONFIG) => {
      expect(() => createAgentHostServerWiring(config, { ...env, ...change })).toThrow(expect.objectContaining({ details: { field } }))
    }
    for (const owner of [undefined, '00', '+1', '10001', '1.0', ' 1', '4294967295', '9007199254740991']) {
      invalid({ BORING_AGENT_HOST_OWNER_UID: owner }, 'ownerUid')
    }
    invalid({ BORING_AGENT_HOST_ID: '../host' }, 'hostId')
    expect(() => createAgentHostServerWiring({ ...CONFIG, security: { ...CONFIG.security, trustedProxy: null } }, env))
      .toThrow(expect.objectContaining({ details: { field: 'trustedProxy' } }))
    euid.mockReturnValue(0); invalid({}, 'processUid')
    euid.mockReturnValue(10001); egid.mockReturnValue(0); invalid({}, 'processGid')
  })
})
