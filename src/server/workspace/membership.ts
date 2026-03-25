/**
 * Workspace membership helpers — access control for workspace-scoped routes.
 * Mirrors Python's membership.py.
 */
import type { Sql } from 'postgres'

export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export class WorkspaceNotFoundError extends Error {
  code = 'WORKSPACE_NOT_FOUND' as const
  statusCode = 404 as const
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} not found`)
    this.name = 'WorkspaceNotFoundError'
  }
}

export class NotAMemberError extends Error {
  code = 'NOT_A_MEMBER' as const
  statusCode = 403 as const
  constructor() {
    super('You are not a member of this workspace')
    this.name = 'NotAMemberError'
  }
}

/**
 * Require that a user is a member of a workspace.
 * @throws WorkspaceNotFoundError if workspace doesn't exist
 * @throws NotAMemberError if user is not a member
 * @returns The user's role in the workspace
 */
export async function requireMembership(
  sql: Sql,
  workspaceId: string,
  userId: string,
  appId: string = 'boring-ui',
): Promise<MemberRole> {
  const rows = await sql`
    SELECT wm.role
    FROM workspaces w
    LEFT JOIN workspace_members wm
      ON wm.workspace_id = w.id AND wm.user_id = ${userId}::uuid
    WHERE w.id = ${workspaceId}::uuid
      AND w.app_id = ${appId}
      AND w.deleted_at IS NULL
  `

  if (rows.length === 0) {
    throw new WorkspaceNotFoundError(workspaceId)
  }

  const role = rows[0].role
  if (!role) {
    throw new NotAMemberError()
  }

  return role as MemberRole
}
