import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerInviteRoutes } from '../invites'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { IdempotencyKeyStore, IdempotencyEntry } from '../../middleware/idempotency'
import type { MemberRole, Workspace, WorkspaceInvite } from '../../../shared/types'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const WS_ID = 'ws-idem-001'
const APP_ID = 'test-app'

function createInMemoryIdempotencyStore(): IdempotencyKeyStore & {
  entries: Map<string, IdempotencyEntry & { scope: string; createdAt: Date }>
  sweepTtlMs: number
} {
  const entries = new Map<string, IdempotencyEntry & { scope: string; createdAt: Date }>()
  const store: IdempotencyKeyStore & {
    entries: typeof entries
    sweepTtlMs: number
  } = {
    entries,
    sweepTtlMs: 24 * 60 * 60 * 1000,
    async sweep() {
      const cutoff = Date.now() - store.sweepTtlMs
      for (const [key, entry] of entries) {
        if (entry.createdAt.getTime() < cutoff) {
          entries.delete(key)
        }
      }
    },
    async find(key: string) {
      const entry = entries.get(key)
      return entry ? { responseStatus: entry.responseStatus, responseBody: entry.responseBody } : null
    },
    async set(key: string, scope: string, status: number, body: unknown) {
      if (entries.has(key)) return
      entries.set(key, {
        responseStatus: status,
        responseBody: body,
        scope,
        createdAt: new Date(),
      })
    },
  }
  return store
}

const memberDb = new Map<string, Map<string, MemberRole>>()
const workspaces = new Map<string, Workspace>()
const inviteDb = new Map<string, WorkspaceInvite>()
let nextInviteId = 1
let createInviteCallCount = 0

function resetState() {
  nextInviteId = 1
  createInviteCallCount = 0
  memberDb.clear()
  workspaces.clear()
  inviteDb.clear()

  workspaces.set(WS_ID, {
    id: WS_ID,
    appId: APP_ID,
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

beforeAll(async () => {
  idempotencyStore = createInMemoryIdempotencyStore()

  app = Fastify({ logger: false })
  app.decorate('config', {
    appId: APP_ID,
    auth: { url: 'http://localhost:3000' },
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

  await app.register(registerInviteRoutes, { idempotencyStore })
  await app.ready()
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

    expect(idempotencyStore.entries.has('invites:key-001')).toBe(true)
    const stored = idempotencyStore.entries.get('invites:key-001')!
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

  it('concurrent same-key requests: only one persists in the store', async () => {
    const [r1, r2] = await Promise.all([
      inject('POST', INVITE_URL, {
        userId: OWNER_ID,
        payload: INVITE_BODY,
        headers: { 'idempotency-key': 'key-race' },
      }),
      inject('POST', INVITE_URL, {
        userId: OWNER_ID,
        payload: INVITE_BODY,
        headers: { 'idempotency-key': 'key-race' },
      }),
    ])

    const statuses = [r1.statusCode, r2.statusCode].sort()
    expect(statuses).toEqual([201, 201])

    expect(idempotencyStore.entries.has('invites:key-race')).toBe(true)
  })

  it('TTL sweep removes expired entries', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    idempotencyStore.entries.set('invites:old-key-1', {
      responseStatus: 201,
      responseBody: { old: true },
      scope: 'invites',
      createdAt: twentyFiveHoursAgo,
    })
    idempotencyStore.entries.set('invites:old-key-2', {
      responseStatus: 201,
      responseBody: { old: true },
      scope: 'invites',
      createdAt: twentyFiveHoursAgo,
    })

    expect(idempotencyStore.entries.size).toBe(2)

    await inject('POST', INVITE_URL, {
      userId: OWNER_ID,
      payload: INVITE_BODY,
      headers: { 'idempotency-key': 'key-fresh' },
    })

    expect(idempotencyStore.entries.has('invites:old-key-1')).toBe(false)
    expect(idempotencyStore.entries.has('invites:old-key-2')).toBe(false)
    expect(idempotencyStore.entries.has('invites:key-fresh')).toBe(true)
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
