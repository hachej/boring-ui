/**
 * Workspace-route authorization audit (M2 SHIP-BLOCKER).
 *
 * Catches the v1 vulnerability where any authenticated user could
 * read/update/delete any workspace by guessing UUIDs.
 *
 * 5-layer audit:
 *   L1 — structural: every /api/v1/workspaces/:id/** route has a preHandler
 *   L2 — unauthenticated → 401
 *   L3 — authenticated non-member → 403 not_member
 *   L4 — member → 2xx
 *   L5 — cross-app isolation
 */
import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance, RouteOptions } from 'fastify'
import { registerWorkspaceRoutes } from '../workspaces'
import { registerMemberRoutes } from '../members'
import { registerInviteRoutes } from '../invites'
import { registerSettingsRoutes } from '../settings'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type {
  MemberRole,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
} from '../../../shared/types'
import { HttpError, ERROR_CODES } from '../../../shared/errors'

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000099'
const APP_ID = 'test-app'
const APP_ID_OTHER = 'other-app'

// The accept endpoint is intentionally exempt from requireWorkspaceMember:
// the user is not a member yet — that's the whole point of accepting an invite.
const EXEMPT_ROUTES = new Set([
  'POST /api/v1/workspaces/:id/invites/:inviteId/accept',
])

// ────────────────────────────────────────────────────────────────────
// Mock state
// ────────────────────────────────────────────────────────────────────

let nextWsId = 1
let nextInviteId = 1
const workspaces = new Map<string, Workspace>()
const memberDb = new Map<string, Map<string, MemberRole>>()
const inviteDb = new Map<string, WorkspaceInvite>()
const inviteTokens = new Map<string, string>()
const wsSettings = new Map<string, Map<string, { value: string; updatedAt: string }>>()
const wsRuntimes = new Map<string, WorkspaceRuntime>()

