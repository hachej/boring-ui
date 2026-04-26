import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { z } from 'zod'
import type postgres from 'postgres'
import { buildRuntimeConfigPayload } from '../config/loadConfig.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { deleteUserCompletely } from '../auth/deleteUserCompletely.js'
import type { Database } from '../db/connection.js'
import type { UserStore, WorkspaceStore } from './types.js'

export interface RoutesOptions {
  sql?: postgres.Sql
  db?: Database
  userStore: UserStore
  workspaceStore?: WorkspaceStore
}

const HEALTH_DB_TIMEOUT_MS = 2_000

async function pingDatabase(
  sqlClient: postgres.Sql,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const timeoutMessage = `Database ping timed out after ${timeoutMs}ms`
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      sqlClient`SELECT 1`,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      }),
    ])
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && error.message.length > 0) {
      return { ok: false, message: error.message }
    }
    return { ok: false, message: 'Database ping failed' }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const updateSettingsBody = z
  .object({
    displayName: z.string().optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict()

const deleteMeBody = z
  .object({
    confirm: z.string().optional(),
  })
  .optional()

function toHeaders(
  source: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value[0] : value)
  }
  return headers
}

const routesPlugin: FastifyPluginAsync<RoutesOptions> = async (app, opts) => {
  const { sql, db, userStore } = opts

  app.get('/health', async (request, reply) => {
    if (sql) {
      const result = await pingDatabase(sql, HEALTH_DB_TIMEOUT_MS)
      if (!result.ok) {
        reply.status(503)
        return {
          error: 'db_unavailable',
          code: ERROR_CODES.DB_UNAVAILABLE,
          message: result.message,
          requestId: request.id,
        }
      }
    }
    return { ok: true }
  })

  app.get('/api/v1/config', async () => {
    return buildRuntimeConfigPayload(app.config)
  })

  app.get('/api/v1/me', async (request) => {
    const user = request.user!
    const settings = await userStore.getUserSettings(user.id, app.config.appId)
    return { user, settings }
  })

  app.put('/api/v1/me/settings', async (request, reply) => {
    const parsed = updateSettingsBody.safeParse(request.body)
    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId: request.id,
      })
    }

    const result = await userStore.putUserSettings(
      request.user!.id,
      app.config.appId,
      parsed.data,
    )
    reply.status(200)
    return result
  })

  app.delete('/api/v1/me', async (request, reply) => {
    const parsed = deleteMeBody.safeParse(request.body)
    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId: request.id,
      })
    }

    const user = request.user!
    if (!user.email || parsed.data?.confirm !== user.email) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'confirm must match the signed-in email',
        requestId: request.id,
      })
    }

    if (!db) {
      throw new HttpError({
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'DELETE /api/v1/me is not configured',
        requestId: request.id,
      })
    }

    const startedAt = Date.now()
    request.log.info(
      { event: 'user.delete.start', userId: user.id },
      'user.delete.start',
    )

    await deleteUserCompletely(user.id, { db })

    const signOutResponse = await (app.auth.api.signOut as (input: {
      headers: Headers
      asResponse: true
    }) => Promise<Response>)({
      headers: toHeaders(request.headers),
      asResponse: true,
    })

    const responseHeaders = signOutResponse.headers as Headers & {
      getSetCookie?: () => string[]
    }
    const setCookies = typeof responseHeaders.getSetCookie === 'function'
      ? responseHeaders.getSetCookie()
      : responseHeaders.get('set-cookie')
        ? [responseHeaders.get('set-cookie') as string]
        : []
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies.length === 1 ? setCookies[0] : setCookies)
    }

    request.log.info(
      {
        event: 'user.delete.complete',
        userId: user.id,
        durationMs: Date.now() - startedAt,
      },
      'user.delete.complete',
    )

    reply.status(200)
    return { deleted: true }
  })
}

export const registerRoutes = fp(routesPlugin, { name: 'core-routes' })
