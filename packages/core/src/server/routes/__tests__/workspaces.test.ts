import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerWorkspaceRoutes } from '../workspaces'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceMember } from '../../../shared/types'
import { ERROR_CODES } from '../../../shared/errors'

const OWNER_ID = 'u-owner-000'
const EDITOR_ID = 'u-editor-000'
const VIEWER_ID = 'u-viewer-000'
const NON_MEMBER_ID = 'u-nobody-000'
const APP_ID = 'test-app'

let nextWsId = 1
const workspaces = new Map<string, Workspace>()
const members = new Map<string, Map<string, MemberRole>>()

function resetState() {
  nextWsId = 1
  workspaces.clear()
  members.clear()
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    create: async (userId: string, name: string, appId: string, opts?: { isDefault?: boolean }) => {
      const id = `ws-${nextWsId++}`
      const ws: Workspace = {
        id,
        appId,
        name,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        isDefault: opts?.isDefault ?? false,
        machineId: null,
        volumeId: null,
        flyRegion: null,
      }
      workspaces.set(id, ws)
      const wsMembers = members.get(id) ?? new Map()
      wsMembers.set(userId, 'owner')
      members.set(id, wsMembers)
      return ws
    },
    list: async (userId: string, appId: string) => {
      return [...workspaces.values()].filter(
        (ws) => ws.appId === appId && !ws.deletedAt && members.get(ws.id)?.has(userId),
      )
    },
    get: async (id: string) => {
      const ws = workspaces.get(id)
      return ws && !ws.deletedAt ? ws : null
    },
    update: async (id: string, updates: Partial<Pick<Workspace, 'name'>>) => {
      const ws = workspaces.get(id)
      if (!ws || ws.deletedAt) return null
      if (updates.name) ws.name = updates.name
      return ws
    },
    delete: async (id: string) => {
      const ws = workspaces.get(id)
      if (!ws || ws.deletedAt) return { removed: false, code: 'not_found' as const }
      if (ws.name === 'PROVISIONING') return { removed: false, code: 'workspace_provisioning' as const }
      ws.deletedAt = new Date().toISOString()
      return { removed: true }
    },
    getMemberRole: async (wsId: string, userId: string) => {
      return members.get(wsId)?.get(userId) ?? null
    },
    isMember: async (wsId: string, userId: string) => {
      return members.get(wsId)?.has(userId) ?? false
    },
  } as unknown as WorkspaceStore
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

  await app.register(registerWorkspaceRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  resetState()
})

function inject(method: string, url: string, userId?: string, payload?: unknown) {
  const req: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = {
    method,
    url,
  }
  if (userId) req.headers = { 'x-test-user': userId }
  if (payload !== undefined) req.payload = payload
  return app.inject(req as any)
}

function seedWorkspaceWithMembers(name: string, ownerUserId: string, extraMembers?: Record<string, MemberRole>) {
  const id = `ws-${nextWsId++}`
  const ws: Workspace = {
    id,
    appId: APP_ID,
    name,
    createdBy: ownerUserId,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    isDefault: false,
    machineId: null,
    volumeId: null,
    flyRegion: null,
  }
  workspaces.set(id, ws)
  const wsMembers = new Map<string, MemberRole>()
  wsMembers.set(ownerUserId, 'owner')
  if (extraMembers) {
    for (const [uid, role] of Object.entries(extraMembers)) {
      wsMembers.set(uid, role)
    }
  }
  members.set(id, wsMembers)
  return ws
}

describe('POST /api/v1/workspaces', () => {
  it('creates workspace and returns 201 with role=owner', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'My WS' })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.workspace.name).toBe('My WS')
    expect(body.workspace.createdBy).toBe(OWNER_ID)
    expect(body.role).toBe('owner')
  })

  it('first workspace is isDefault=true', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'First' })
    expect(res.statusCode).toBe(201)
    expect(res.json().workspace.isDefault).toBe(true)
  })

  it('second workspace is isDefault=false', async () => {
    await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'First' })
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'Second' })
    expect(res.statusCode).toBe(201)
    expect(res.json().workspace.isDefault).toBe(false)
  })

  it('auto-inserts caller as owner member', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'WithMember' })
    const wsId = res.json().workspace.id
    const role = members.get(wsId)?.get(OWNER_ID)
    expect(role).toBe('owner')
  })

  it('rejects name > 100 chars with 400', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'x'.repeat(101) })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects empty name with 400', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects unknown fields with 400', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'ok', admin: true })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })
})

describe('GET /api/v1/workspaces', () => {
  it('returns workspaces for the caller', async () => {
    seedWorkspaceWithMembers('A', OWNER_ID)
    seedWorkspaceWithMembers('B', OWNER_ID)

    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json().workspaces).toHaveLength(2)
  })

  it('excludes workspaces where caller is not a member', async () => {
    seedWorkspaceWithMembers('Private', EDITOR_ID)

    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json().workspaces).toHaveLength(0)
  })
})

describe('GET /api/v1/workspaces/:id', () => {
  it('returns workspace and role for a member', async () => {
    const ws = seedWorkspaceWithMembers('GetMe', OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}`, EDITOR_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspace.name).toBe('GetMe')
    expect(body.role).toBe('editor')
  })

  it('non-member → 403 not_member', async () => {
    const ws = seedWorkspaceWithMembers('Private', OWNER_ID)

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })
})

describe('PUT /api/v1/workspaces/:id', () => {
  it('editor can update name', async () => {
    const ws = seedWorkspaceWithMembers('Old', OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, EDITOR_ID, { name: 'New' })
    expect(res.statusCode).toBe(200)
    expect(res.json().workspace.name).toBe('New')
  })

  it('viewer → 403 forbidden', async () => {
    const ws = seedWorkspaceWithMembers('Nope', OWNER_ID, { [VIEWER_ID]: 'viewer' })

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, VIEWER_ID, { name: 'Hacked' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('rejects invalid body', async () => {
    const ws = seedWorkspaceWithMembers('Valid', OWNER_ID)

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, OWNER_ID, { name: 'x'.repeat(101) })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })
})

describe('DELETE /api/v1/workspaces/:id', () => {
  it('owner can delete → 200', async () => {
    const ws = seedWorkspaceWithMembers('Delete', OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ deleted: true })
  })

  it('editor → 403 forbidden', async () => {
    const ws = seedWorkspaceWithMembers('NoDelete', OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, EDITOR_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('non-member → 403 not_member', async () => {
    const ws = seedWorkspaceWithMembers('Nope', OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })

  it('during provisioning → 409 workspace_provisioning', async () => {
    const ws = seedWorkspaceWithMembers('PROVISIONING', OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('workspace_provisioning')
  })

  it('already-deleted workspace → 404 not_found', async () => {
    const ws = seedWorkspaceWithMembers('Gone', OWNER_ID)
    ws.deletedAt = new Date().toISOString()

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('not_found')
  })
})
