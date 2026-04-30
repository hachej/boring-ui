import type { preHandlerHookHandler } from 'fastify'
import type { MemberRole } from '../../shared/types.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'

const ROLE_LEVELS: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
}

export function requireWorkspaceMember(
  minimumRole?: MemberRole,
): preHandlerHookHandler {
  return async function (request, _reply) {
    const user = request.user
    if (!user) {
      throw new Error(
        'requireWorkspaceMember: request.user is null — authHook must run before this hook',
      )
    }

    const workspaceId = (request.params as { id?: string }).id
    if (!workspaceId) {
      throw new Error(
        'requireWorkspaceMember: missing :id param — route must include :id',
      )
    }

    const workspace = await request.server.workspaceStore.get(workspaceId)
    if (!workspace || workspace.appId !== request.server.config.appId) {
      throw new HttpError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Workspace not found',
        requestId: request.id,
      })
    }

    const role = await request.server.workspaceStore.getMemberRole(
      workspaceId,
      user.id,
    )

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
  }
}
