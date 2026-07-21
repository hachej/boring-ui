import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { authorizeRequestScopedWorkspace } from '../auth/requestWorkspaceScope.js'
import { assertWorkspaceTypeIdNotMutable } from '../workspaceType.js'
import { createWorkspaceBody, updateWorkspaceBody } from './__schemas__/workspaces.js'

const DEFAULT_WORKSPACE_NAME = 'Default workspace'
const COMPANY_CONTEXT_WORKSPACE_MANAGED_BY = 'company-context'

const workspaceRoutesPlugin: FastifyPluginAsync = async (app) => {
  const store = app.workspaceStore
  const provisioner = app.provisioner
  const defaultWorkspaceCreates = new Map<string, Promise<Awaited<ReturnType<typeof store.list>>>>()

  async function provisionWorkspace(workspace: Awaited<ReturnType<typeof store.create>>, ownerId: string, request: FastifyRequest) {
    if (!provisioner) return
    await store.putWorkspaceRuntime(workspace.id, { state: 'pending' })
    try {
      const result = await provisioner.provision({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ownerId,
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

  async function createWorkspaceForUser(userId: string, name: string, isDefault: boolean, request: FastifyRequest) {
    const workspace = await store.create(userId, name, app.config.appId, { isDefault })
    await provisionWorkspace(workspace, userId, request)
    return workspace
  }

  async function ensureDefaultWorkspaceProvisioned(workspace: Awaited<ReturnType<typeof store.create>>, request: FastifyRequest) {
    if (!provisioner || !workspace.isDefault) return
    const runtime = await store.getWorkspaceRuntime(workspace.id)
    const needsProvisioning = !runtime || (runtime.state === 'ready' && !runtime.volumePath)
    if (needsProvisioning) await provisionWorkspace(workspace, workspace.createdBy, request)
  }

  async function listOrCreateDefaultWorkspace(userId: string, request: FastifyRequest) {
    const existing = await store.list(userId, app.config.appId)
    if (existing.length > 0) {
      await Promise.all(existing.map((workspace) => ensureDefaultWorkspaceProvisioned(workspace, request)))
      return existing
    }

    const createKey = `${app.config.appId}:${userId}`
    const inFlight = defaultWorkspaceCreates.get(createKey)
    if (inFlight) return await inFlight

    const createPromise = (async () => {
      try {
        const created = await createWorkspaceForUser(userId, DEFAULT_WORKSPACE_NAME, true, request)
        return [created]
      } catch (error) {
        if (error instanceof HttpError) throw error
        const racedExisting = await store.list(userId, app.config.appId)
        if (racedExisting.length > 0) return racedExisting
        throw error
      }
    })()
    defaultWorkspaceCreates.set(createKey, createPromise)
    try {
      return await createPromise
    } finally {
      if (defaultWorkspaceCreates.get(createKey) === createPromise) defaultWorkspaceCreates.delete(createKey)
    }
  }

  app.post('/api/v1/workspaces', async (request, reply) => {
    if (request.productScope) {
      throw new HttpError({
        status: 403,
        code: ERROR_CODES.TYPED_WORKSPACE_CREATION_NOT_AVAILABLE,
        message: 'Typed Workspace creation is not available until the authorized create flow is installed',
        requestId: request.id,
      })
    }
    if (request.requestScope) {
      throw new HttpError({
        status: 403,
        code: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
        message: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
        requestId: request.id,
      })
    }
    assertWorkspaceTypeIdNotMutable(request.body, request.id)
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

    const workspace = await createWorkspaceForUser(user.id, parsed.data.name, isDefault, request)

    request.log.info({ workspaceId: workspace.id, userId: user.id }, 'workspace.create')
    reply.status(201)
    return { workspace, role: 'owner' as const }
  })

  app.get('/api/v1/workspaces', async (request) => {
    const requestScopedWorkspace = await authorizeRequestScopedWorkspace(request, request.requestScope?.workspaceId)
    if (requestScopedWorkspace) return { workspaces: [requestScopedWorkspace] }
    if (request.productScope) {
      // C2 replaces this unfiltered, non-creating compatibility read with typed
      // membership selection. C1 must never manufacture a default Workspace.
      return { workspaces: await store.list(request.user!.id, app.config.appId) }
    }
    const workspaces = await listOrCreateDefaultWorkspace(request.user!.id, request)
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
      assertWorkspaceTypeIdNotMutable(request.body, request.id)
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

      if (request.requestScope) {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
          message: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
          requestId: request.id,
        })
      }

      request.log.info({ workspaceId: id }, 'workspace.delete.start')

      const workspace = await store.get(id)
      if (!workspace) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
          requestId: request.id,
        })
      }
      if (workspace.managedBy === COMPANY_CONTEXT_WORKSPACE_MANAGED_BY) {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.FORBIDDEN,
          message: 'Managed workspace cannot be deleted',
          requestId: request.id,
        })
      }

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
