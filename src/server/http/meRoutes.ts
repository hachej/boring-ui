/**
 * User identity routes — GET /api/v1/me, GET/PUT /api/v1/me/settings.
 * Mirrors Python's me_router_neon.py.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  parseSessionCookie,
  appCookieName,
  SessionExpiredError,
} from '../auth/session.js'

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cookieName = appCookieName()
  const token = request.cookies[cookieName]
  const secret = request.server.config.sessionSecret

  if (!token) {
    reply.code(401).send({
      error: 'unauthorized',
      code: 'SESSION_REQUIRED',
      message: 'Authentication required',
    })
    return
  }

  try {
    const session = await parseSessionCookie(token, secret)
    request.sessionUserId = session.user_id
    request.sessionEmail = session.email
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      reply.code(401).send({
        error: 'unauthorized',
        code: 'SESSION_EXPIRED',
        message: 'Session has expired',
      })
      return
    }
    reply.code(401).send({
      error: 'unauthorized',
      code: 'INVALID_SESSION',
      message: 'Invalid session',
    })
  }
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  // Auth hook for all routes in this plugin
  app.addHook('onRequest', requireSession)

  // GET /me — current user info
  app.get('/me', async (request) => {
    return {
      ok: true,
      user: {
        id: request.sessionUserId,
        email: request.sessionEmail,
        display_name: request.sessionEmail?.split('@')[0] || 'User',
      },
    }
  })

  // GET /me/settings — user settings
  app.get('/me/settings', async (request) => {
    // DB query will be added when database is available (bd-fus66)
    return {
      ok: true,
      settings: {},
      display_name: request.sessionEmail?.split('@')[0] || 'User',
    }
  })

  // PUT /me/settings — update user settings
  app.put('/me/settings', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return reply.code(400).send({
        error: 'validation',
        message: 'Request body must be an object',
      })
    }

    // DB upsert will be added when database is available
    return {
      ok: true,
      settings: body,
    }
  })
}
