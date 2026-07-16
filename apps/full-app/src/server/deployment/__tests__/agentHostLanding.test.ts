import { readFile } from 'node:fs/promises'

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentHostActiveCollection, AgentHostActiveCollectionReader } from '../activeCollectionReader.js'
import { createAgentHostLandingRootHandler } from '../agentHostLanding.js'
import { AgentHostErrorCode, type AgentHostSiteBindingV1 } from '../agentHostPlan.js'

const scope = Object.freeze({
  bindingId: 'insurance', workspaceId: 'workspace:insurance',
  defaultDeploymentId: 'deployment:insurance', activeRevision: 'r0000000042',
  resolvedDigest: `sha256:${'b'.repeat(64)}`,
})

function binding(landing: AgentHostSiteBindingV1['landing'] = { title: 'Insurance', summary: 'Compare policies.', ctaLabel: 'Start' }): AgentHostSiteBindingV1 {
  return {
    bindingId: scope.bindingId, hostname: 'insurance.example.test', workspaceId: scope.workspaceId,
    defaultDeploymentId: scope.defaultDeploymentId, bundleRef: 'bundle', deploymentRef: 'deployment',
    workspaceAllocationRef: 'workspace-allocation', sessionAllocationRef: 'session-allocation',
    ownerPrincipalRef: 'private-owner', landing, environmentRef: 'production', secretRefs: [],
  }
}

function collection(overrides: { revision?: string, bindings?: readonly AgentHostSiteBindingV1[] } = {}): AgentHostActiveCollection {
  return {
    active: { schemaVersion: 1, revisionId: overrides.revision ?? scope.activeRevision, desiredStateDigest: `sha256:${'a'.repeat(64)}` },
    desired: { plan: { bindings: overrides.bindings ?? [binding()] } },
  } as unknown as AgentHostActiveCollection
}

function reader(value: AgentHostActiveCollection | null = collection(), failure = false) {
  let calls = 0
  const activeReader: AgentHostActiveCollectionReader = { async read() { calls += 1; if (failure) throw new Error('/private/revision'); return value } }
  return { activeReader, calls: () => calls }
}

let app: FastifyInstance | undefined
afterEach(async () => { await app?.close(); app = undefined })

async function build(activeReader: AgentHostActiveCollectionReader, rejectHost = false): Promise<FastifyInstance> {
  const instance = Fastify()
  instance.decorateRequest('requestScope')
  instance.decorateRequest('user')
  instance.addHook('onRequest', async (request, reply) => {
    if (rejectHost) return reply.status(421).send({ code: AgentHostErrorCode.HOST_SCOPE_VIOLATION })
    request.requestScope = scope
    request.user = request.headers.authorization ? { id: 'user', email: 'user@example.test', name: null, emailVerified: true } : null
  })
  const root = createAgentHostLandingRootHandler({ activeReader })
  instance.get('/', async (request, reply) => {
    if (await root(request, reply)) return reply
    return reply.type('text/html; charset=utf-8').send('<!doctype html><p>spa shell</p>')
  })
  await instance.ready()
  return instance
}

describe('AgentHost landing root handler', () => {
  it('renders only escaped bounded landing text with a fixed same-origin sign-in target', async () => {
    const state = reader(collection({ bindings: [binding({
      title: `Policies & <quotes> " ' é`, summary: '<script>safe Unicode ø</script>', ctaLabel: 'Compare & go',
    })] }))
    app = await build(state.activeReader)
    const response = await app.inject({ method: 'GET', url: '/?redirect=https://evil.example', headers: { host: 'insurance.example.test' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(response.body).toContain('Policies &amp; &lt;quotes&gt; &quot; &#39; é')
    expect(response.body).toContain('&lt;script&gt;safe Unicode ø&lt;/script&gt;')
    expect(response.body).toContain('<a href="/auth/signin?redirect=%2F">Compare &amp; go</a>')
    expect(response.body).not.toContain('evil.example')
    expect(response.body).not.toMatch(/<script|style=|private-owner|workspace:insurance|deployment:insurance/)
    expect(state.calls()).toBe(1)
  })

  it('declines authenticated roots to the existing SPA without reading publication state', async () => {
    const state = reader()
    app = await build(state.activeReader)
    const response = await app.inject({ method: 'GET', url: '/', headers: { authorization: 'session' } })
    expect(response.body).toBe('<!doctype html><p>spa shell</p>')
    expect(state.calls()).toBe(0)
  })

  it('uses the server-owned CTA default and accepts the exact landing text bounds', async () => {
    const state = reader(collection({ bindings: [binding({ title: 'T'.repeat(120), summary: 'S'.repeat(500), ctaLabel: 'C'.repeat(80) })] }))
    app = await build(state.activeReader)
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain(`<a href="/auth/signin?redirect=%2F">${'C'.repeat(80)}</a>`)
    await app.close(); app = await build(reader(collection({ bindings: [binding({ title: 'Title', summary: 'Summary' })] })).activeReader)
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('<a href="/auth/signin?redirect=%2F">Sign in</a>')
  })

  it.each([
    ['title over limit', { title: 'T'.repeat(121), summary: 'Summary' }],
    ['summary over limit', { title: 'Title', summary: 'S'.repeat(501) }],
    ['CTA over limit', { title: 'Title', summary: 'Summary', ctaLabel: 'C'.repeat(81) }],
    ['title control character', { title: 'Bad\nTitle', summary: 'Summary' }],
    ['summary control character', { title: 'Title', summary: 'Bad\u0000Summary' }],
    ['CTA control character', { title: 'Title', summary: 'Summary', ctaLabel: 'Bad\tCTA' }],
  ])('rejects %s even when a caller bypasses the validated reader', async (_name, landing) => {
    app = await build(reader(collection({ bindings: [binding(landing)] })).activeReader)
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error: AgentHostErrorCode.COLLECTION_NOT_READY,
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      message: AgentHostErrorCode.COLLECTION_NOT_READY,
    })
  })

  it.each([
    ['missing collection', null, false],
    ['read failure', collection(), true],
    ['revision drift', collection({ revision: 'r0000000043' }), false],
    ['binding drift', collection({ bindings: [{ ...binding(), bindingId: 'other' }] }), false],
    ['workspace drift', collection({ bindings: [{ ...binding(), workspaceId: 'workspace:other' }] }), false],
    ['deployment drift', collection({ bindings: [{ ...binding(), defaultDeploymentId: 'deployment:other' }] }), false],
    ['duplicate binding', collection({ bindings: [binding(), binding()] }), false],
  ])('fails closed and redacted on %s', async (_name, value, failure) => {
    app = await build(reader(value, failure).activeReader)
    const response = await app.inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      error: AgentHostErrorCode.COLLECTION_NOT_READY,
      code: AgentHostErrorCode.COLLECTION_NOT_READY,
      message: AgentHostErrorCode.COLLECTION_NOT_READY,
    })
    expect(response.body).not.toMatch(/insurance|workspace|deployment|private|revision/)
  })

  it('is not invoked when an earlier host-scope hook rejects the request', async () => {
    const state = reader()
    app = await build(state.activeReader, true)
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(421)
    expect(state.calls()).toBe(0)
  })

  it('contains no workspace, membership, request URL, or internal-id lookup', async () => {
    const source = await readFile(new URL('../agentHostLanding.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/workspaceStore|isMember|membership|request\.url|request\.headers|ownerPrincipalRef/)
  })
})
