import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerInviteRoutes } from '../invites'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { IdempotencyKeyStore } from '../../middleware/idempotency'
import type { MemberRole, Workspace, WorkspaceInvite } from '../../../shared/types'

const sendMail = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../mail/transport', () => ({ createMailTransport: () => ({ send: sendMail }) }))

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const WS_ID = 'ws-idem-001'
const APP_ID = 'test-app'

type StoredEntry = {
  requestHash: string
  responseStatus: number | null
  responseBody: unknown
  scope: string
  createdAt: Date
}

function createInMemoryIdempotencyStore() {
  const entries = new Map<string, StoredEntry>()
  const store: IdempotencyKeyStore & { entries: typeof entries } = {
    entries,
    async sweep() {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const [key, entry] of entries) {
        if (entry.responseStatus !== null && entry.createdAt.getTime() < cutoff) entries.delete(key)
      }
    },
    async find(key) {
      const entry = entries.get(key)
      return entry && entry.responseStatus !== null
        ? { responseStatus: entry.responseStatus, responseBody: entry.responseBody }
        : null
    },
    async claim(key, scope, requestHash) {
      const entry = entries.get(key)
      if (!entry) {
        entries.set(key, { scope, requestHash, responseStatus: null, responseBody: null, createdAt: new Date() })
        return { status: 'claimed' }
      }
      if (entry.requestHash !== requestHash || entry.scope !== scope) return { status: 'conflict' }
      return entry.responseStatus === null ? { status: 'pending' } : {
        status: 'replay',
        entry: { responseStatus: entry.responseStatus, responseBody: entry.responseBody },
      }
    },
    async set(key, scope, status, body) {
      const entry = entries.get(key)
      if (!entry || (entry.scope === scope && entry.responseStatus === null)) {
        entries.set(key, { scope, requestHash: '', ...entry, responseStatus: status, responseBody: body, createdAt: new Date() })
      }
    },
  }
  return store
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const memberDb = new Map<string, Map<string, MemberRole>>()
const workspaces = new Map<string, Workspace>()
const inviteDb = new Map<string, WorkspaceInvite>()
let nextInviteId = 1
let createInviteCallCount = 0
let beforeCreateInvite: (() => Promise<void>) | undefined

function resetState() {
  nextInviteId = 1
  createInviteCallCount = 0
  beforeCreateInvite = undefined
  sendMail.mockClear()
  memberDb.clear()
  workspaces.clear()
  inviteDb.clear()

  workspaces.set(WS_ID, {
    id: WS_ID,
    appId: APP_ID,
    workspaceTypeId: 'default',
    name: 'Test WS',
    createdBy: OWNER_ID,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    isDefault: false,
  })

  const wsMembers = new Map<string, MemberRole>()
  wsMembers.set(OWNER_ID, 'owner')
  memberDb.set(WS_ID, wsMembers)
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    getMemberRole: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.get(userId) ?? null,
    isMember: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.has(userId) ?? false,
    get: async (id: string) => workspaces.get(id) ?? null,
    listInvites: async (wsId: string) =>
      [...inviteDb.values()].filter((i) => i.workspaceId === wsId),
    createInvite: async (wsId: string, email: string, role: MemberRole, invitedBy: string | null) => {
      createInviteCallCount++
      await beforeCreateInvite?.()
      const id = `inv-${nextInviteId++}`
      const rawToken = `raw-token-${id}`
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      const invite: WorkspaceInvite = {
        id,
        workspaceId: wsId,
        email,
        tokenHash,
        role,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        acceptedAt: null,
        createdBy: invitedBy,
        createdAt: new Date().toISOString(),
        failedAttempts: 0,
        lockedUntil: null,
      }
      inviteDb.set(id, invite)
      return { invite, rawToken }
    },
  } as unknown as WorkspaceStore
}

let app: FastifyInstance
let idempotencyStore: ReturnType<typeof createInMemoryIdempotencyStore>

async function createApp(store: IdempotencyKeyStore, appId = APP_ID) {
  const app = Fastify({ logger: false })
  app.decorate('config', {
    appId,
    appName: 'Test app',
    auth: { url: 'http://localhost:3000', mail: { transportUrl: 'console://', from: 'test@test.dev' } },
    features: { inviteTtlDays: 7 },
  } as any)
  app.decorate('workspaceStore', mockWorkspaceStore())
  registerErrorHandler(app)

  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user'] as string | undefined
    if (userId) {
      request.user = { id: userId, email: `${userId}@test.dev`, name: null, emailVerified: true }
    } else {
      request.user = null
    }
  })

  await app.register(registerInviteRoutes, { idempotencyStore: store })
  await app.ready()
  return app
}

beforeAll(async () => {
  idempotencyStore = createInMemoryIdempotencyStore()
  app = await createApp(idempotencyStore)
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetState()
  idempotencyStore.entries.clear()
})

