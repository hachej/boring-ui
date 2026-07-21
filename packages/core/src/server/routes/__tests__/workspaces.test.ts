import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerWorkspaceRoutes } from '../workspaces'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceMember, WorkspaceRuntime } from '../../../shared/types'
import type { WorkspaceProvisioner } from '../../provisioner/types'
import { ERROR_CODES } from '../../../shared/errors'

const OWNER_ID = 'u-owner-000'
const EDITOR_ID = 'u-editor-000'
const VIEWER_ID = 'u-viewer-000'
const NON_MEMBER_ID = 'u-nobody-000'
const APP_ID = 'test-app'

let nextWsId = 1
const workspaces = new Map<string, Workspace>()
const members = new Map<string, Map<string, MemberRole>>()
const storeCalls: string[] = []

function resetState() {
  nextWsId = 1
  workspaces.clear()
  members.clear()
  storeCalls.length = 0
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    create: async (userId: string, name: string, appId: string, opts?: { isDefault?: boolean; workspaceTypeId?: string }) => {
      storeCalls.push('create')
      const id = `ws-${nextWsId++}`
      const ws: Workspace = {
        id,
        appId,
        workspaceTypeId: opts?.workspaceTypeId ?? 'default',
        name,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        isDefault: opts?.isDefault ?? false,
      }
      workspaces.set(id, ws)
      const wsMembers = members.get(id) ?? new Map()
      wsMembers.set(userId, 'owner')
      members.set(id, wsMembers)
      return ws
    },
    list: async (userId: string, appId: string) => {
      storeCalls.push('list')
      return [...workspaces.values()].filter(
        (ws) => ws.appId === appId && !ws.deletedAt && members.get(ws.id)?.has(userId),
      )
    },
    get: async (id: string) => {
      storeCalls.push(`get:${id}`)
      const ws = workspaces.get(id)
      return ws && !ws.deletedAt ? ws : null
    },
    update: async (id: string, updates: Partial<Pick<Workspace, 'name'>>) => {
      storeCalls.push(`update:${id}`)
      const ws = workspaces.get(id)
      if (!ws || ws.deletedAt) return null
      if (updates.name) ws.name = updates.name
      return ws
    },
    delete: async (id: string) => {
      storeCalls.push(`delete:${id}`)
      const ws = workspaces.get(id)
      if (!ws || ws.deletedAt) return { removed: false, code: ERROR_CODES.NOT_FOUND }
      ws.deletedAt = new Date().toISOString()
      return { removed: true }
    },
    getMemberRole: async (wsId: string, userId: string) => {
      storeCalls.push(`role:${wsId}:${userId}`)
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
  app.decorate('provisioner', null)
  registerErrorHandler(app)

  app.addHook('onRequest', async (request) => {
    const userId = request.headers['x-test-user'] as string | undefined
    if (userId) {
      request.user = { id: userId, email: `${userId}@test.dev`, name: null, emailVerified: true }
    } else {
      request.user = null
    }
    const workspaceId = request.headers['x-test-scope']
    if (typeof workspaceId === 'string') {
      request.requestScope = Object.freeze({
        bindingId: 'binding-test',
        workspaceId,
        defaultDeploymentId: 'deployment-test',
        activeRevision: 'revision-test',
        resolvedDigest: `sha256:${'a'.repeat(64)}`,
      })
    }
    const productType = request.headers['x-test-product-type']
    if (typeof productType === 'string') {
      request.productScope = Object.freeze({
        workspaceTypeId: productType,
        allowWorkspaceCreation: request.headers['x-test-product-create'] === 'true',
        normalizedHostname: `${productType}.products.example`,
      })
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

function inject(
  method: string,
  url: string,
  userId?: string,
  payload?: unknown,
  scopeWorkspaceId?: string,
  product?: { workspaceTypeId: string; allowWorkspaceCreation: boolean },
) {
  const req: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = {
    method,
    url,
  }
  if (userId) req.headers = { 'x-test-user': userId }
  if (scopeWorkspaceId) req.headers = { ...req.headers, 'x-test-scope': scopeWorkspaceId }
  if (product) {
    req.headers = {
      ...req.headers,
      'x-test-product-type': product.workspaceTypeId,
      'x-test-product-create': String(product.allowWorkspaceCreation),
    }
  }
  if (payload !== undefined) req.payload = payload
  return app.inject(req as any)
}

function seedWorkspaceWithMembers(name: string, ownerUserId: string, extraMembers?: Record<string, MemberRole>, opts?: { managedBy?: string | null }) {
  const id = `ws-${nextWsId++}`
  const ws: Workspace = {
    id,
    appId: APP_ID,
    workspaceTypeId: 'default',
    name,
    createdBy: ownerUserId,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    isDefault: false,
    managedBy: opts?.managedBy ?? null,
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
    expect(body.workspace.workspaceTypeId).toBe('default')
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

  it('rejects a client-supplied workspaceTypeId with a stable immutable code', async () => {
    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, {
      name: 'Typed override',
      workspaceTypeId: 'legal-review',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe(ERROR_CODES.WORKSPACE_TYPE_IMMUTABLE)
    expect(workspaces).toHaveLength(0)
  })

  it.each([true, false])('blocks legacy creation in typed mode when create policy is %s', async (allowWorkspaceCreation) => {
    const res = await inject(
      'POST',
      '/api/v1/workspaces',
      OWNER_ID,
      { name: 'Must not create', workspaceTypeId: 'other' },
      undefined,
      { workspaceTypeId: 'contract-review', allowWorkspaceCreation },
    )
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.TYPED_WORKSPACE_CREATION_NOT_AVAILABLE)
    expect(storeCalls).not.toContain('create')
    expect(workspaces).toHaveLength(0)
  })
})

describe('GET /api/v1/workspaces', () => {
  it('returns workspaces for the caller', async () => {
    seedWorkspaceWithMembers('A', OWNER_ID)
    seedWorkspaceWithMembers('B', OWNER_ID)

    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json().workspaces).toHaveLength(2)
    expect(res.json().workspaces.every((workspace: Workspace) => workspace.workspaceTypeId === 'default')).toBe(true)
  })

  it('creates a default workspace record when caller has none', async () => {
    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspaces).toHaveLength(1)
    expect(body.workspaces[0].name).toBe('Default workspace')
    expect(body.workspaces[0].isDefault).toBe(true)
    expect(body.workspaces[0].workspaceTypeId).toBe('default')
    expect(members.get(body.workspaces[0].id)?.get(OWNER_ID)).toBe('owner')
  })

  it('does not implicitly create a default Workspace for a typed product list', async () => {
    const res = await inject(
      'GET',
      '/api/v1/workspaces',
      OWNER_ID,
      undefined,
      undefined,
      { workspaceTypeId: 'contract-review', allowWorkspaceCreation: true },
    )
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ workspaces: [] })
    expect(storeCalls).toEqual(['list'])
    expect(workspaces).toHaveLength(0)
  })

  it('default workspace creation on list is idempotent', async () => {
    const first = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    const second = await inject('GET', '/api/v1/workspaces', OWNER_ID)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().workspaces).toHaveLength(1)
    expect(second.json().workspaces[0].id).toBe(first.json().workspaces[0].id)
  })

  it('default workspace creation on list is concurrency-safe', async () => {
    const [first, second] = await Promise.all([
      inject('GET', '/api/v1/workspaces', OWNER_ID),
      inject('GET', '/api/v1/workspaces', OWNER_ID),
    ])

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.json().workspaces).toHaveLength(1)
    expect(second.json().workspaces).toHaveLength(1)
    expect(first.json().workspaces[0].id).toBe(second.json().workspaces[0].id)
    expect([...workspaces.values()].filter((workspace) => workspace.createdBy === OWNER_ID)).toHaveLength(1)
  })

  it('excludes workspaces where caller is not a member and creates caller default', async () => {
    seedWorkspaceWithMembers('Private', EDITOR_ID)

    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspaces).toHaveLength(1)
    expect(body.workspaces[0].createdBy).toBe(OWNER_ID)
    expect(body.workspaces[0].name).toBe('Default workspace')
  })
})

