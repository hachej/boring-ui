import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerInviteRoutes } from '../invites'
import { registerErrorHandler } from '../../app/errorHandler'
import type { WorkspaceStore } from '../../app/types'
import type { MemberRole, Workspace, WorkspaceMember, WorkspaceInvite } from '../../../shared/types'
import { HttpError, ERROR_CODES } from '../../../shared/errors'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const EDITOR_ID = '00000000-0000-0000-0000-000000000002'
const VIEWER_ID = '00000000-0000-0000-0000-000000000003'
const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000004'
const INVITEE_ID = '00000000-0000-0000-0000-000000000005'
const APP_ID = 'test-app'

let nextWsId = 1
let nextInviteId = 1
const workspaces = new Map<string, Workspace>()
const memberDb = new Map<string, Map<string, MemberRole>>()
const inviteDb = new Map<string, WorkspaceInvite>()
const inviteTokens = new Map<string, string>()

function resetState() {
  nextWsId = 1
  nextInviteId = 1
  workspaces.clear()
  memberDb.clear()
  inviteDb.clear()
  inviteTokens.clear()
}

const fakeUsers: Record<string, { id: string; email: string; name: string | null }> = {
  [OWNER_ID]: { id: OWNER_ID, email: 'owner@test.dev', name: 'Owner' },
  [EDITOR_ID]: { id: EDITOR_ID, email: 'editor@test.dev', name: 'Editor' },
  [VIEWER_ID]: { id: VIEWER_ID, email: 'viewer@test.dev', name: 'Viewer' },
  [INVITEE_ID]: { id: INVITEE_ID, email: 'invitee@test.dev', name: 'Invitee' },
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
      inviteTokens.set(id, rawToken)
      return { invite, rawToken }
    },
    getInvite: async (wsId: string, inviteId: string) => {
      const inv = inviteDb.get(inviteId)
      if (!inv || inv.workspaceId !== wsId) return null
      return inv
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
      if (!inv || inv.workspaceId !== wsId) {
        throw new HttpError({ status: 404, code: ERROR_CODES.INVITE_NOT_FOUND, message: 'Invite not found' })
      }
      if (new Date(inv.expiresAt) < new Date()) {
        throw new HttpError({ status: 410, code: ERROR_CODES.INVITE_EXPIRED, message: 'Invite has expired' })
      }
      if (inv.acceptedAt) {
        throw new HttpError({ status: 410, code: ERROR_CODES.INVITE_ALREADY_ACCEPTED, message: 'Invite already accepted' })
      }
      const user = fakeUsers[userId]
      if (user && inv.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new HttpError({ status: 403, code: ERROR_CODES.INVITE_EMAIL_MISMATCH, message: 'Invite email does not match your account' })
      }
      inv.acceptedAt = new Date().toISOString()
      inviteDb.set(inviteId, inv)
      const wsMembers = memberDb.get(wsId) ?? new Map()
      wsMembers.set(userId, inv.role)
      memberDb.set(wsId, wsMembers)
      const member: WorkspaceMember = {
        workspaceId: wsId,
        userId,
        role: inv.role,
        createdAt: new Date().toISOString(),
      }
      return { invite: inv, member }
    },
    incrementInviteFailedAttempts: async (inviteId: string) => {
      const inv = inviteDb.get(inviteId)
      if (!inv) return { failedAttempts: 0, lockedUntil: null }
      inv.failedAttempts = (inv.failedAttempts ?? 0) + 1
      if (inv.failedAttempts >= 50) {
        inv.lockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
      inviteDb.set(inviteId, inv)
      return { failedAttempts: inv.failedAttempts, lockedUntil: inv.lockedUntil }
    },
    resetInviteFailedAttempts: async (inviteId: string) => {
      const inv = inviteDb.get(inviteId)
      if (!inv) return
      inv.failedAttempts = 0
      inv.lockedUntil = null
      inviteDb.set(inviteId, inv)
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

function seedInvite(wsId: string, email: string, role: MemberRole, opts?: { expired?: boolean; accepted?: boolean; locked?: boolean }) {
  const id = `inv-${nextInviteId++}`
  const rawToken = `raw-token-${id}`
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const invite: WorkspaceInvite = {
    id,
    workspaceId: wsId,
    email,
    tokenHash,
    role,
    expiresAt: opts?.expired
      ? new Date(Date.now() - 1000).toISOString()
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: opts?.accepted ? new Date().toISOString() : null,
    createdBy: OWNER_ID,
    createdAt: new Date().toISOString(),
    failedAttempts: opts?.locked ? 50 : 0,
    lockedUntil: opts?.locked ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
  }
  inviteDb.set(id, invite)
  inviteTokens.set(id, rawToken)
  return { invite, rawToken }
}

let app: FastifyInstance

beforeAll(async () => {
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
      const user = fakeUsers[userId]
      request.user = user
        ? { id: user.id, email: user.email, name: user.name, emailVerified: true }
        : { id: userId, email: `${userId}@test.dev`, name: null, emailVerified: true }
    } else {
      request.user = null
    }
  })

  await app.register(registerInviteRoutes)
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

describe('GET /api/v1/workspaces/:id/invites', () => {
  it('returns invites for workspace members', async () => {
    const ws = seedWorkspace(OWNER_ID)
    seedInvite(ws.id, 'a@test.dev', 'editor')
    seedInvite(ws.id, 'b@test.dev', 'viewer')

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}/invites`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json().invites).toHaveLength(2)
  })

  it('non-member → 403', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('GET', `/api/v1/workspaces/${ws.id}/invites`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })
})

describe('POST /api/v1/workspaces/:id/invites', () => {
  it('owner creates invite → 201 with warning when mail disabled', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/invites`, OWNER_ID, {
      email: 'new@test.dev',
      role: 'editor',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.invite.email).toBe('new@test.dev')
    expect(body.invite.role).toBe('editor')
    expect(body.invite.workspaceId).toBe(ws.id)
    expect(body.invite.createdBy).toBe(OWNER_ID)
    expect(body.warning).toBe('mail_disabled')
  })

  it('editor → 403 forbidden', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/invites`, EDITOR_ID, {
      email: 'new@test.dev',
      role: 'viewer',
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('rejects invalid email', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/invites`, OWNER_ID, {
      email: 'not-an-email',
      role: 'editor',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects invalid role', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/invites`, OWNER_ID, {
      email: 'new@test.dev',
      role: 'superadmin',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('rejects extra fields in body', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('POST', `/api/v1/workspaces/${ws.id}/invites`, OWNER_ID, {
      email: 'new@test.dev',
      role: 'editor',
      extra: 'field',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })
})

describe('POST /api/v1/workspaces/:id/invites/:inviteId/accept', () => {
  it('accepts a valid invite', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.invite.acceptedAt).toBeTruthy()
    expect(body.member.userId).toBe(INVITEE_ID)
    expect(body.member.role).toBe('editor')
  })

  it('401 when not authenticated', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'someone@test.dev', 'viewer')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
    )
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('unauthorized')
  })

  it('400 when invite_token is missing', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('validation_failed')
  })

  it('404 when token does not match', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=wrong-token`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('invite_not_found')
  })

  it('404 when invite belongs to different workspace', async () => {
    const ws1 = seedWorkspace(OWNER_ID)
    const ws2 = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws1.id, 'invitee@test.dev', 'editor')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws2.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('invite_not_found')
  })

  it('410 when invite is expired', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { expired: true })

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(410)
    expect(res.json().code).toBe('invite_expired')
  })

  it('410 when invite is already accepted', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { accepted: true })

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(410)
    expect(res.json().code).toBe('invite_already_accepted')
  })

  it('403 when email does not match', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'someone-else@test.dev', 'editor')

    const res = await inject(
      'POST',
      `/api/v1/workspaces/${ws.id}/invites/${invite.id}/accept?invite_token=${rawToken}`,
      INVITEE_ID,
    )
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('invite_email_mismatch')
  })
})

describe('DELETE /api/v1/workspaces/:id/invites/:inviteId', () => {
  it('owner revokes invite → 200', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite } = seedInvite(ws.id, 'a@test.dev', 'editor')

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/invites/${invite.id}`, OWNER_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ revoked: true })
  })

  it('404 when invite does not exist', async () => {
    const ws = seedWorkspace(OWNER_ID)

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/invites/inv-nonexistent`, OWNER_ID)
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('not_found')
  })

  it('editor → 403 forbidden', async () => {
    const ws = seedWorkspace(OWNER_ID, { [EDITOR_ID]: 'editor' })
    const { invite } = seedInvite(ws.id, 'a@test.dev', 'viewer')

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/invites/${invite.id}`, EDITOR_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
  })

  it('non-member → 403 not_member', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite } = seedInvite(ws.id, 'a@test.dev', 'editor')

    const res = await inject('DELETE', `/api/v1/workspaces/${ws.id}/invites/${invite.id}`, NON_MEMBER_ID)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('not_member')
  })
})

