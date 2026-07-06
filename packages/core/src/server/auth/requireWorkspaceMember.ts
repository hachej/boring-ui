import type { preHandlerHookHandler } from 'fastify'
import type { MemberRole } from '../../shared/types.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { isWorkspaceRoleAtLeast } from './workspaceRoles.js'

const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

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

    if (!WORKSPACE_ID_RE.test(workspaceId)) {
      throw new HttpError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Invalid workspace id',
        requestId: request.id,
      })
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

    if (minimumRole && !isWorkspaceRoleAtLeast(role, minimumRole)) {
      throw new HttpError({
        status: 403,
        code: ERROR_CODES.FORBIDDEN,
        message: `Requires ${minimumRole} role or higher`,
        requestId: request.id,
      })
    }
  }
}