describe('GET /api/v1/workspaces/:id', () => {
  it('returns workspace and role for a member', async () => {
    const ws = seedWorkspaceWithMembers('GetMe', OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}`, EDITOR_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspace.name).toBe('GetMe')
    expect(body.workspace.workspaceTypeId).toBe('default')
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
    expect(res.json().workspace.workspaceTypeId).toBe('default')
  })

  it('rejects workspaceTypeId mutation with a stable code and leaves the workspace unchanged', async () => {
    const ws = seedWorkspaceWithMembers('Immutable', OWNER_ID)

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, OWNER_ID, {
      name: 'Changed too',
      workspaceTypeId: 'legal-review',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe(ERROR_CODES.WORKSPACE_TYPE_IMMUTABLE)
    expect(workspaces.get(ws.id)).toMatchObject({
      name: 'Immutable',
      workspaceTypeId: 'default',
    })
  })

  it('viewer → 403 forbidden', async () => {
    const ws = seedWorkspaceWithMembers('Nope', OWNER_ID, { [VIEWER_ID]: 'viewer' })

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, VIEWER_ID, { name: 'Hacked' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('rejects empty update body with 400', async () => {
    const ws = seedWorkspaceWithMembers('NoOp', OWNER_ID)

    const res = await inject('PUT', `/api/v1/workspaces/${ws.id}`, OWNER_ID, {})
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
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

  it('already-deleted workspace → 404 not_found', async () => {
    const ws = seedWorkspaceWithMembers('Gone', OWNER_ID)
    ws.deletedAt = new Date().toISOString()

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('not_found')
  })

  it('blocks deleting the managed Company Context workspace', async () => {
    const ws = seedWorkspaceWithMembers('Company Context', OWNER_ID, undefined, { managedBy: 'company-context' })

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.FORBIDDEN)
    expect(workspaces.get(ws.id)?.deletedAt).toBeNull()
  })
})

describe('request-scoped workspace authority', () => {
  it('lists only the bound workspace after membership, without list or create', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)
    seedWorkspaceWithMembers('Other', OWNER_ID)

    const res = await inject('GET', '/api/v1/workspaces', OWNER_ID, undefined, bound.id)

    expect(res.statusCode).toBe(200)
    expect(res.json().workspaces.map((workspace: Workspace) => workspace.id)).toEqual([bound.id])
    expect(storeCalls).toEqual([`role:${bound.id}:${OWNER_ID}`, `get:${bound.id}`])
  })

  it('denies a non-member list before any workspace lookup', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)

    const res = await inject('GET', '/api/v1/workspaces', NON_MEMBER_ID, undefined, bound.id)

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.NOT_MEMBER)
    expect(storeCalls).toEqual([`role:${bound.id}:${NON_MEMBER_ID}`])
  })

  it.each(['ws-foreign', 'bad!'])('rejects foreign or malformed id %s before store calls', async (id) => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)

    for (const method of ['GET', 'PUT', 'DELETE']) {
      storeCalls.length = 0
      const res = await inject(method, `/api/v1/workspaces/${id}`, OWNER_ID, method === 'PUT' ? { name: 'Nope' } : undefined, bound.id)
      expect(res.statusCode).toBe(421)
      expect(res.json()).toMatchObject({
        error: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
        code: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
        message: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
      })
      expect(storeCalls).toEqual([])
    }
  })

  it('rejects create before body validation or store calls', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)

    const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { invalid: true }, bound.id)

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN)
    expect(storeCalls).toEqual([])
  })

  it('rejects a misbound workspace from another app after membership', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)
    bound.appId = 'other-app'

    const res = await inject('PUT', `/api/v1/workspaces/${bound.id}`, OWNER_ID, { name: 'Nope' }, bound.id)

    expect(res.statusCode).toBe(421)
    expect(res.json().code).toBe(ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION)
    expect(storeCalls).toEqual([`role:${bound.id}:${OWNER_ID}`, `get:${bound.id}`])
  })

  it('rejects bound delete after owner membership and before delete effects', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${bound.id}`, OWNER_ID, undefined, bound.id)

    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN)
    expect(storeCalls).toEqual([`role:${bound.id}:${OWNER_ID}`, `get:${bound.id}`])
  })

  it('keeps bound rename and generic lookup order unchanged', async () => {
    const bound = seedWorkspaceWithMembers('Bound', OWNER_ID)
    const scoped = await inject('PUT', `/api/v1/workspaces/${bound.id}`, OWNER_ID, { name: 'Renamed' }, bound.id)
    expect(scoped.statusCode).toBe(200)
    expect(storeCalls).toEqual([`role:${bound.id}:${OWNER_ID}`, `get:${bound.id}`, `update:${bound.id}`])

    storeCalls.length = 0
    const generic = await inject('GET', `/api/v1/workspaces/${bound.id}`, OWNER_ID)
    expect(generic.statusCode).toBe(200)
    expect(storeCalls).toEqual([
      `get:${bound.id}`,
      `role:${bound.id}:${OWNER_ID}`,
      `get:${bound.id}`,
      `role:${bound.id}:${OWNER_ID}`,
    ])
  })
})

