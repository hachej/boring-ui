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
      const provisioner = app.provisioner

      const runtime = await store.getWorkspaceRuntime(id)
      if (!runtime || !provisioner) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.RUNTIME_UNMANAGED,
          message: 'No managed runtime for this workspace',
          requestId: request.id,
        })
      }

      if (runtime.state !== 'error' || runtime.lastErrorOp !== 'provision') {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.INVALID_RETRY_STATE,
          message: 'Runtime must be in error state with last_error_op=provision to retry',
          requestId: request.id,
        })
      }

      await store.putWorkspaceRuntime(id, { state: 'pending', lastError: null, lastErrorOp: null })

      try {
        const ws = await store.get(id)
        const result = await provisioner.provision({
          workspaceId: id,
          workspaceName: ws?.name ?? id,
          ownerId: request.user!.id,
          appId: app.config.appId,
        })
        const updated = await store.putWorkspaceRuntime(id, {
          state: 'ready',
          volumePath: result.volumePath,
        })
        request.log.info({ workspaceId: id }, 'workspace.provision.retry.success')
        return { runtime: updated }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await store.putWorkspaceRuntime(id, {
          state: 'error',
          lastError: message,
          lastErrorOp: 'provision',
        })
        request.log.error({ workspaceId: id, err }, 'workspace.provision.retry.failed')
        throw new HttpError({
          status: 500,
          code: ERROR_CODES.PROVISION_FAILED,
          message: 'Workspace provisioning failed',
          requestId: request.id,
        })
      }
    },
  )
}

export const registerSettingsRoutes = fp(settingsRoutesPlugin, { name: 'settings-routes' })
