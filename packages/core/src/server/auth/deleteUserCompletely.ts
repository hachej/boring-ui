import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import type { UserStore, WorkspaceStore } from '../app/types.js'
import type { Database } from '../db/connection.js'
import {
  users,
  verification_tokens,
  workspaces,
  workspaceInvites,
  workspaceMembers,
} from '../db/schema.js'

export interface DeleteUserCompletelyDeps {
  db: Database
  userStore: UserStore
  workspaceStore: WorkspaceStore
}

async function deleteBetterAuthUser(
  userId: string,
  deps: Pick<DeleteUserCompletelyDeps, 'db' | 'userStore'>,
): Promise<void> {
  const user = await deps.userStore.getById(userId)

  if (user?.email) {
    await deps.db
      .delete(verification_tokens)
      .where(eq(verification_tokens.identifier, user.email))
  }

  await deps.db.delete(users).where(eq(users.id, userId))
}

export async function deleteUserCompletely(
  userId: string,
  deps: DeleteUserCompletelyDeps,
): Promise<void> {
  const soleOwnerWorkspaces =
    await deps.workspaceStore.getWorkspacesWhereSoleOwner(userId)

  if (soleOwnerWorkspaces.length > 0) {
    throw new HttpError({
      status: 409,
      code: ERROR_CODES.LAST_OWNER,
      message: `Transfer ownership of ${soleOwnerWorkspaces.length} workspace(s) before deleting your account.`,
    })
  }

  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE workspaces
      SET created_by = (
        SELECT wm.user_id
        FROM workspace_members AS wm
        WHERE wm.workspace_id = workspaces.id
          AND wm.user_id <> ${userId}
        ORDER BY
          CASE wm.role
            WHEN 'owner' THEN 0
            WHEN 'editor' THEN 1
            ELSE 2
          END,
          wm.created_at ASC
        LIMIT 1
      )
      WHERE workspaces.created_by = ${userId}
        AND EXISTS (
          SELECT 1
          FROM workspace_members AS wm
          WHERE wm.workspace_id = workspaces.id
            AND wm.user_id <> ${userId}
        )
    `)

    await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId))

    await tx
      .delete(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.createdBy, userId),
          isNull(workspaceInvites.acceptedAt),
        ),
      )

    await tx
      .update(workspaceInvites)
      .set({ createdBy: null })
      .where(
        and(
          eq(workspaceInvites.createdBy, userId),
          isNotNull(workspaceInvites.acceptedAt),
        ),
      )

    const remainingCreatedWorkspaces = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaces)
      .where(eq(workspaces.createdBy, userId))

    if ((remainingCreatedWorkspaces[0]?.count ?? 0) > 0) {
      throw new HttpError({
        status: 409,
        code: ERROR_CODES.LAST_OWNER,
        message: `Transfer ownership of ${remainingCreatedWorkspaces[0].count} workspace(s) before deleting your account.`,
      })
    }
  })

  await deleteBetterAuthUser(userId, deps)
}
