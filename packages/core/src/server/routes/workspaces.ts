import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { createWorkspaceBody, updateWorkspaceBody } from './__schemas__/workspaces.js'

const workspaceRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore

  app.post('/api/v1/workspaces', async (request, reply) => {
    const parsed = createWorkspaceBody.safeParse(request.body)
    if (!parsed.success) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        requestId: request.id,
      })
    }

    const user = request.user!
    const existing = await store.list(user.id, app.config.appId)
    const isDefault = existing.length === 0

    const workspace = await store.create(user.id, parsed.data.name, app.config.appId, { isDefault })

    request.log.info({ workspaceId: workspace.id, userId: user.id }, 'workspace.create')
    reply.status(201)
    return { workspace, role: 'owner' as const }
  })

  app.get('/api/v1/workspaces', async (request) => {
    const workspaces = await store.list(request.user!.id, app.config.appId)
    return { workspaces }
  })

  app.get(
    '/api/v1/workspaces/:id',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const workspace = await store.get(id)
      if (!workspace) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
          requestId: request.id,
        })
      }
      const role = await store.getMemberRole(id, request.user!.id)
      return { workspace, role }
    },
  )

  app.put(
    '/api/v1/workspaces/:id',
    { preHandler: requireWorkspaceMember('editor') },
    async (request) => {
      const { id } = request.params as { id: string }
      const parsed = updateWorkspaceBody.safeParse(request.body)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: request.id,
        })
      }

      if (Object.keys(parsed.data).length === 0) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'At least one field must be provided',
          requestId: request.id,
        })
      }

      const workspace = await store.update(id, parsed.data)
      if (!workspace) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
          requestId: request.id,
        })
      }

      request.log.info({ workspaceId: id }, 'workspace.update')
      return { workspace }
    },
  )

  app.delete(
    '/api/v1/workspaces/:id',
    { preHandler: requireWorkspaceMember('owner') },
    async (request) => {
      const { id } = request.params as { id: string }

      request.log.info({ workspaceId: id }, 'workspace.delete.start')
      const result = await store.delete(id)

      if (result.removed) {
        request.log.info({ workspaceId: id }, 'workspace.delete.complete')
        return { deleted: true }
      }

      throw new HttpError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Workspace not found',
        requestId: request.id,
      })
    },
  )
}

export const registerWorkspaceRoutes = fp(workspaceRoutesPlugin, { name: 'workspace-routes' })
