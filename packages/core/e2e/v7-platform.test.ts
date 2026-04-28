import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { LocalUserStore } from '../src/server/db/stores/LocalUserStore'
import { LocalWorkspaceStore } from '../src/server/db/stores/LocalWorkspaceStore'
import { registerErrorHandler } from '../src/server/app/errorHandler'
import { registerWorkspaceRoutes } from '../src/server/routes/workspaces'
import { registerInviteRoutes } from '../src/server/routes/invites'
import { registerMemberRoutes } from '../src/server/routes/members'
import { registerSettingsRoutes } from '../src/server/routes/settings'
import type { WorkspaceProvisioner } from '../src/server/provisioner/types'
import type { IdempotencyKeyStore } from '../src/server/middleware/idempotency'

// ---------------------------------------------------------------------------
// In-memory idempotency store
// ---------------------------------------------------------------------------
function createInMemoryIdempotencyStore(): IdempotencyKeyStore {
  const entries = new Map<string, { responseStatus: number; responseBody: unknown; scope: string; createdAt: Date }>()
  return {
    async sweep() { /* noop for tests */ },
    async find(key: string) {
      const entry = entries.get(key)
      return entry ? { responseStatus: entry.responseStatus, responseBody: entry.responseBody } : null
    },
    async set(key: string, scope: string, status: number, body: unknown) {
      if (entries.has(key)) return
      entries.set(key, { responseStatus: status, responseBody: body, scope, createdAt: new Date() })
    },
  }
}

// ---------------------------------------------------------------------------
// Inject helper
// ---------------------------------------------------------------------------
function createInjector(app: FastifyInstance) {
  return function inject(
    method: string,
    url: string,
    userId?: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ) {
    const req: any = { method, url, headers: {} }
    if (userId) req.headers['x-test-user'] = userId
    if (payload !== undefined) {
      req.payload = payload
      req.headers['content-type'] = 'application/json'
    }
    if (headers) Object.assign(req.headers, headers)
    return app.inject(req)
  }
}