function resetState() {
  nextWsId = 1
  nextInviteId = 1
  workspaces.clear()
  memberDb.clear()
  inviteDb.clear()
  inviteTokens.clear()
  wsSettings.clear()
  wsRuntimes.clear()
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    create: async (userId: string, name: string, appId: string, opts?: { isDefault?: boolean }) => {
      const id = `ws-${nextWsId++}`
      const ws: Workspace = {
        id, appId, name, createdBy: userId,
        createdAt: new Date().toISOString(), deletedAt: null,
        isDefault: opts?.isDefault ?? false,
      }
      workspaces.set(id, ws)
      const wsMembers = new Map<string, MemberRole>()
      wsMembers.set(userId, 'owner')
      memberDb.set(id, wsMembers)
      wsRuntimes.set(id, {
        workspaceId: id, spriteUrl: null, spriteName: null,
        state: 'ready', lastError: null, volumePath: null, lastErrorOp: null,
        provisioningStep: null, stepStartedAt: null, updatedAt: new Date().toISOString(),
      })
      return ws
    },
    list: async (userId: string, appId: string) =>
      [...workspaces.values()].filter(
        (ws) => ws.appId === appId && memberDb.get(ws.id)?.has(userId),
      ),
    get: async (id: string) => workspaces.get(id) ?? null,
    update: async (id: string, updates: Partial<Pick<Workspace, 'name'>>) => {
      const ws = workspaces.get(id)
      if (!ws) return null
      if (updates.name) ws.name = updates.name
      return ws
    },
    delete: async (id: string) => {
      if (!workspaces.has(id)) return { removed: false as const, code: ERROR_CODES.NOT_FOUND }
      workspaces.delete(id)
      return { removed: true }
    },
    getWorkspacesWhereSoleOwner: async () => [],
    getMemberRole: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.get(userId) ?? null,
    isMember: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.has(userId) ?? false,
    listMembers: async (wsId: string) => {
      const wsMembers = memberDb.get(wsId) ?? new Map()
      return [...wsMembers.entries()].map(([userId, role]) => ({
        workspaceId: wsId, userId, role,
        createdAt: new Date().toISOString(),
        user: { id: userId, email: `${userId}@test.dev`, name: null, image: null },
      }))
    },
    upsertMember: async (wsId: string, userId: string, role: MemberRole) => {
      const m = memberDb.get(wsId) ?? new Map()
      m.set(userId, role)
      memberDb.set(wsId, m)
      return { workspaceId: wsId, userId, role, createdAt: new Date().toISOString() }
    },
    removeMember: async (wsId: string, userId: string) => {
      const m = memberDb.get(wsId)
      if (!m?.has(userId)) return { removed: false, code: 'not_member' as const }
      m.delete(userId)
      return { removed: true }
    },
    listInvites: async (wsId: string) =>
      [...inviteDb.values()].filter((i) => i.workspaceId === wsId),
    createInvite: async (wsId: string, email: string, role: MemberRole, invitedBy: string | null) => {
      const id = `inv-${nextInviteId++}`
      const rawToken = `raw-token-${id}`
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      const invite: WorkspaceInvite = {
        id, workspaceId: wsId, email, tokenHash, role,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        acceptedAt: null, createdBy: invitedBy, createdAt: new Date().toISOString(),
        failedAttempts: 0, lockedUntil: null,
      }
      inviteDb.set(id, invite)
      inviteTokens.set(id, rawToken)
      return { invite, rawToken }
    },
    getInvite: async (wsId: string, inviteId: string) => {
      const inv = inviteDb.get(inviteId)
      return inv?.workspaceId === wsId ? inv : null
    },
    getInviteByTokenHash: async (tokenHash: string) =>
      [...inviteDb.values()].find((i) => i.tokenHash === tokenHash) ?? null,
    revokeInvite: async (wsId: string, inviteId: string) => {
      const inv = inviteDb.get(inviteId)
      if (!inv || inv.workspaceId !== wsId) return false
      inviteDb.delete(inviteId)
      return true
    },
    acceptInvite: async (wsId: string, inviteId: string, userId: string) => {
      const inv = inviteDb.get(inviteId)
      if (!inv || inv.workspaceId !== wsId)
        throw new HttpError({ status: 404, code: ERROR_CODES.INVITE_NOT_FOUND, message: 'Not found' })
      if (inv.acceptedAt)
        throw new HttpError({ status: 409, code: ERROR_CODES.INVITE_ALREADY_ACCEPTED, message: 'Already accepted' })
      if (new Date(inv.expiresAt) < new Date())
        throw new HttpError({ status: 410, code: ERROR_CODES.INVITE_EXPIRED, message: 'Expired' })
      inv.acceptedAt = new Date().toISOString()
      const m = memberDb.get(wsId) ?? new Map()
      m.set(userId, inv.role)
      memberDb.set(wsId, m)
      return {
        invite: inv,
        member: { workspaceId: wsId, userId, role: inv.role, createdAt: new Date().toISOString() } as WorkspaceMember,
      }
    },
    getWorkspaceSettings: async () => [],
    putWorkspaceSettings: async () => [],
    getWorkspaceRuntime: async (wsId: string) => wsRuntimes.get(wsId) ?? null,
    putWorkspaceRuntime: async (wsId: string, state: Partial<WorkspaceRuntime>) => {
      const rt = wsRuntimes.get(wsId)!
      Object.assign(rt, state)
      return rt
    },
    retryWorkspaceRuntime: async (wsId: string) => {
      const rt = wsRuntimes.get(wsId)
      if (!rt || rt.state !== 'error') return null
      rt.state = 'pending'
      rt.lastError = null
      return rt
    },
    getUiState: async () => null,
    putUiState: async () => {},
  } as unknown as WorkspaceStore
}

// ────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────

function seedWorkspace(ownerUserId: string, appId = APP_ID) {
  const id = `ws-${nextWsId++}`
  const ws: Workspace = {
    id, appId, name: 'Test WS', createdBy: ownerUserId,
    createdAt: new Date().toISOString(), deletedAt: null,
    isDefault: false,
  }
  workspaces.set(id, ws)
  const m = new Map<string, MemberRole>()
  m.set(ownerUserId, 'owner')
  memberDb.set(id, m)
  wsRuntimes.set(id, {
    workspaceId: id, spriteUrl: null, spriteName: null,
    state: 'ready', lastError: null, volumePath: null, lastErrorOp: null,
    provisioningStep: null, stepStartedAt: null, updatedAt: new Date().toISOString(),
  })
  return ws
}

function seedInvite(wsId: string, email: string, role: MemberRole) {
  const id = `inv-${nextInviteId++}`
  const rawToken = `raw-token-${id}`
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const invite: WorkspaceInvite = {
    id, workspaceId: wsId, email, tokenHash, role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null, createdBy: OWNER_ID, createdAt: new Date().toISOString(),
    failedAttempts: 0, lockedUntil: null,
  }
  inviteDb.set(id, invite)
  inviteTokens.set(id, rawToken)
  return { invite, rawToken }
}

function inject(app: FastifyInstance, method: string, url: string, userId?: string, payload?: unknown) {
  const req: any = { method, url }
  if (userId) req.headers = { 'x-test-user': userId }
  if (payload !== undefined) req.payload = payload
  return app.inject(req)
}

// ────────────────────────────────────────────────────────────────────
// Build app
// ────────────────────────────────────────────────────────────────────

