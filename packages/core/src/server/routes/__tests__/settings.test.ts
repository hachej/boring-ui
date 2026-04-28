import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerSettingsRoutes } from '../settings'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceRuntime } from '../../../shared/types'
import type { WorkspaceProvisioner } from '../../provisioner/types'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const EDITOR_ID = '00000000-0000-0000-0000-000000000002'
const VIEWER_ID = '00000000-0000-0000-0000-000000000003'
const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000004'
const WS_ID = 'ws-001'
const APP_ID = 'test-app'

const memberDb = new Map<string, Map<string, MemberRole>>()
let settingsDb: Array<{ key: string; configured: boolean; updated_at: string }> = []
let runtimeDb: WorkspaceRuntime | null = null

function resetState() {
  memberDb.clear()
  settingsDb = []
  runtimeDb = {
    workspaceId: WS_ID,
    spriteUrl: null,
    spriteName: null,
    state: 'ready',
    lastError: null,
    volumePath: null,
    lastErrorOp: null,
    provisioningStep: null,
    stepStartedAt: null,
    updatedAt: new Date().toISOString(),
  }

  const wsMembers = new Map<string, MemberRole>()
  wsMembers.set(OWNER_ID, 'owner')
  wsMembers.set(EDITOR_ID, 'editor')
  wsMembers.set(VIEWER_ID, 'viewer')
  memberDb.set(WS_ID, wsMembers)
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    getMemberRole: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.get(userId) ?? null,
    isMember: async (wsId: string, userId: string) =>
      memberDb.get(wsId)?.has(userId) ?? false,
    get: async (_id: string): Promise<Workspace | null> => ({
      id: WS_ID, appId: APP_ID, name: 'Test WS', createdBy: OWNER_ID,
      createdAt: new Date().toISOString(), deletedAt: null, isDefault: false,
    }),
    getWorkspaceSettings: async (_wsId: string) => {
      return settingsDb.map((s) => ({ key: s.key, configured: s.configured, updated_at: s.updated_at }))
    },
    putWorkspaceSettings: async (_wsId: string, settings: Record<string, string>) => {
      const now = new Date().toISOString()
      for (const key of Object.keys(settings)) {
        const existing = settingsDb.find((s) => s.key === key)
        if (existing) {
          existing.updated_at = now
        } else {
          settingsDb.push({ key, configured: true, updated_at: now })
        }
      }
      return settingsDb.map((s) => ({ key: s.key, configured: s.configured, updated_at: s.updated_at }))
    },
    getWorkspaceRuntime: async (_wsId: string) => runtimeDb,
    putWorkspaceRuntime: async (_wsId: string, state: Partial<WorkspaceRuntime>) => {
      if (runtimeDb) {
        Object.assign(runtimeDb, state, { updatedAt: new Date().toISOString() })
      }
      return runtimeDb!
    },
    retryWorkspaceRuntime: async (_wsId: string) => {
      if (!runtimeDb || runtimeDb.state !== 'error') return null
      runtimeDb.state = 'pending'
      runtimeDb.lastError = null
      return runtimeDb
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
      request.user = { id: userId, email: `${userId}@test.dev`, name: null }
    } else {
      request.user = null
    }
  })

  await app.register(registerSettingsRoutes)
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

