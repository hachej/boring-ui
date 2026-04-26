import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { putSettingsBody } from './__schemas__/settings.js'

const settingsRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore

  app.get(
    '/api/v1/workspaces/:id/settings',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const settings = await store.getWorkspaceSettings(id)
      return { settings }
    },
  )

  app.put(
    '/api/v1/workspaces/:id/settings',
    { preHandler: requireWorkspaceMember('editor') },
    async (request) => {
      const { id } = request.params as { id: string }
      const parsed = putSettingsBody.safeParse(request.body)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: request.id,
        })
      }

      const settings = await store.putWorkspaceSettings(id, parsed.data)
      return { settings }
    },
  )

  app.get(
    '/api/v1/workspaces/:id/runtime',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const runtime = await store.getWorkspaceRuntime(id)
      if (!runtime) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
          requestId: request.id,
        })
      }
      return { runtime }
    },
  )

  app.post(
    '/api/v1/workspaces/:id/runtime/retry',
    { preHandler: requireWorkspaceMember('owner') },
    async (request) => {
      const { id } = request.params as { id: string }
      const runtime = await store.retryWorkspaceRuntime(id)
      if (!runtime) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Workspace runtime is not in error state',
          requestId: request.id,
        })
      }
      return { runtime }
    },
  )
}

export const registerSettingsRoutes = fp(settingsRoutesPlugin, { name: 'settings-routes' })