let app: FastifyInstance
const capturedRoutes: Array<{ method: string; url: string; hasPreHandler: boolean }> = []

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.decorate('config', { appId: APP_ID, auth: { url: 'http://localhost:3000' }, features: { inviteTtlDays: 7 } } as any)
  app.decorate('workspaceStore', mockWorkspaceStore())
  registerErrorHandler(app)

  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method]
    const ph = routeOptions.preHandler
    const hasPreHandler = Array.isArray(ph) ? ph.length > 0 : !!ph
    for (const method of methods) {
      capturedRoutes.push({ method, url: routeOptions.url, hasPreHandler })
    }
  })

  app.addHook('onRequest', async (request, reply) => {
    const userId = request.headers['x-test-user'] as string | undefined
    if (userId) {
      request.user = { id: userId, email: `${userId}@test.dev`, name: null }
    } else {
      request.user = null
      // Simulate core's authHook: reject unauthenticated requests to /api/v1/
      const path = request.url.split('?')[0]
      if (path.startsWith('/api/v1/')) {
        reply.code(401).send({
          error: 'Authentication required',
          code: 'unauthorized',
          message: 'Authentication required',
        })
      }
    }
  })

  await app.register(registerWorkspaceRoutes)
  await app.register(registerMemberRoutes)
  await app.register(registerInviteRoutes)
  await app.register(registerSettingsRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetState()
})

// ────────────────────────────────────────────────────────────────────
// The route table: every workspace-scoped route and how to call it
// ────────────────────────────────────────────────────────────────────

interface RouteSpec {
  method: string
  path: string
  /** Builds the request URL given workspace ID + any dependent entity IDs */
  url: (wsId: string, ctx: { inviteId?: string; rawToken?: string }) => string
  /** Payload for methods that need a body */
  payload?: (wsId: string, ctx: { inviteId?: string }) => unknown
  /** Expected status code range for an authorized member */
  expectMember: number | ((status: number) => boolean)
  /** If true, this route is exempt from requireWorkspaceMember */
  exempt?: boolean
}

const ROUTE_TABLE: RouteSpec[] = [
  // workspaces.ts
  {
    method: 'GET', path: '/api/v1/workspaces/:id',
    url: (wsId) => `/api/v1/workspaces/${wsId}`,
    expectMember: 200,
  },
  {
    method: 'PUT', path: '/api/v1/workspaces/:id',
    url: (wsId) => `/api/v1/workspaces/${wsId}`,
    payload: () => ({ name: 'Updated' }),
    expectMember: 200,
  },
  {
    method: 'DELETE', path: '/api/v1/workspaces/:id',
    url: (wsId) => `/api/v1/workspaces/${wsId}`,
    expectMember: 200,
  },
  // members.ts
  {
    method: 'GET', path: '/api/v1/workspaces/:id/members',
    url: (wsId) => `/api/v1/workspaces/${wsId}/members`,
    expectMember: 200,
  },
  {
    method: 'POST', path: '/api/v1/workspaces/:id/members',
    url: (wsId) => `/api/v1/workspaces/${wsId}/members`,
    payload: () => ({ userId: NON_MEMBER_ID, role: 'viewer' }),
    expectMember: 201,
  },
  {
    method: 'DELETE', path: '/api/v1/workspaces/:id/members/:userId',
    url: (wsId) => `/api/v1/workspaces/${wsId}/members/${NON_MEMBER_ID}`,
    expectMember: (s) => s === 200 || s === 409,
  },
  // invites.ts
  {
    method: 'GET', path: '/api/v1/workspaces/:id/invites',
    url: (wsId) => `/api/v1/workspaces/${wsId}/invites`,
    expectMember: 200,
  },
  {
    method: 'POST', path: '/api/v1/workspaces/:id/invites',
    url: (wsId) => `/api/v1/workspaces/${wsId}/invites`,
    payload: () => ({ email: 'new@test.dev', role: 'editor' }),
    expectMember: 201,
  },
  {
    method: 'POST', path: '/api/v1/workspaces/:id/invites/:inviteId/accept',
    url: (wsId, ctx) => `/api/v1/workspaces/${wsId}/invites/${ctx.inviteId}/accept?invite_token=${ctx.rawToken}`,
    expectMember: 200,
    exempt: true,
  },
  {
    method: 'DELETE', path: '/api/v1/workspaces/:id/invites/:inviteId',
    url: (wsId, ctx) => `/api/v1/workspaces/${wsId}/invites/${ctx.inviteId}`,
    expectMember: 200,
  },
  // settings.ts
  {
    method: 'GET', path: '/api/v1/workspaces/:id/settings',
    url: (wsId) => `/api/v1/workspaces/${wsId}/settings`,
    expectMember: 200,
  },
  {
    method: 'PUT', path: '/api/v1/workspaces/:id/settings',
    url: (wsId) => `/api/v1/workspaces/${wsId}/settings`,
    payload: () => ({ SOME_KEY: 'value' }),
    expectMember: 200,
  },
  {
    method: 'GET', path: '/api/v1/workspaces/:id/runtime',
    url: (wsId) => `/api/v1/workspaces/${wsId}/runtime`,
    expectMember: 200,
  },
  {
    method: 'POST', path: '/api/v1/workspaces/:id/runtime/retry',
    url: (wsId) => `/api/v1/workspaces/${wsId}/runtime/retry`,
    expectMember: (s) => s === 200 || s === 409,
  },
]