describe('POST /api/v1/invites/resolve', () => {
  it('returns workspace info for valid token', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject('POST', '/api/v1/invites/resolve', undefined, { token: rawToken })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.workspaceName).toBe('Test WS')
    expect(body.role).toBe('editor')
    expect(body.expiresAt).toBeDefined()
  })

  it('404 on invalid token', async () => {
    const res = await inject('POST', '/api/v1/invites/resolve', undefined, { token: 'bogus-token' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('invite_not_found')
  })

  it('404 on expired invite (increments failed_attempts)', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { expired: true })

    const res = await inject('POST', '/api/v1/invites/resolve', undefined, { token: rawToken })
    expect(res.statusCode).toBe(404)
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(1)
  })

  it('404 on already-accepted invite (increments failed_attempts)', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { accepted: true })

    const res = await inject('POST', '/api/v1/invites/resolve', undefined, { token: rawToken })
    expect(res.statusCode).toBe(404)
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(1)
  })

  it('423 on locked token', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { locked: true })

    const res = await inject('POST', '/api/v1/invites/resolve', undefined, { token: rawToken })
    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('invite_locked')
  })

  it('400 on missing token', async () => {
    const res = await inject('POST', '/api/v1/invites/resolve', undefined, {})
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/invites/accept', () => {
  it('accept happy path: member created, invite accepted', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.member.userId).toBe(INVITEE_ID)
    expect(body.member.role).toBe('editor')
    expect(body.workspace.id).toBe(ws.id)
  })

  it('401 when not authenticated', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor')

    const res = await inject('POST', '/api/v1/invites/accept', undefined, { token: rawToken })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('unauthorized')
  })

  it('404 on invalid token', async () => {
    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: 'bogus' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('invite_not_found')
  })

  it('409 on already-accepted invite (increments failed_attempts)', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { accepted: true })

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('invite_already_accepted')
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(1)
  })

  it('410 on expired invite (increments failed_attempts)', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { expired: true })

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(410)
    expect(res.json().code).toBe('invite_expired')
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(1)
  })

  it('403 on email mismatch (increments failed_attempts)', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'wrong@test.dev', 'editor')

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('invite_email_mismatch')
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(1)
  })

  it('423 on locked token', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor', { locked: true })

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(423)
    expect(res.json().code).toBe('invite_locked')
  })

  it('lockout at 50 failed attempts', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'wrong@test.dev', 'editor')

    for (let i = 0; i < 49; i++) {
      inviteDb.get(invite.id)!.failedAttempts = i
      await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    }
    inviteDb.get(invite.id)!.failedAttempts = 49
    await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })

    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(50)
    expect(inviteDb.get(invite.id)?.lockedUntil).toBeTruthy()

    const lockedRes = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(lockedRes.statusCode).toBe(423)
    expect(lockedRes.json().code).toBe('invite_locked')
  })

  it('successful accept resets failed_attempts', async () => {
    const ws = seedWorkspace(OWNER_ID)
    const { invite, rawToken } = seedInvite(ws.id, 'invitee@test.dev', 'editor')
    inviteDb.get(invite.id)!.failedAttempts = 10

    const res = await inject('POST', '/api/v1/invites/accept', INVITEE_ID, { token: rawToken })
    expect(res.statusCode).toBe(200)
    expect(inviteDb.get(invite.id)?.failedAttempts).toBe(0)
  })
})