describe('Provisioner integration', () => {
  let provApp: FastifyInstance
  let provisionFn: ReturnType<typeof vi.fn<WorkspaceProvisioner['provision']>>
  let destroyFn: ReturnType<typeof vi.fn<WorkspaceProvisioner['destroy']>>
  let runtimes: Map<string, Partial<WorkspaceRuntime>>
  let pNextWsId: number
  const pWorkspaces = new Map<string, Workspace>()
  const pMembers = new Map<string, Map<string, MemberRole>>()

  function provResetState() {
    pNextWsId = 1
    pWorkspaces.clear()
    pMembers.clear()
    runtimes.clear()
    provisionFn.mockReset()
    destroyFn.mockReset()
    provisionFn.mockResolvedValue({ volumePath: '/volumes/ws-test' })
    destroyFn.mockResolvedValue(undefined)
  }

  function provMockWorkspaceStore(): WorkspaceStore {
    return {
      create: async (userId: string, name: string, appId: string, opts?: { isDefault?: boolean; workspaceTypeId?: string }) => {
        const id = `ws-${pNextWsId++}`
        const ws: Workspace = {
          id, appId, workspaceTypeId: opts?.workspaceTypeId ?? 'default', name, createdBy: userId,
          createdAt: new Date().toISOString(), deletedAt: null,
          isDefault: opts?.isDefault ?? false,
        }
        pWorkspaces.set(id, ws)
        const wsMembers = pMembers.get(id) ?? new Map()
        wsMembers.set(userId, 'owner')
        pMembers.set(id, wsMembers)
        return ws
      },
      list: async (userId: string, appId: string) => {
        return [...pWorkspaces.values()].filter(
          (ws) => ws.appId === appId && !ws.deletedAt && pMembers.get(ws.id)?.has(userId),
        )
      },
      get: async (id: string) => {
        const ws = pWorkspaces.get(id)
        return ws && !ws.deletedAt ? ws : null
      },
      update: async (id: string, updates: Partial<Pick<Workspace, 'name'>>) => {
        const ws = pWorkspaces.get(id)
        if (!ws || ws.deletedAt) return null
        if (updates.name) ws.name = updates.name
        return ws
      },
      delete: async (id: string) => {
        const ws = pWorkspaces.get(id)
        if (!ws || ws.deletedAt) return { removed: false, code: ERROR_CODES.NOT_FOUND }
        ws.deletedAt = new Date().toISOString()
        return { removed: true }
      },
      getMemberRole: async (wsId: string, userId: string) => {
        return pMembers.get(wsId)?.get(userId) ?? null
      },
      isMember: async (wsId: string, userId: string) => {
        return pMembers.get(wsId)?.has(userId) ?? false
      },
      putWorkspaceRuntime: async (wsId: string, state: Partial<WorkspaceRuntime>) => {
        const existing = runtimes.get(wsId) ?? { workspaceId: wsId }
        const merged = { ...existing, ...state, workspaceId: wsId, updatedAt: new Date().toISOString() }
        runtimes.set(wsId, merged)
        return merged as WorkspaceRuntime
      },
      getWorkspaceRuntime: async (wsId: string) => {
        return (runtimes.get(wsId) as WorkspaceRuntime) ?? null
      },
    } as unknown as WorkspaceStore
  }

  function provSeedWorkspace(name: string, ownerUserId: string, opts?: { isDefault?: boolean }) {
    const id = `ws-${pNextWsId++}`
    const ws: Workspace = {
      id, appId: APP_ID, workspaceTypeId: 'default', name, createdBy: ownerUserId,
      createdAt: new Date().toISOString(), deletedAt: null, isDefault: opts?.isDefault ?? false,
    }
    pWorkspaces.set(id, ws)
    const wsMembers = new Map<string, MemberRole>()
    wsMembers.set(ownerUserId, 'owner')
    pMembers.set(id, wsMembers)
    return ws
  }

  function provInject(method: string, url: string, userId?: string, payload?: unknown) {
    const req: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method, url }
    if (userId) req.headers = { 'x-test-user': userId }
    if (payload !== undefined) req.payload = payload
    return provApp.inject(req as any)
  }

  beforeAll(async () => {
    runtimes = new Map()
    provisionFn = vi.fn<WorkspaceProvisioner['provision']>().mockResolvedValue({ volumePath: '/volumes/ws-test' })
    destroyFn = vi.fn<WorkspaceProvisioner['destroy']>().mockResolvedValue(undefined)
    pNextWsId = 1

    const mockProvisioner: WorkspaceProvisioner = {
      provision: provisionFn,
      destroy: destroyFn,
    }

    provApp = Fastify({ logger: false })
    provApp.decorate('config', { appId: APP_ID } as any)
    provApp.decorate('workspaceStore', provMockWorkspaceStore())
    provApp.decorate('provisioner', mockProvisioner)
    registerErrorHandler(provApp)

    provApp.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user'] as string | undefined
      if (userId) {
        request.user = { id: userId, email: `${userId}@test.dev`, name: null, emailVerified: true }
      } else {
        request.user = null
      }
    })

    await provApp.register(registerWorkspaceRoutes)
    await provApp.ready()
  })

  afterAll(async () => {
    await provApp.close()
  })

  beforeEach(() => {
    provResetState()
  })

  describe('GET /api/v1/workspaces (with provisioner)', () => {
    it('auto-creates the default workspace through the provisioner', async () => {
      provisionFn.mockResolvedValue({ volumePath: '/volumes/ws-default' })

      const res = await provInject('GET', '/api/v1/workspaces', OWNER_ID)
      expect(res.statusCode).toBe(200)

      const workspace = res.json().workspaces[0]
      expect(workspace).toMatchObject({ name: 'Default workspace', isDefault: true })
      expect(provisionFn).toHaveBeenCalledOnce()
      expect(provisionFn).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: workspace.id,
        workspaceName: 'Default workspace',
        ownerId: OWNER_ID,
        appId: APP_ID,
      }))
      const runtime = runtimes.get(workspace.id)
      expect(runtime?.state).toBe('ready')
      expect(runtime?.volumePath).toBe('/volumes/ws-default')
    })

    it('provision failure while auto-creating default workspace returns HTTP 500', async () => {
      provisionFn.mockRejectedValue(new Error('disk full'))

      const res = await provInject('GET', '/api/v1/workspaces', OWNER_ID)
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('provision_failed')

      const runtime = runtimes.get('ws-1')
      expect(runtime?.state).toBe('error')
      expect(runtime?.lastError).toBe('disk full')
      expect(runtime?.lastErrorOp).toBe('provision')
    })

    it('provisions an existing signup-created default workspace with missing runtime', async () => {
      provisionFn.mockResolvedValue({ volumePath: '/volumes/signup-default' })
      const workspace = provSeedWorkspace('Default workspace', OWNER_ID, { isDefault: true })

      const res = await provInject('GET', '/api/v1/workspaces', OWNER_ID)
      expect(res.statusCode).toBe(200)

      expect(res.json().workspaces[0].id).toBe(workspace.id)
      expect(provisionFn).toHaveBeenCalledOnce()
      expect(provisionFn).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: workspace.id,
        workspaceName: 'Default workspace',
        ownerId: OWNER_ID,
        appId: APP_ID,
      }))
      const runtime = runtimes.get(workspace.id)
      expect(runtime?.state).toBe('ready')
      expect(runtime?.volumePath).toBe('/volumes/signup-default')
    })

    it('backfills shared default workspace runtime under the creator owner id', async () => {
      provisionFn.mockResolvedValue({ volumePath: '/volumes/shared-default' })
      const workspace = provSeedWorkspace('Default workspace', OWNER_ID, { isDefault: true })
      pMembers.get(workspace.id)?.set(EDITOR_ID, 'editor')

      const res = await provInject('GET', '/api/v1/workspaces', EDITOR_ID)
      expect(res.statusCode).toBe(200)

      expect(res.json().workspaces[0].id).toBe(workspace.id)
      expect(provisionFn).toHaveBeenCalledOnce()
      expect(provisionFn).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: workspace.id,
        ownerId: OWNER_ID,
      }))
      expect(runtimes.get(workspace.id)?.volumePath).toBe('/volumes/shared-default')
    })
  })

  describe('POST /api/v1/workspaces (with provisioner)', () => {
    it('creates workspace + runtime ready + volumePath set', async () => {
      provisionFn.mockResolvedValue({ volumePath: '/volumes/ws-1' })

      const res = await provInject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'Provisioned' })
      expect(res.statusCode).toBe(201)

      const wsId = res.json().workspace.id
      expect(provisionFn).toHaveBeenCalledOnce()
      expect(provisionFn).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: wsId,
        workspaceName: 'Provisioned',
        ownerId: OWNER_ID,
        appId: APP_ID,
      }))

      const runtime = runtimes.get(wsId)
      expect(runtime?.state).toBe('ready')
      expect(runtime?.volumePath).toBe('/volumes/ws-1')
    })

    it('provision failure → workspace stored, runtime error, HTTP 500', async () => {
      provisionFn.mockRejectedValue(new Error('disk full'))

      const res = await provInject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'FailProv' })
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('provision_failed')

      const wsId = 'ws-1'
      expect(pWorkspaces.has(wsId)).toBe(true)

      const runtime = runtimes.get(wsId)
      expect(runtime?.state).toBe('error')
      expect(runtime?.lastError).toBe('disk full')
      expect(runtime?.lastErrorOp).toBe('provision')
    })
  })

  describe('DELETE /api/v1/workspaces/:id (with provisioner)', () => {
    it('destroy success → dir gone, workspace deleted, 200', async () => {
      const ws = provSeedWorkspace('DestroyMe', OWNER_ID)

      const res = await provInject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ deleted: true })
      expect(destroyFn).toHaveBeenCalledWith(ws.id)
      expect(pWorkspaces.get(ws.id)?.deletedAt).toBeTruthy()
    })

    it('destroy failure → workspace NOT removed, runtime error, HTTP 500', async () => {
      destroyFn.mockRejectedValue(new Error('EBUSY'))
      const ws = provSeedWorkspace('BusyWS', OWNER_ID)

      const res = await provInject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
      expect(res.statusCode).toBe(500)
      expect(res.json().code).toBe('destroy_failed')

      expect(pWorkspaces.get(ws.id)?.deletedAt).toBeNull()

      const runtime = runtimes.get(ws.id)
      expect(runtime?.state).toBe('error')
      expect(runtime?.lastError).toBe('EBUSY')
      expect(runtime?.lastErrorOp).toBe('destroy')
    })

    it('re-issue DELETE after destroy failure succeeds', async () => {
      destroyFn.mockRejectedValueOnce(new Error('EBUSY'))
      const ws = provSeedWorkspace('RetryWS', OWNER_ID)

      const first = await provInject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
      expect(first.statusCode).toBe(500)

      destroyFn.mockResolvedValue(undefined)
      const second = await provInject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual({ deleted: true })
      expect(pWorkspaces.get(ws.id)?.deletedAt).toBeTruthy()
    })
  })

  describe('No-provisioner mode', () => {
    it('POST creates workspace with no runtime row', async () => {
      const res = await inject('POST', '/api/v1/workspaces', OWNER_ID, { name: 'No Prov' })
      expect(res.statusCode).toBe(201)
    })

    it('DELETE removes workspace without errors', async () => {
      const ws = seedWorkspaceWithMembers('NoProv', OWNER_ID)
      const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}`, OWNER_ID)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ deleted: true })
    })
  })
})