// ===========================================================================
// Scenario A — Happy Path
// ===========================================================================
describe('v7 platform E2E', () => {
  describe('Scenario A: Happy Path', () => {
    let app: FastifyInstance
    let inject: ReturnType<typeof createInjector>
    const provisionFn = vi.fn<WorkspaceProvisioner['provision']>()
    const destroyFn = vi.fn<WorkspaceProvisioner['destroy']>()

    let workspaceId: string
    let rawToken: string
    let inviteId: string

    beforeAll(async () => {
      const userStore = new LocalUserStore()
      const workspaceStore = new LocalWorkspaceStore(userStore)
      const idempotencyStore = createInMemoryIdempotencyStore()

      // Seed alice and bob
      userStore.seed({ id: 'alice', email: 'alice@test.dev', name: 'Alice', emailVerified: true, image: null })
      userStore.seed({ id: 'bob', email: 'bob@test.dev', name: 'Bob', emailVerified: true, image: null })

      provisionFn.mockResolvedValue({ volumePath: '/volumes/acme' })
      destroyFn.mockResolvedValue(undefined)

      const provisioner: WorkspaceProvisioner = {
        provision: provisionFn,
        destroy: destroyFn,
      }

      app = Fastify({ logger: false })
      app.decorate('config', { appId: 'test-app', auth: { mail: null, url: 'http://localhost:3000' }, features: { inviteTtlDays: 7 } } as any)
      app.decorate('workspaceStore', workspaceStore)
      app.decorate('provisioner', provisioner)
      registerErrorHandler(app)

      app.addHook('onRequest', async (request) => {
        const userId = request.headers['x-test-user'] as string | undefined
        if (userId) {
          request.user = { id: userId, email: `${userId}@test.dev`, name: null }
        } else {
          request.user = null
        }
      })

      await app.register(registerWorkspaceRoutes)
      await app.register(registerInviteRoutes, { idempotencyStore })
      await app.register(registerMemberRoutes)
      await app.register(registerSettingsRoutes)
      await app.ready()

      inject = createInjector(app)
    })

    afterAll(async () => {
      await app.close()
    })

    // 1 + 2. Alice creates workspace "Acme"
    it('Alice creates workspace "Acme" → 201, provisioner called, runtime ready', async () => {
      const res = await inject('POST', '/api/v1/workspaces', 'alice', { name: 'Acme' })
      expect(res.statusCode).toBe(201)

      const body = res.json()
      expect(body.workspace.name).toBe('Acme')
      expect(body.role).toBe('owner')
      workspaceId = body.workspace.id

      expect(provisionFn).toHaveBeenCalledOnce()
      expect(provisionFn).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId,
        workspaceName: 'Acme',
        ownerId: 'alice',
        appId: 'test-app',
      }))

      // Verify runtime is ready
      const rtRes = await inject('GET', `/api/v1/workspaces/${workspaceId}/runtime`, 'alice')
      expect(rtRes.statusCode).toBe(200)
      expect(rtRes.json().runtime.state).toBe('ready')
      expect(rtRes.json().runtime.volumePath).toBe('/volumes/acme')
    })

    // 3. Alice creates invite for bob@test.dev as editor with Idempotency-Key
    it('Alice creates invite for bob as editor (with Idempotency-Key)', async () => {
      const res = await inject(
        'POST',
        `/api/v1/workspaces/${workspaceId}/invites`,
        'alice',
        { email: 'bob@test.dev', role: 'editor' },
        { 'idempotency-key': 'invite-bob-1' },
      )
      expect(res.statusCode).toBe(201)

      const body = res.json()
      expect(body.invite.email).toBe('bob@test.dev')
      expect(body.invite.role).toBe('editor')
      expect(body.invite.workspaceId).toBe(workspaceId)

      // Capture invite details for later steps.
      // The rawToken is NOT in the response body (it was only returned to the server).
      // We need to get it via the store directly. But since the route doesn't expose rawToken,
      // we'll use the resolve endpoint with the raw token. For a real test we'd get it
      // from the store. Let's rely on the fact that LocalWorkspaceStore keeps invites.
      inviteId = body.invite.id

      // The rawToken is returned in the response body when mail is disabled (warning: mail_disabled)
      // Actually, looking at the route code: it doesn't return rawToken in response.
      // We need to get it from the store's createInvite call or from the store directly.
      // Since we don't have direct access to the invite's rawToken from the HTTP response,
      // we'll need to work around this. Let me check the invite route more carefully...
      // The invite route returns { invite, warning: 'mail_disabled' } but invite has no rawToken.
      // For the E2E to work, we need the rawToken. Since the store returns it internally,
      // we can access the store directly in this test setup.
    })

    // 4. Alice's second POST with SAME Idempotency-Key returns cached response
    it('second POST with same Idempotency-Key returns cached response (no duplicate)', async () => {
      const res = await inject(
        'POST',
        `/api/v1/workspaces/${workspaceId}/invites`,
        'alice',
        { email: 'bob@test.dev', role: 'editor' },
        { 'idempotency-key': 'invite-bob-1' },
      )
      // Should get back the cached response with 201 status
      expect(res.statusCode).toBe(201)

      const body = res.json()
      // The invite id should match the original (cached)
      expect(body.invite.id).toBe(inviteId)
    })

    // 5. Bob resolves invite — we need the rawToken.
    // Since the HTTP API doesn't expose rawToken, we'll create a second invite directly
    // for the resolve + accept flow. Actually let's re-approach: we intercept createInvite.
    // Better approach: create a fresh invite without idempotency, and capture rawToken
    // by spying on the store.
    it('Bob resolves invite and accepts it', async () => {
      // Create a second invite for bob that we can track the rawToken for
      // We'll spy on the workspaceStore.createInvite to capture the rawToken
      const store = app.workspaceStore
      let capturedToken: string | undefined

      const origCreateInvite = store.createInvite.bind(store)
      store.createInvite = async (...args: Parameters<typeof store.createInvite>) => {
        const result = await origCreateInvite(...args)
        capturedToken = result.rawToken
        return result
      }

      // Revoke the old invite first (so bob@test.dev can be re-invited)
      await inject('DELETE', `/api/v1/workspaces/${workspaceId}/invites/${inviteId}`, 'alice')

      const invRes = await inject(
        'POST',
        `/api/v1/workspaces/${workspaceId}/invites`,
        'alice',
        { email: 'bob@test.dev', role: 'editor' },
      )
      expect(invRes.statusCode).toBe(201)
      inviteId = invRes.json().invite.id

      // Restore original
      store.createInvite = origCreateInvite

      expect(capturedToken).toBeDefined()
      rawToken = capturedToken!

      // Step 5: Bob resolves invite
      const resolveRes = await inject('POST', '/api/v1/invites/resolve', 'bob', { token: rawToken })
      expect(resolveRes.statusCode).toBe(200)
      const resolveBody = resolveRes.json()
      expect(resolveBody.workspaceName).toBe('Acme')
      expect(resolveBody.role).toBe('editor')

      // Step 6: Bob accepts invite
      const acceptRes = await inject('POST', '/api/v1/invites/accept', 'bob', { token: rawToken })
      expect(acceptRes.statusCode).toBe(200)
      const acceptBody = acceptRes.json()
      expect(acceptBody.member.role).toBe('editor')
      expect(acceptBody.workspace.id).toBe(workspaceId)
    })

    // 7. Alice lists members → alice(owner) + bob(editor)
    it('Alice lists members → alice(owner) + bob(editor)', async () => {
      const res = await inject('GET', `/api/v1/workspaces/${workspaceId}/members`, 'alice')
      expect(res.statusCode).toBe(200)

      const body = res.json()
      expect(body.members).toHaveLength(2)

      const alice = body.members.find((m: any) => m.userId === 'alice')
      const bob = body.members.find((m: any) => m.userId === 'bob')
      expect(alice).toBeDefined()
      expect(alice.role).toBe('owner')
      expect(bob).toBeDefined()
      expect(bob.role).toBe('editor')
    })

    // 8. Alice promotes bob to owner
    it('Alice promotes bob to owner', async () => {
      const res = await inject(
        'PATCH',
        `/api/v1/workspaces/${workspaceId}/members/bob/role`,
        'alice',
        { role: 'owner' },
      )
      expect(res.statusCode).toBe(200)
      expect(res.json().member.role).toBe('owner')
    })

    // 9. Bob demotes alice to editor (bob is now owner, so this should succeed)
    it('Bob demotes alice to editor', async () => {
      const res = await inject(
        'PATCH',
        `/api/v1/workspaces/${workspaceId}/members/alice/role`,
        'bob',
        { role: 'editor' },
      )
      expect(res.statusCode).toBe(200)
      expect(res.json().member.role).toBe('editor')
    })

    // 10. Bob tries to demote himself to editor → 409 LAST_OWNER
    it('Bob tries to demote himself to editor → 409 LAST_OWNER', async () => {
      const res = await inject(
        'PATCH',
        `/api/v1/workspaces/${workspaceId}/members/bob/role`,
        'bob',
        { role: 'editor' },
      )
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('last_owner')
    })

    // 11. Bob deletes workspace
    it('Bob deletes workspace', async () => {
      const res = await inject('DELETE', `/api/v1/workspaces/${workspaceId}`, 'bob')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ deleted: true })
      expect(destroyFn).toHaveBeenCalledWith(workspaceId)
    })
  })

  // =========================================================================
  // Scenario B — Failure Paths
  // =========================================================================
  describe('Scenario B: Failure Paths', () => {
    let app: FastifyInstance
    let inject: ReturnType<typeof createInjector>
    const provisionFn = vi.fn<WorkspaceProvisioner['provision']>()
    const destroyFn = vi.fn<WorkspaceProvisioner['destroy']>()
    let workspaceStore: LocalWorkspaceStore

    let workspaceId: string

    beforeAll(async () => {
      const userStore = new LocalUserStore()
      workspaceStore = new LocalWorkspaceStore(userStore)

      userStore.seed({ id: 'alice', email: 'alice@test.dev', name: 'Alice', emailVerified: true, image: null })

      // 1. Provisioner throws ENOSPC on first call
      provisionFn.mockRejectedValue(new Error('ENOSPC: no space left on device'))
      destroyFn.mockResolvedValue(undefined)

      const provisioner: WorkspaceProvisioner = {
        provision: provisionFn,
        destroy: destroyFn,
      }

      app = Fastify({ logger: false })
      app.decorate('config', { appId: 'test-app', auth: { mail: null, url: 'http://localhost:3000' }, features: { inviteTtlDays: 7 } } as any)
      app.decorate('workspaceStore', workspaceStore)
      app.decorate('provisioner', provisioner)
      registerErrorHandler(app)

      app.addHook('onRequest', async (request) => {
        const userId = request.headers['x-test-user'] as string | undefined
        if (userId) {
          request.user = { id: userId, email: `${userId}@test.dev`, name: null }
        } else {
          request.user = null
        }
      })

      await app.register(registerWorkspaceRoutes)
      await app.register(registerInviteRoutes)
      await app.register(registerMemberRoutes)
      await app.register(registerSettingsRoutes)
      await app.ready()

      inject = createInjector(app)
    })

    afterAll(async () => {
      await app.close()
    })

    // 2. Alice creates workspace → runtime in error state, HTTP 500
    it('Alice creates workspace → provision fails → 500 + runtime in error', async () => {
      const res = await inject('POST', '/api/v1/workspaces', 'alice', { name: 'FailWS' })
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('provision_failed')

      // The workspace was still created (stored) even though provisioning failed
      const listRes = await inject('GET', '/api/v1/workspaces', 'alice')
      const workspaces = listRes.json().workspaces
      expect(workspaces).toHaveLength(1)
      workspaceId = workspaces[0].id

      // Runtime should be in error state
      const rtRes = await inject('GET', `/api/v1/workspaces/${workspaceId}/runtime`, 'alice')
      expect(rtRes.statusCode).toBe(200)
      expect(rtRes.json().runtime.state).toBe('error')
      expect(rtRes.json().runtime.lastError).toBe('ENOSPC: no space left on device')
      expect(rtRes.json().runtime.lastErrorOp).toBe('provision')
    })

    // 3. Alice calls retry — mock still throws → still error
    it('Alice retries runtime → provisioner still fails → 500 + still error', async () => {
      // provisionFn still rejects
      const res = await inject('POST', `/api/v1/workspaces/${workspaceId}/runtime/retry`, 'alice')
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('provision_failed')

      // Runtime still in error
      const rtRes = await inject('GET', `/api/v1/workspaces/${workspaceId}/runtime`, 'alice')
      expect(rtRes.json().runtime.state).toBe('error')
    })

    // 4. Switch mock to succeed → retry → state=ready
    it('Alice retries runtime → provisioner succeeds → runtime ready', async () => {
      provisionFn.mockResolvedValue({ volumePath: '/volumes/recovered' })

      const res = await inject('POST', `/api/v1/workspaces/${workspaceId}/runtime/retry`, 'alice')
      expect(res.statusCode).toBe(200)
      expect(res.json().runtime.state).toBe('ready')
      expect(res.json().runtime.volumePath).toBe('/volumes/recovered')
    })

    // 5. Alice deletes workspace; mock destroy throws → runtime in error, HTTP 500
    it('Alice deletes workspace → destroy fails → 500 + runtime error', async () => {
      destroyFn.mockRejectedValue(new Error('destroy EBUSY'))

      const res = await inject('DELETE', `/api/v1/workspaces/${workspaceId}`, 'alice')
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('destroy_failed')

      // Workspace NOT deleted
      const getRes = await inject('GET', `/api/v1/workspaces/${workspaceId}`, 'alice')
      expect(getRes.statusCode).toBe(200)

      // Runtime in error
      const rtRes = await inject('GET', `/api/v1/workspaces/${workspaceId}/runtime`, 'alice')
      expect(rtRes.json().runtime.state).toBe('error')
      expect(rtRes.json().runtime.lastErrorOp).toBe('destroy')
    })

    // 6. Re-issue DELETE; mock succeeds → removed
    it('Alice re-issues DELETE → destroy succeeds → workspace removed', async () => {
      destroyFn.mockResolvedValue(undefined)

      const res = await inject('DELETE', `/api/v1/workspaces/${workspaceId}`, 'alice')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ deleted: true })
    })
  })
})
