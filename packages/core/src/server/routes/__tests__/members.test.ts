import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerMemberRoutes } from '../members'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceMember, User } from '../../../shared/types'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const EDITOR_ID = '00000000-0000-0000-0000-000000000002'
const VIEWER_ID = '00000000-0000-0000-0000-000000000003'
const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000004'
const TARGET_ID = '00000000-0000-0000-0000-000000000005'
const APP_ID = 'test-app'

let nextWsId = 1
const workspaces = new Map<string, Workspace>()
const memberDb = new Map<string, Map<string, MemberRole>>()

function resetState() {
  nextWsId = 1
  workspaces.clear()
  memberDb.clear()
}

const fakeUsers: Record<string, Pick<User, 'id' | 'email' | 'name' | 'image'>> = {
  [OWNER_ID]: { id: OWNER_ID, email: 'owner@test.dev', name: 'Owner', image: null },
  [EDITOR_ID]: { id: EDITOR_ID, email: 'editor@test.dev', name: 'Editor', image: null },
  [VIEWER_ID]: { id: VIEWER_ID, email: 'viewer@test.dev', name: 'Viewer', image: null },
  [TARGET_ID]: { id: TARGET_ID, email: 'target@test.dev', name: 'Target', image: null },
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    getMemberRole: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.get(userId) ?? null,
    isMember: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.has(userId) ?? false,
    listMembers: async (wsId: string) => {
      const wsMembers = memberDb.get(wsId) ?? new Map()
      return [...wsMembers.entries()].map(([userId, role]) => ({
        workspaceId: wsId,
        userId,
        role,
        createdAt: new Date().toISOString(),
        user: fakeUsers[userId] ?? { id: userId, email: `${userId}@test.dev`, name: null, image: null },
      }))
    },
    upsertMember: async (wsId: string, userId: string, role: MemberRole) => {
      const wsMembers = memberDb.get(wsId) ?? new Map()
      wsMembers.set(userId, role)
      memberDb.set(wsId, wsMembers)
      return { workspaceId: wsId, userId, role, createdAt: new Date().toISOString() }
    },
    removeMember: async (wsId: string, userId: string) => {
      const wsMembers = memberDb.get(wsId)
      if (!wsMembers?.has(userId)) return { removed: false, code: 'not_member' as const }
      const role = wsMembers.get(userId)!
      if (role === 'owner') {
        const ownerCount = [...wsMembers.values()].filter((r) => r === 'owner').length
        if (ownerCount <= 1) return { removed: false, code: 'last_owner' as const }
      }
      wsMembers.delete(userId)
      return { removed: true }
    },
  } as unknown as WorkspaceStore
}

function seedWorkspace(ownerUserId: string, extraMembers?: Record<string, MemberRole>) {
  const id = `ws-${nextWsId++}`
  const ws: Workspace = {
    id,
    appId: APP_ID,
    name: 'Test WS',
    createdBy: ownerUserId,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    isDefault: false,
  }
  workspaces.set(id, ws)
  const wsMembers = new Map<string, MemberRole>()
  wsMembers.set(ownerUserId, 'owner')
  if (extraMembers) {
    for (const [uid, role] of Object.entries(extraMembers)) {
      wsMembers.set(uid, role)
    }
  }
  memberDb.set(id, wsMembers)
  return ws
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.decorate('config', { appId: APP_ID } as any)
  app.decorate('workspaceStore', mockWorkspaceStore())
  registerErrorHandler(app)

  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user'] as string | undefined
    if (userId) {
      request.user = { id: userId, email: `${userId}@test.dev`, name: null }
    } else {
      request.user = null
    }
  })

  await app.register(registerMemberRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetState()
})

function inject(method: string, url: string, userId?: string, payload?: unknown) {
  const req: any = { method, url }
  if (userId) req.headers = { 'x-test-user': userId }
  if (payload !== undefined) req.payload = payload
  return app.inject(req)
}

describe('GET /api/v1/workspaces/:id/members', () => {
  it('returns enriched members with user info', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}/members`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.members).toHaveLength(2)

    const owner = body.members.find((m: any) => m.userId === OWNER_ID)
    expect(owner.role).toBe('owner')
    expect(owner.user.email).toBe('owner@test.dev')
    expect(owner.user.name).toBe('Owner')

    const editor = body.members.find((m: any) => m.userId === EDITOR_ID)
    expect(editor.role).toBe('editor')
    expect(editor.user.email).toBe('editor@test.dev')
  })

  it('non-member → 403 not_member', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}/members`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })
})

describe('POST /api/v1/workspaces/:id/members', () => {
  it('owner can add a member → 201', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/members`, OWNER_ID, {
      userId: TARGET_ID,
      role: 'editor',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().member.role).toBe('editor')
    expect(res.json().member.userId).toBe(TARGET_ID)
  })

  it('editor → 403 forbidden', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/members`, EDITOR_ID, {
      userId: TARGET_ID,
      role: 'viewer',
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('409 if user is already a member', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/members`, OWNER_ID, {
      userId: EDITOR_ID,
      role: 'viewer',
    })
    expect(res.statusCode).toBe(409)
  })

  it('rejects invalid body', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/members`, OWNER_ID, {
      userId: 'not-a-uuid',
      role: 'superadmin',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })
})

describe('DELETE /api/v1/workspaces/:id/members/:userId', () => {
  it('owner can remove a member → 200', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/members/${EDITOR_ID}`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ removed: true })
  })

  it('removing last owner → 409 last_owner', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/members/${OWNER_ID}`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('last_owner')
  })

  it('removing non-member → 409 not_member', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/members/${NON_MEMBER_ID}`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('not_member')
  })

  it('editor → 403 forbidden', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor', [VIEWER_ID]: 'viewer' })

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/members/${VIEWER_ID}`, EDITOR_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })
})