function inject(
  method: string,
  url: string,
  opts?: { userId?: string; payload?: unknown; headers?: Record<string, string> },
) {
  const req: any = { method, url, headers: {} }
  if (opts?.userId) req.headers['x-test-user'] = opts.userId
  if (opts?.headers) Object.assign(req.headers, opts.headers)
  if (opts?.payload !== undefined) req.payload = opts.payload
  return app.inject(req)
}

const INVITE_URL = `/api/v1/workspaces/${WS_ID}/invites`
const INVITE_BODY = { email: 'new@test.dev', role: 'editor' }

describe('Idempotency-Key middleware on POST /invites', () => {
  it('first call stores key and returns response', async () => {
    const res = await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
      headers: { 'idempotency-key': 'key-001' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.invite).toBeDefined()
    expect(body.invite.email).toBe('new@test.dev')
    expect(createInviteCallCount).toBe(1)

    expect(idempotencyStore.entries.size).toBe(1)
    const stored = [...idempotencyStore.entries.values()][0]
    expect(stored.responseStatus).toBe(201)
  })

  it('second call with same key returns cached response without re-running handler', async () => {
    const res1 = await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
      headers: { 'idempotency-key': 'key-replay' },
    })
    expect(res1.statusCode).toBe(201)
    expect(createInviteCallCount).toBe(1)

    const res2 = await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
      headers: { 'idempotency-key': 'key-replay' },
    })
    expect(res2.statusCode).toBe(201)
    expect(res2.json()).toEqual(res1.json())
    expect(createInviteCallCount).toBe(1)
  })

  it('different key is a cache miss and runs handler again', async () => {
    await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
      headers: { 'idempotency-key': 'key-a' },
    })
    expect(createInviteCallCount).toBe(1)

    const res2 = await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: { email: 'other@test.dev', role: 'viewer' },
      headers: { 'idempotency-key': 'key-b' },
    })
    expect(res2.statusCode).toBe(201)
    expect(createInviteCallCount).toBe(2)
    expect(res2.json().invite.email).toBe('other@test.dev')
  })

  it('reserves a same-key request before invite creation and mail, across two app instances', async () => {
    const entered = deferred()
    const release = deferred()
    beforeCreateInvite = async () => {
      if (createInviteCallCount === 1) { entered.resolve(); await release.promise }
    }
    const otherApp = await createApp(idempotencyStore)
    const request = { method: 'POST' as const, url: INVITE_URL, payload: INVITE_BODY,
      headers: { 'x-test-user': OWNER_ID, 'idempotency-key': 'key-race' } }
    const first = app.inject(request)
    // inject() is thenable: start the request before waiting for the barrier.
    const firstResponse = Promise.resolve(first)
    try {
      await entered.promise
      const overlap = await otherApp.inject(request)
      expect(overlap.statusCode).toBe(409)
      expect(overlap.json().code).toBe('idempotency_in_progress')
      expect(createInviteCallCount).toBe(1)
      expect(sendMail).not.toHaveBeenCalled()
      release.resolve()
      const completed = await firstResponse
      expect(completed.statusCode).toBe(201)
      expect(inviteDb.size).toBe(1)
      expect(sendMail).toHaveBeenCalledTimes(1)
      const replay = await otherApp.inject(request)
      expect(replay.statusCode).toBe(201)
      expect(replay.json()).toEqual(completed.json())
      expect(createInviteCallCount).toBe(1)
      expect(sendMail).toHaveBeenCalledTimes(1)
    } finally {
      release.resolve()
      await firstResponse
      await otherApp.close()
    }
  })

  it('isolates the same key by workspace, actor, and application', async () => {
    const headers = { 'idempotency-key': 'shared-key' }
    const first = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    const otherWorkspace = { ...workspaces.get(WS_ID)!, id: 'other-ws' }
    workspaces.set(otherWorkspace.id, otherWorkspace)
    memberDb.set(otherWorkspace.id, new Map([[OWNER_ID, 'owner']]))
    const second = await inject('POST', `/api/v1/workspaces/${otherWorkspace.id}/invites`, {
      userId: OWNER_ID, payload: INVITE_BODY, headers,
    })
    expect(second.statusCode).toBe(201)
    expect(second.json().invite.workspaceId).toBe(otherWorkspace.id)
    expect(second.json().invite.id).not.toBe(first.json().invite.id)

    const otherOwner = '00000000-0000-0000-0000-000000000002'
    memberDb.get(WS_ID)!.set(otherOwner, 'owner')
    const third = await inject('POST', INVITE_URL, { userId: otherOwner, payload: INVITE_BODY, headers })
    expect(third.statusCode).toBe(201)
    expect(third.json().invite.createdBy).toBe(otherOwner)
    expect(third.json().invite.id).not.toBe(first.json().invite.id)

    // A shared persistence adapter must not join requests from separate apps.
    workspaces.get(WS_ID)!.appId = 'other-app'
    const otherApp = await createApp(idempotencyStore, 'other-app')
    try {
      const fourth = await otherApp.inject({ method: 'POST', url: INVITE_URL, payload: INVITE_BODY,
        headers: { ...headers, 'x-test-user': OWNER_ID } })
      expect(fourth.statusCode).toBe(201)
      expect(fourth.json().invite.id).not.toBe(first.json().invite.id)
      expect(createInviteCallCount).toBe(4)
      expect(sendMail).toHaveBeenCalledTimes(4)
    } finally {
      await otherApp.close()
    }
  })

  it('rejects a reused key with a different payload and accepts reordered JSON members', async () => {
    const headers = { 'idempotency-key': 'key-conflict' }
    const first = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    for (const payload of [{ ...INVITE_BODY, email: 'other@test.dev' }, { ...INVITE_BODY, role: 'viewer' }]) {
      const conflict = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload, headers })
      expect(conflict.statusCode).toBe(409)
      expect(conflict.json().code).toBe('idempotency_key_conflict')
    }
    const replay = await inject('POST', INVITE_URL, {
      userId: OWNER_ID, payload: { role: 'editor', email: 'new@test.dev' }, headers,
    })
    expect(replay.json()).toEqual(first.json())
    expect(createInviteCallCount).toBe(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('validates before claiming and reauthorizes before replaying a cached response', async () => {
    const headers = { 'idempotency-key': 'key-validation' }
    const invalid = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: { email: 'bad' }, headers })
    expect(invalid.statusCode).toBe(400)
    expect(idempotencyStore.entries.size).toBe(0)
    const valid = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    expect(valid.statusCode).toBe(201)
    memberDb.get(WS_ID)!.set(OWNER_ID, 'viewer')
    const forbidden = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    expect(forbidden.statusCode).toBe(403)
    expect(createInviteCallCount).toBe(1)
  })

  it('retains an unresolved claim if capturing the response fails, even past the replay TTL', async () => {
    const set = vi.spyOn(idempotencyStore, 'set').mockRejectedValueOnce(new Error('database write failed'))
    const headers = { 'idempotency-key': 'unknown-outcome' }
    try {
      const failed = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
      expect(failed.statusCode).toBe(500)
      expect(set).toHaveBeenCalledTimes(1)
      expect(createInviteCallCount).toBe(1)
      expect(sendMail).toHaveBeenCalledTimes(1)
      for (const entry of idempotencyStore.entries.values()) {
        entry.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
      }
      const retry = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
      expect(retry.statusCode).toBe(409)
      expect(retry.json().code).toBe('idempotency_in_progress')
      expect(createInviteCallCount).toBe(1)
      expect(sendMail).toHaveBeenCalledTimes(1)
    } finally {
      set.mockRestore()
    }
  })

  it('blocks a live legacy receipt without replaying metadata or repeating effects', async () => {
    const legacyBody = { invite: { id: 'legacy-invite', workspaceId: 'other-tenant' } }
    idempotencyStore.entries.set('invites:legacy-key', {
      scope: 'invites', requestHash: '', responseStatus: 201, responseBody: legacyBody, createdAt: new Date(),
    })
    const response = await inject('POST', INVITE_URL, {
      userId: OWNER_ID, payload: INVITE_BODY, headers: { 'idempotency-key': 'legacy-key' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('idempotency_key_conflict')
    expect(response.json().invite).toBeUndefined()
    expect(response.body).not.toContain('other-tenant')
    expect(createInviteCallCount).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
    expect(idempotencyStore.entries.size).toBe(1)
  })

  it('permits a new scoped claim after a legacy receipt expires', async () => {
    idempotencyStore.entries.set('invites:expired-legacy-key', {
      scope: 'invites', requestHash: '', responseStatus: 201, responseBody: { old: true },
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })
    const response = await inject('POST', INVITE_URL, {
      userId: OWNER_ID, payload: INVITE_BODY, headers: { 'idempotency-key': 'expired-legacy-key' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().invite.workspaceId).toBe(WS_ID)
    expect(createInviteCallCount).toBe(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(idempotencyStore.entries.has('invites:expired-legacy-key')).toBe(false)
  })

  it('expires completed responses after the 24-hour replay window', async () => {
    const headers = { 'idempotency-key': 'expired' }
    const first = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    for (const entry of idempotencyStore.entries.values()) {
      entry.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    }
    const second = await inject('POST', INVITE_URL, { userId: OWNER_ID, payload: INVITE_BODY, headers })
    expect(second.statusCode).toBe(201)
    expect(second.json().invite.id).not.toBe(first.json().invite.id)
    expect(createInviteCallCount).toBe(2)
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('no header: middleware passes through and handler runs normally', async () => {
    const res = await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
    })

    expect(res.statusCode).toBe(201)
    expect(createInviteCallCount).toBe(1)
    expect(idempotencyStore.entries.size).toBe(0)
  })
})