describe('POST /api/v1/invites/accept email-verification guard', () => {
  // Invite acceptance binds membership by email match, so when verification is
  // enabled the caller must have a verified email — a claimed outreach lead
  // (exempt from the authHook wall for workspace access) must not accept an
  // email-keyed invite unverified. The guard runs before store access.
  async function buildApp(mailEnabled: boolean, emailVerified: boolean): Promise<FastifyInstance> {
    const app = Fastify({ logger: false })
    app.decorate('config', {
      appId: APP_ID,
      auth: {
        url: 'http://localhost:3000',
        ...(mailEnabled ? { mail: { transportUrl: 'console://', from: 'no@reply.test' } } : {}),
      },
      features: { inviteTtlDays: 7 },
    } as any)
    app.decorate('workspaceStore', mockWorkspaceStore())
    registerErrorHandler(app)
    app.addHook('onRequest', async (request) => {
      request.user = { id: INVITEE_ID, email: 'invitee@test.dev', name: null, emailVerified }
    })
    await app.register(registerInviteRoutes)
    await app.ready()
    return app
  }

  it('unverified caller with verification enabled → 403 email_not_verified', async () => {
    const app = await buildApp(true, false)
    const res = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token: 'anything' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe(ERROR_CODES.EMAIL_NOT_VERIFIED)
    await app.close()
  })

  it('verified caller with verification enabled passes the guard', async () => {
    const app = await buildApp(true, true)
    const res = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token: 'anything' } })
    // Past the guard → fails on the unknown token, not on verification.
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe(ERROR_CODES.INVITE_NOT_FOUND)
    await app.close()
  })

  it('unverified caller with verification disabled passes the guard', async () => {
    const app = await buildApp(false, false)
    const res = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token: 'anything' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe(ERROR_CODES.INVITE_NOT_FOUND)
    await app.close()
  })
})
