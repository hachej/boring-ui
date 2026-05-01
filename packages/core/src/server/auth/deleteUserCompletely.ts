import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Database } from '../db/connection.js'
import {
  users,
  verification_tokens,
  workspaces,
  workspaceInvites,
  workspaceMembers,
  workspaceRuntimes,
  workspaceSettings,
} from '../db/schema.js'

const RETRYABLE_TX_ERROR_CODES = new Set(['40001', '40P01'])
const SERIALIZATION_RETRY_LIMIT = 5
const BASE_RETRY_DELAY_MS = 25

function isRetryableTxFailure(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && RETRYABLE_TX_ERROR_CODES.has(String((error as { code?: unknown }).code))
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DeleteUserCompletelyDeps {
  db: Database
}

export async function deleteUserCompletely(
  userId: string,
  deps: DeleteUserCompletelyDeps,
): Promise<void> {
  for (let attempt = 1; attempt <= SERIALIZATION_RETRY_LIMIT; attempt += 1) {
    try {
      await deps.db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)

        const ownerWorkspaces = await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .innerJoin(
            workspaceMembers,
            and(
              eq(workspaceMembers.workspaceId, workspaces.id),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.role, 'owner'),
            ),
          )
          .where(isNull(workspaces.deletedAt))

        for (const workspace of ownerWorkspaces) {
          // Lock owner rows so concurrent owner removals serialize.
          await tx.execute(sql`
            SELECT user_id
            FROM workspace_members
            WHERE workspace_id = ${workspace.id}
              AND role = 'owner'
            FOR UPDATE
          `)

          const [ownerCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspace.id),
                eq(workspaceMembers.role, sql`'owner'`),
              ),
            )

          if (Number(ownerCount.count) !== 1) {
            continue
          }

          const [oldestEditor] = await tx
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspace.id),
                eq(workspaceMembers.role, 'editor'),
                sql`${workspaceMembers.userId} <> ${userId}`,
              ),
            )
            .orderBy(workspaceMembers.createdAt, workspaceMembers.userId)
            .limit(1)

          if (oldestEditor) {
            await tx
              .update(workspaceMembers)
              .set({ role: 'owner' })
              .where(
                and(
                  eq(workspaceMembers.workspaceId, workspace.id),
                  eq(workspaceMembers.userId, oldestEditor.userId),
                ),
              )

            await tx
              .update(workspaces)
              .set({ createdBy: oldestEditor.userId })
              .where(eq(workspaces.id, workspace.id))

            continue
          }

          // If a sole-owner workspace has no editors, remove it during account deletion.
          await tx
            .delete(workspaceInvites)
            .where(eq(workspaceInvites.workspaceId, workspace.id))
          await tx
            .delete(workspaceSettings)
            .where(eq(workspaceSettings.workspaceId, workspace.id))
          await tx
            .delete(workspaceRuntimes)
            .where(eq(workspaceRuntimes.workspaceId, workspace.id))
          await tx
            .delete(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspace.id))
          await tx
            .delete(workspaces)
            .where(eq(workspaces.id, workspace.id))
        }

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
              wm.created_at ASC,
              wm.user_id ASC
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
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.createdBy, userId))

        for (const workspace of remainingCreatedWorkspaces) {
          await tx
            .delete(workspaceInvites)
            .where(eq(workspaceInvites.workspaceId, workspace.id))
          await tx
            .delete(workspaceSettings)
            .where(eq(workspaceSettings.workspaceId, workspace.id))
          await tx
            .delete(workspaceRuntimes)
            .where(eq(workspaceRuntimes.workspaceId, workspace.id))
          await tx
            .delete(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspace.id))
          await tx
            .delete(workspaces)
            .where(eq(workspaces.id, workspace.id))
        }

        const [userRow] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)

        if (userRow?.email) {
          await tx
            .delete(verification_tokens)
            .where(eq(verification_tokens.identifier, userRow.email))
        }

        await tx.delete(users).where(eq(users.id, userId))
      })

      return
    } catch (error) {
      if (attempt < SERIALIZATION_RETRY_LIMIT && isRetryableTxFailure(error)) {
        await sleep(BASE_RETRY_DELAY_MS * attempt)
        continue
      }

      throw error
    }
  }
}
