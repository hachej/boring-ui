import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { requireWorkspaceMember } from '../requireWorkspaceMember'
import { registerErrorHandler } from '../../app/errorHandler'
import type { MemberRole } from '../../../shared/types'
import type { WorkspaceStore } from '../../app/types'

const WS_ID = '10000000-0000-0000-0000-000000000001'
const OWNER_ID = 'u-owner'
const EDITOR_ID = 'u-editor'
const VIEWER_ID = 'u-viewer'
const NON_MEMBER_ID = 'u-nobody'

const ROLES: Record<string, MemberRole | null> = {
  [OWNER_ID]: 'owner',
  [EDITOR_ID]: 'editor',
  [VIEWER_ID]: 'viewer',
  [NON_MEMBER_ID]: null,
}

function mockWorkspaceStore(): WorkspaceStore {
  return {
    getMemberRole: async (_wsId: string, userId: string) =>
      ROLES[userId] ?? null,
  } as unknown as WorkspaceStore
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })

  app.decorate('config', { appId: 'test' } as any)
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

  app.get(
    '/api/v1/workspaces/:id',
    { preHandler: requireWorkspaceMember() },
    async () => ({ ok: true }),
  )

  app.get(
    '/api/v1/workspaces/:id/viewer-route',
    { preHandler: requireWorkspaceMember('viewer') },
    async () => ({ ok: true }),
  )

  app.get(
    '/api/v1/workspaces/:id/editor-route',
    { preHandler: requireWorkspaceMember('editor') },
    async () => ({ ok: true }),
  )

  app.get(
    '/api/v1/workspaces/:id/owner-route',
    { preHandler: requireWorkspaceMember('owner') },
    async () => ({ ok: true }),
  )

  await app.ready()
})

afterAll(async () => {
  await app.close()
})

function inject(url: string, userId?: string) {
  const req: { method: 'GET'; url: string; headers?: Record<string, string> } = {
    method: 'GET',
    url,
  }
  if (userId) {
    req.headers = { 'x-test-user': userId }
  }
  return app.inject(req)
}

describe('requireWorkspaceMember', () => {
  describe('no minimum role (any member)', () => {
    it('owner → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}`, OWNER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('editor → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}`, EDITOR_ID)
      expect(res.statusCode).toBe(200)
    })

    it('viewer → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}`, VIEWER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('non-member → 403 not_member', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}`, NON_MEMBER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('not_member')
    })
  })

  describe('minimum role = viewer', () => {
    it('viewer → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/viewer-route`, VIEWER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('editor → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/viewer-route`, EDITOR_ID)
      expect(res.statusCode).toBe(200)
    })

    it('owner → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/viewer-route`, OWNER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('non-member → 403 not_member', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/viewer-route`, NON_MEMBER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('not_member')
    })
  })

  describe('minimum role = editor', () => {
    it('editor → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/editor-route`, EDITOR_ID)
      expect(res.statusCode).toBe(200)
    })

    it('owner → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/editor-route`, OWNER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('viewer → 403 forbidden', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/editor-route`, VIEWER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('forbidden')
    })

    it('non-member → 403 not_member', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/editor-route`, NON_MEMBER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('not_member')
    })
  })

  describe('minimum role = owner', () => {
    it('owner → 200', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/owner-route`, OWNER_ID)
      expect(res.statusCode).toBe(200)
    })

    it('editor → 403 forbidden', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/owner-route`, EDITOR_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('forbidden')
    })

    it('viewer → 403 forbidden', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/owner-route`, VIEWER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('forbidden')
    })

    it('non-member → 403 not_member', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}/owner-route`, NON_MEMBER_ID)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('not_member')
    })
  })

  describe('unauthenticated', () => {
    it('throws Error (not HttpError) when request.user is null — 500, not 403', async () => {
      const res = await inject(`/api/v1/workspaces/${WS_ID}`)
      expect(res.statusCode).toBe(500)
      expect(res.json().code).not.toBe('not_member')
      expect(res.json().code).not.toBe('forbidden')
    })
  })
})
