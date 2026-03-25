/**
 * Collaboration HTTP routes — workspace members + invites.
 * Mirrors Python's collaboration_router_hosted.py.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  parseSessionCookie,
  appCookieName,
  SessionExpiredError,
} from '../auth/session.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = ['owner', 'editor', 'viewer']

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[appCookieName()]
  const secret = request.server.config.sessionSecret
  if (!token) { reply.code(401).send({ error: 'unauthorized', code: 'SESSION_REQUIRED' }); return }
  try {
    const session = await parseSessionCookie(token, secret)
    request.sessionUserId = session.user_id
    request.sessionEmail = session.email
  } catch (err) {
    if (err instanceof SessionExpiredError) { reply.code(401).send({ error: 'unauthorized', code: 'SESSION_EXPIRED' }); return }
    reply.code(401).send({ error: 'unauthorized', code: 'INVALID_SESSION' })
  }
}

export async function registerCollaborationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireSession)

  // GET /workspaces/:id/members
  app.get<{ Params: { id: string } }>('/workspaces/:id/members', async (request, reply) => {
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'validation', code: 'INVALID_WORKSPACE_ID' })
    // DB query deferred
    return { ok: true, members: [], count: 0 }
  })

  // POST /workspaces/:id/members
  app.post<{ Params: { id: string } }>('/workspaces/:id/members', async (request, reply) => {
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'validation', code: 'INVALID_WORKSPACE_ID' })
    const body = request.body as { user_id?: string; role?: string } | null
    if (!body?.user_id || !UUID_RE.test(body.user_id)) {
      return reply.code(400).send({ error: 'validation', message: 'Valid user_id required' })
    }
    if (body.role && !VALID_ROLES.includes(body.role)) {
      return reply.code(400).send({ error: 'validation', message: `role must be: ${VALID_ROLES.join(', ')}` })
    }
    return { ok: true, member: { workspace_id: id, user_id: body.user_id, role: body.role || 'editor' } }
  })

  // DELETE /workspaces/:id/members/:userId
  app.delete<{ Params: { id: string; userId: string } }>('/workspaces/:id/members/:userId', async (request, reply) => {
    const { id, userId } = request.params
    if (!UUID_RE.test(id) || !UUID_RE.test(userId)) {
      return reply.code(400).send({ error: 'validation', code: 'INVALID_ID' })
    }
    return { ok: true, removed: true }
  })

  // GET /workspaces/:id/invites
  app.get<{ Params: { id: string } }>('/workspaces/:id/invites', async (request, reply) => {
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'validation', code: 'INVALID_WORKSPACE_ID' })
    return { ok: true, invites: [], count: 0 }
  })

  // POST /workspaces/:id/invites
  app.post<{ Params: { id: string } }>('/workspaces/:id/invites', async (request, reply) => {
    const { id } = request.params
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'validation', code: 'INVALID_WORKSPACE_ID' })
    const body = request.body as { email?: string; role?: string } | null
    if (!body?.email || !EMAIL_RE.test(body.email)) {
      return reply.code(400).send({ error: 'validation', message: 'Valid email required' })
    }
    if (body.role && !VALID_ROLES.includes(body.role)) {
      return reply.code(400).send({ error: 'validation', message: `role must be: ${VALID_ROLES.join(', ')}` })
    }
    const inviteId = crypto.randomUUID()
    return {
      ok: true,
      invite: {
        id: inviteId,
        workspace_id: id,
        email: body.email,
        role: body.role || 'editor',
        invited_by: request.sessionUserId,
      },
    }
  })

  // POST /workspaces/:id/invites/:inviteId/accept
  app.post<{ Params: { id: string; inviteId: string } }>(
    '/workspaces/:id/invites/:inviteId/accept',
    async (request, reply) => {
      const { id, inviteId } = request.params
      if (!UUID_RE.test(id) || !UUID_RE.test(inviteId)) {
        return reply.code(400).send({ error: 'validation', code: 'INVALID_ID' })
      }
      return { ok: true, accepted: true }
    },
  )

  // DELETE /workspaces/:id/invites/:inviteId
  app.delete<{ Params: { id: string; inviteId: string } }>(
    '/workspaces/:id/invites/:inviteId',
    async (request, reply) => {
      const { id, inviteId } = request.params
      if (!UUID_RE.test(id) || !UUID_RE.test(inviteId)) {
        return reply.code(400).send({ error: 'validation', code: 'INVALID_ID' })
      }
      return { ok: true, revoked: true }
    },
  )
}