// ────────────────────────────────────────────────────────────────────
// Layer 1 — structural preHandler check
// ────────────────────────────────────────────────────────────────────

describe('L1: preHandler registration', () => {
  it('every /api/v1/workspaces/:id/** route has a preHandler (except exempt)', () => {
    const workspaceRoutes = capturedRoutes.filter(
      (r) => r.url.startsWith('/api/v1/workspaces/:id'),
    )

    expect(workspaceRoutes.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const route of workspaceRoutes) {
      const key = `${route.method} ${route.url}`
      if (EXEMPT_ROUTES.has(key)) continue
      if (!route.hasPreHandler) {
        missing.push(key)
      }
    }

    expect(
      missing,
      `Routes missing requireWorkspaceMember preHandler:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('discovered routes cover the full route table', () => {
    const discoveredKeys = new Set(
      capturedRoutes
        .filter((r) => r.url.startsWith('/api/v1/workspaces/:id'))
        .map((r) => `${r.method} ${r.url}`),
    )

    for (const spec of ROUTE_TABLE) {
      const key = `${spec.method} ${spec.path}`
      expect(
        discoveredKeys.has(key),
        `Route table entry ${key} not found in registered routes — was it removed?`,
      ).toBe(true)
    }
  })
})

// ────────────────────────────────────────────────────────────────────
// Layers 2-4 — behavioral tests (parameterized)
// ────────────────────────────────────────────────────────────────────

describe.each(
  ROUTE_TABLE.filter((r) => !r.exempt).map((r) => ({
    label: `${r.method} ${r.path}`,
    ...r,
  })),
)('$label', ({ method, url, payload, expectMember }) => {
  it('L2: unauthenticated → 401', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'x@test.dev', 'viewer')
    const ctx = { inviteId: invite.id, rawToken }

    const res = await inject(
      app, method, url(ws.id, ctx), undefined,
      payload?.(ws.id, ctx),
    )
    expect(res.statusCode).toBe(401)
  })

  it('L3: authenticated non-member → 403 not_member', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'x@test.dev', 'viewer')
    const ctx = { inviteId: invite.id, rawToken }

    const res = await inject(
      app, method, url(ws.id, ctx), NON_MEMBER_ID,
      payload?.(ws.id, ctx),
    )
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })

  it('L4: member → 2xx', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'x@test.dev', 'viewer')
    const ctx = { inviteId: invite.id, rawToken }

    const res = await inject(
      app, method, url(ws.id, ctx), OWNER_ID,
      payload?.(ws.id, ctx),
    )

    if (typeof expectMember === 'function') {
      expect(
        expectMember(res.statusCode),
        `Expected 2xx or acceptable status, got ${res.statusCode}: ${res.body}`,
      ).toBe(true)
    } else {
      expect(res.statusCode).toBe(expectMember)
    }
  })
})

// ────────────────────────────────────────────────────────────────────
// Exempt route: POST accept (requires auth but NOT membership)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/workspaces/:id/invites/:inviteId/accept (exempt)', () => {
  it('L2: unauthenticated → 401', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'x@test.dev', 'viewer')

    const res = await inject(
      app, 'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
    )
    expect(res.statusCode).toBe(401)
  })

  it('L4: authenticated non-member can accept their own invite', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, `${NON_MEMBER_ID}@test.dev`, 'viewer')

    const res = await inject(
      app, 'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      NON_MEMBER_ID,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json().member.userId).toBe(NON_MEMBER_ID)
  })
})

// ────────────────────────────────────────────────────────────────────
// Layer 5 — cross-app isolation
// ────────────────────────────────────────────────────────────────────

describe('L5: cross-app isolation', () => {
  it('user in app X cannot list workspaces from app Y', async () => {
    seedWorkspace(OWNER_ID, APP_ID)
    seedWorkspace(OWNER_ID, APP_ID_OTHER)

    const res = await inject(app, 'GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    for (const ws of body.workspaces) {
      expect(ws.appId).toBe(APP_ID)
    }
  })
})