describe('GET /api/v1/workspaces/:id/settings', () => {
  it('returns metadata only — no decrypted values', async () => {
    settingsDb = [
      { key: 'github_token', configured: true, updated_at: '2026-01-01T00:00:00.000Z' },
      { key: 'api_key', configured: true, updated_at: '2026-01-02T00:00:00.000Z' },
    ]

    const res = await inject('GET', `/api/v1/workspaces/${WS_ID}/settings`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.settings).toHaveLength(2)
    expect(body.settings[0]).toEqual({
      key: 'github_token',
      configured: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect(body.settings[0].value).toBeUndefined()
    expect(body.settings[1].value).toBeUndefined()
  })

  it('non-member → 403 not_member', async () => {
    const res = await inject('GET', `/api/v1/workspaces/${WS_ID}/settings`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })
})

describe('PUT /api/v1/workspaces/:id/settings', () => {
  it('editor can write settings and get refreshed metadata', async () => {
    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, EDITOR_ID, {
      github_token: 'secret-value',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.settings).toHaveLength(1)
    expect(body.settings[0].key).toBe('github_token')
    expect(body.settings[0].configured).toBe(true)
    expect(body.settings[0].value).toBeUndefined()
  })

  it('viewer → 403 forbidden', async () => {
    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, VIEWER_ID, {
      key: 'val',
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('rejects > 50 keys with 400', async () => {
    const tooMany: Record<string, string> = {}
    for (let i = 0; i < 51; i++) tooMany[`key_${i}`] = 'val'

    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, EDITOR_ID, tooMany)
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects key > 128 chars with 400', async () => {
    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, EDITOR_ID, {
      ['x'.repeat(129)]: 'val',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects empty value with 400', async () => {
    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, EDITOR_ID, {
      good_key: '',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects empty body with 400', async () => {
    const res = await inject('PUT', `/api/v1/workspaces/${WS_ID}/settings`, EDITOR_ID, {})
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })
})

describe('GET /api/v1/workspaces/:id/runtime', () => {
  it('returns existing runtime', async () => {
    const res = await inject('GET', `/api/v1/workspaces/${WS_ID}/runtime`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.runtime.state).toBe('ready')
    expect(body.runtime.workspaceId).toBe(WS_ID)
  })

  it('non-member → 403 not_member', async () => {
    const res = await inject('GET', `/api/v1/workspaces/${WS_ID}/runtime`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })

  it('returns 404 when workspace does not exist', async () => {
    runtimeDb = null
    const res = await inject('GET', `/api/v1/workspaces/${WS_ID}/runtime`, OWNER_ID)
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/v1/workspaces/:id/runtime/retry', () => {
  it('409 runtime_unmanaged when no provisioner', async () => {
    runtimeDb!.state = 'error'
    runtimeDb!.lastErrorOp = 'provision'
    const res = await inject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('runtime_unmanaged')
  })

  it('409 runtime_unmanaged when no runtime row', async () => {
    runtimeDb = null
    const res = await inject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('runtime_unmanaged')
  })

  it('editor → 403 forbidden', async () => {
    runtimeDb!.state = 'error'
    const res = await inject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, EDITOR_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })
})

describe('POST /api/v1/workspaces/:id/runtime/retry (with provisioner)', () => {
  let provApp: FastifyInstance
  let provisionFn: ReturnType<typeof vi.fn>
  let provRuntimeDb: WorkspaceRuntime | null

  function provResetState() {
    provisionFn.mockReset()
    provisionFn.mockResolvedValue({ volumePath: '/volumes/ws-retried' })
    provRuntimeDb = {
      workspaceId: WS_ID, spriteUrl: null, spriteName: null,
      state: 'error', lastError: 'disk full', volumePath: null,
      lastErrorOp: 'provision', provisioningStep: null,
      stepStartedAt: null, updatedAt: new Date().toISOString(),
    }
  }

  beforeAll(async () => {
    provisionFn = vi.fn().mockResolvedValue({ volumePath: '/volumes/ws-retried' })
    provRuntimeDb = null

    const mockProvisioner: WorkspaceProvisioner = {
      provision: provisionFn,
      destroy: vi.fn(),
    }

    const provMemberDb = new Map<string, Map<string, MemberRole>>()
    const wsMembers = new Map<string, MemberRole>()
    wsMembers.set(OWNER_ID, 'owner')
    wsMembers.set(EDITOR_ID, 'editor')
    provMemberDb.set(WS_ID, wsMembers)

    provApp = Fastify({ logger: false })
    provApp.decorate('config', { appId: APP_ID } as any)
    provApp.decorate('workspaceStore', {
      getMemberRole: async (wsId: string, userId: string) => provMemberDb.get(wsId)?.get(userId) ?? null,
      isMember: async (wsId: string, userId: string) => provMemberDb.get(wsId)?.has(userId) ?? false,
      get: async (_id: string): Promise<Workspace | null> => ({
        id: WS_ID, appId: APP_ID, name: 'Test WS', createdBy: OWNER_ID,
        createdAt: new Date().toISOString(), deletedAt: null, isDefault: false,
      }),
      getWorkspaceRuntime: async () => provRuntimeDb,
      putWorkspaceRuntime: async (_wsId: string, state: Partial<WorkspaceRuntime>) => {
        if (provRuntimeDb) Object.assign(provRuntimeDb, state, { updatedAt: new Date().toISOString() })
        return provRuntimeDb!
      },
      getWorkspaceSettings: async () => [],
      putWorkspaceSettings: async () => [],
    } as unknown as WorkspaceStore)
    provApp.decorate('provisioner', mockProvisioner)
    registerErrorHandler(provApp)

    provApp.addHook('onRequest', async (request) => {
      const userId = request.headers['x-test-user'] as string | undefined
      if (userId) {
        request.user = { id: userId, email: `${userId}@test.dev`, name: null }
      } else {
        request.user = null
      }
    })

    await provApp.register(registerSettingsRoutes)
    await provApp.ready()
  })

  afterAll(async () => {
    await provApp.close()
  })

  beforeEach(() => {
    provResetState()
  })

  function provInject(method: string, url: string, userId?: string, payload?: unknown) {
    const req: any = { method, url }
    if (userId) req.headers = { 'x-test-user': userId }
    if (payload !== undefined) req.payload = payload
    return provApp.inject(req)
  }

  it('retry on error+provision succeeds → 200, runtime ready with volumePath', async () => {
    const res = await provInject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.runtime.state).toBe('ready')
    expect(body.runtime.volumePath).toBe('/volumes/ws-retried')
    expect(provisionFn).toHaveBeenCalledOnce()
  })

  it('retry on ready → 409 invalid_retry_state', async () => {
    provRuntimeDb!.state = 'ready'
    provRuntimeDb!.lastErrorOp = null
    const res = await provInject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('invalid_retry_state')
  })

  it('retry on error+destroy → 409 invalid_retry_state', async () => {
    provRuntimeDb!.lastErrorOp = 'destroy'
    const res = await provInject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('invalid_retry_state')
  })

  it('retry on error+provision, provisioner throws → 500, runtime stays error with new lastError', async () => {
    provisionFn.mockRejectedValue(new Error('still broken'))
    const res = await provInject('POST', `/api/v1/workspaces/${WS_ID}/runtime/retry`, OWNER_ID)
    expect(res.statusCode).toBe(500)
    expect(res.json().code).toBe('provision_failed')
    expect(provRuntimeDb!.state).toBe('error')
    expect(provRuntimeDb!.lastError).toBe('still broken')
    expect(provRuntimeDb!.lastErrorOp).toBe('provision')
  })
})
