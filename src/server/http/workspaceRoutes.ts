/**
 * Workspace HTTP routes — CRUD, settings (pgp_sym_encrypt), runtime state.
 * Mirrors Python's workspace_router_hosted.py.
 *
 * All routes require authentication via session cookie.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { appCookieName } from '../auth/session.js'

// Simple session extraction (full auth port in bd-rwy92.4)
async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cookieName = appCookieName()
  const token = request.cookies[cookieName]

  if (!token) {
    reply.code(401).send({
      error: 'unauthorized',
      code: 'SESSION_REQUIRED',
      message: 'Authentication required',
    })
    return
  }

  // Full JWT verification will be in bd-rwy92.4.
  // For now, just check that a cookie exists.
  // The session parsing will be plugged in when auth is ported.
  try {
    // Minimal JWT decode (no verification — placeholder)
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT format')
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    )
    request.sessionUserId = payload.sub
    request.sessionEmail = payload.email
  } catch {
    reply.code(401).send({
      error: 'unauthorized',
      code: 'INVALID_SESSION',
      message: 'Invalid session',
    })
  }
}

// UUID format validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value)
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Auth hook for all routes in this plugin
  app.addHook('onRequest', requireSession)

  // --- LIST WORKSPACES ---
  app.get('/workspaces', async (request, reply) => {
    if (!request.sessionUserId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    // DB query will be added when database is available (bd-fus66)
    // For now, return empty list (satisfies the route contract)
    return {
      ok: true,
      workspaces: [],
      count: 0,
    }
  })

  // --- CREATE WORKSPACE ---
  app.post('/workspaces', async (request, reply) => {
    if (!request.sessionUserId) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const body = request.body as { name?: string } | null
    const name =
      body?.name?.trim() ||
      `Workspace ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

    if (name.length > 100) {
      return reply.code(400).send({
        error: 'validation',
        code: 'WORKSPACE_NAME_TOO_LONG',
        message: 'Workspace name must be 100 characters or less',
      })
    }

    // DB insert will be added when database is available (bd-fus66)
    // For now, return a placeholder response
    const workspaceId = crypto.randomUUID()
    reply.code(201)
    return {
      ok: true,
      workspace: {
        id: workspaceId,
        workspace_id: workspaceId,
        app_id: app.config.controlPlaneAppId,
        name,
        created_by: request.sessionUserId,
        machine_id: null,
        volume_id: null,
        fly_region: null,
      },
    }
  })

  // --- GET WORKSPACE RUNTIME ---
  app.get<{ Params: { id: string } }>(
    '/workspaces/:id/runtime',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      // DB query will be added when database is available
      return {
        ok: true,
        runtime: {
          workspace_id: id,
          state: 'pending',
          status: 'pending',
          sprite_url: null,
          sprite_name: null,
          last_error: null,
          updated_at: new Date().toISOString(),
          retryable: false,
        },
      }
    },
  )

  // --- UPDATE WORKSPACE ---
  app.patch<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      const body = request.body as { name?: string } | null
      if (!body?.name?.trim()) {
        return reply.code(400).send({
          error: 'validation',
          code: 'NAME_REQUIRED',
          message: 'Workspace name is required',
        })
      }

      if (body.name.length > 100) {
        return reply.code(400).send({
          error: 'validation',
          code: 'WORKSPACE_NAME_TOO_LONG',
          message: 'Workspace name must be 100 characters or less',
        })
      }

      // DB update will be added when database is available
      return {
        ok: true,
        workspace: {
          id,
          workspace_id: id,
          name: body.name,
        },
      }
    },
  )

  // --- DELETE WORKSPACE ---
  app.delete<{ Params: { id: string } }>(
    '/workspaces/:id',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      // DB soft-delete will be added when database is available
      return { ok: true, deleted: true }
    },
  )

  // --- GET WORKSPACE SETTINGS ---
  app.get<{ Params: { id: string } }>(
    '/workspaces/:id/settings',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      // DB query will be added when database is available
      return { ok: true, settings: {} }
    },
  )

  // --- UPDATE WORKSPACE SETTINGS ---
  app.put<{ Params: { id: string } }>(
    '/workspaces/:id/settings',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      const body = request.body as Record<string, string> | null
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          error: 'validation',
          code: 'SETTINGS_REQUIRED',
          message: 'Request body must be an object with key-value settings',
        })
      }

      const keys = Object.keys(body)
      if (keys.length > 50) {
        return reply.code(400).send({
          error: 'validation',
          code: 'TOO_MANY_SETTINGS',
          message: 'Maximum 50 settings per request',
        })
      }

      for (const key of keys) {
        if (!key || key.length > 128) {
          return reply.code(400).send({
            error: 'validation',
            code: 'INVALID_SETTING_KEY',
            message: `Setting key must be 1-128 characters: ${key}`,
          })
        }
        if (typeof body[key] !== 'string' || !body[key]) {
          return reply.code(400).send({
            error: 'validation',
            code: 'INVALID_SETTING_VALUE',
            message: `Setting value must be a non-empty string for key: ${key}`,
          })
        }
      }

      // Validate encryption key is configured
      if (!app.config.settingsKey) {
        return reply.code(500).send({
          error: 'server_error',
          code: 'SETTINGS_KEY_NOT_CONFIGURED',
          message: 'Settings encryption key not configured',
        })
      }

      // DB upsert with pgp_sym_encrypt will be added when database is available
      return { ok: true, settings: body }
    },
  )

  // --- RETRY WORKSPACE RUNTIME ---
  app.post<{ Params: { id: string } }>(
    '/workspaces/:id/runtime/retry',
    async (request, reply) => {
      if (!request.sessionUserId) {
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const { id } = request.params
      if (!isValidUUID(id)) {
        return reply.code(400).send({
          error: 'validation',
          code: 'INVALID_WORKSPACE_ID',
          message: 'Invalid workspace ID format',
        })
      }

      // DB update will be added when database is available
      return {
        ok: true,
        runtime: {
          workspace_id: id,
          state: 'pending',
          status: 'pending',
          retryable: false,
        },
        retried: true,
      }
    },
  )
}
