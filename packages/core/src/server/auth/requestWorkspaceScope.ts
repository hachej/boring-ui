import type { FastifyRequest } from 'fastify'
import type { MemberRole, Workspace } from '../../shared/types.js'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'

const ROLE_LEVELS: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
}

export const REQUEST_SCOPE_WORKSPACE_HEADER = 'x-boring-internal-request-workspace'

export async function authorizeRequestScopedWorkspace(
  request: FastifyRequest,
  workspaceId: unknown,
  minimumRole?: MemberRole,
): Promise<Workspace | null> {
  const scope = request.requestScope
  if (!scope) return null

  if (workspaceId !== scope.workspaceId) {
    throw new HttpError({
      status: 421,
      code: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
      message: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
      requestId: request.id,
    })
  }

  const role = await request.server.workspaceStore.getMemberRole(scope.workspaceId, request.user!.id)
  if (!role) {
    throw new HttpError({
      status: 403,
      code: ERROR_CODES.NOT_MEMBER,
      message: 'Not a member of this workspace',
      requestId: request.id,
    })
  }
  if (minimumRole && ROLE_LEVELS[role] < ROLE_LEVELS[minimumRole]) {
    throw new HttpError({
      status: 403,
      code: ERROR_CODES.FORBIDDEN,
      message: `Requires ${minimumRole} role or higher`,
      requestId: request.id,
    })
  }

  const workspace = await request.server.workspaceStore.get(scope.workspaceId)
  if (!workspace || workspace.appId !== request.server.config.appId) {
    throw new HttpError({
      status: 421,
      code: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
      message: ERROR_CODES.AGENT_HOST_SCOPE_VIOLATION,
      requestId: request.id,
    })
  }
  return workspace
}
