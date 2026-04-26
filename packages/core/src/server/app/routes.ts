import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { z } from 'zod'
import type postgres from 'postgres'
import { buildRuntimeConfigPayload } from '../config/loadConfig.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import type { UserStore } from './types.js'

export interface RoutesOptions {
  sql?: postgres.Sql
  userStore: UserStore
}

const updateSettingsBody = z
  .object({
    displayName: z.string().optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict()

const routesPlugin: FastifyPluginAsync<RoutesOptions> = async (app, opts) => {
  const { sql, userStore } = opts

  app.get('/health', async (_request, reply) => {
    if (sql) {
      try {
        await sql`SELECT 1`
      } catch {
        reply.status(503)
        return { error: 'Database unreachable', code: ERROR_CODES.DB_UNAVAILABLE }
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
}

export const registerRoutes = fp(routesPlugin, { name: 'core-routes' })
