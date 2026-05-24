import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { createWorkspaceBody, updateWorkspaceBody } from './__schemas__/workspaces.js'

const DEFAULT_WORKSPACE_NAME = 'My Workspace'

const workspaceRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore
  const provisioner = app.provisioner

  async function listOrCreateDefaultWorkspace(userId: string) {
    const existing = await store.list(userId, app.config.appId)
    if (existing.length > 0) return existing
    const created = await store.create(userId, DEFAULT_WORKSPACE_NAME, app.config.appId, {
      isDefault: true,
    })
    return [created]
  }

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

    if (provisioner) {
      await store.putWorkspaceRuntime(workspace.id, { state: 'pending' })
      try {
        const result = await provisioner.provision({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          ownerId: user.id,
          appId: app.config.appId,
        })
        await store.putWorkspaceRuntime(workspace.id, {
          state: 'ready',
          volumePath: result.volumePath,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await store.putWorkspaceRuntime(workspace.id, {
          state: 'error',
          lastError: message,
          lastErrorOp: 'provision',
        })
        request.log.error({ workspaceId: workspace.id, err }, 'workspace.provision.failed')
        throw new HttpError({
          status: 500,
          code: ERROR_CODES.PROVISION_FAILED,
          message: 'Workspace provisioning failed',
          requestId: request.id,
        })
      }
    }

    request.log.info({ workspaceId: workspace.id, userId: user.id }, 'workspace.create')
    reply.status(201)
    return { workspace, role: 'owner' as const }
  })

  app.get('/api/v1/workspaces', async (request) => {
    const workspaces = await listOrCreateDefaultWorkspace(request.user!.id)
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

      if (provisioner) {
        try {
          await provisioner.destroy(id)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await store.putWorkspaceRuntime(id, {
            state: 'error',
            lastError: message,
            lastErrorOp: 'destroy',
          })
          request.log.error({ workspaceId: id, err }, 'workspace.destroy.failed')
          throw new HttpError({
            status: 500,
            code: ERROR_CODES.DESTROY_FAILED,
            message: 'Workspace destruction failed',
            requestId: request.id,
          })
        }
      }

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
