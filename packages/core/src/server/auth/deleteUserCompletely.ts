import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { ERROR_CODES, HttpError } from '../../shared/errors.js'
import type { Database } from '../db/connection.js'
import {
  users,
  verification_tokens,
  workspaces,
  workspaceInvites,
  workspaceMembers,
  workspaceRuntimes,
  workspaceSettings,
  creditGrants,
  usageLedger,
  usageReservations,
  modelBudgetReservations,
  creditPurchases,
} from '../db/schema.js'

const RETRYABLE_TX_ERROR_CODES = new Set(['40001', '40P01'])
const MEMBERSHIP_USER_FK_ERROR_CODES = new Set(['23001', '23503'])
const MEMBERSHIP_USER_FK = 'workspace_members_user_id_users_id_fk'
const SERIALIZATION_RETRY_LIMIT = 5
const BASE_RETRY_DELAY_MS = 25

function isRetryableTxFailure(error: unknown, retryMembershipUserFk: boolean): boolean {
  let candidate = error
  for (let depth = 0; depth < 4 && typeof candidate === 'object' && candidate !== null; depth += 1) {
    const details = candidate as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (RETRYABLE_TX_ERROR_CODES.has(String(details.code))) return true
    if (
      retryMembershipUserFk
      && MEMBERSHIP_USER_FK_ERROR_CODES.has(String(details.code))
      && details.constraint_name === MEMBERSHIP_USER_FK
    ) return true
    candidate = details.cause
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DeleteUserCompletelyDeps {
  db: Database
  protectedWorkspaceId?: string
}

export async function deleteUserCompletely(
  userId: string,
  deps: DeleteUserCompletelyDeps,
): Promise<void> {
  for (let attempt = 1; attempt <= SERIALIZATION_RETRY_LIMIT; attempt += 1) {
    try {
      await deps.db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)

        let protectedUser: { email: string } | undefined
        if (deps.protectedWorkspaceId) {
          const [lockedUser] = await tx.select({ email: users.email }).from(users)
            .where(eq(users.id, userId)).limit(1).for('update')
          protectedUser = lockedUser
          await tx.execute(sql`
            SELECT user_id FROM workspace_members
            WHERE workspace_id = ${deps.protectedWorkspaceId} AND user_id = ${userId}
            FOR UPDATE
          `)
          const [membership] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(
            eq(workspaceMembers.workspaceId, deps.protectedWorkspaceId), eq(workspaceMembers.userId, userId),
          )).limit(1)
          if (membership?.role === 'owner') throw new HttpError({
            status: 403,
            code: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
            message: ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN,
          })
        }

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

        const userRow = protectedUser ?? (await tx.select({ email: users.email }).from(users)
          .where(eq(users.id, userId)).limit(1))[0]

        if (userRow?.email) {
          await tx
            .delete(verification_tokens)
            .where(eq(verification_tokens.identifier, userRow.email))
        }

        // Credit/metering rows carry the user id as a plain text column (no FK
        // cascade), so they'd otherwise outlive the account (PII + orphaned financial
        // rows). Delete the user's reservations, usage ledger, grants, and purchase
        // rows with the account. (Refund-before-grant tombstones in credit_purchases
        // have a NULL user_id and are intentionally left as cross-store/mode guards.)
        await tx.delete(usageReservations).where(eq(usageReservations.userId, userId))
        await tx.delete(modelBudgetReservations).where(eq(modelBudgetReservations.userId, userId))
        await tx.delete(usageLedger).where(eq(usageLedger.userId, userId))
        await tx.delete(creditGrants).where(eq(creditGrants.userId, userId))
        await tx.delete(creditPurchases).where(eq(creditPurchases.userId, userId))

        await tx.delete(users).where(eq(users.id, userId))
      })

      return
    } catch (error) {
      if (attempt < SERIALIZATION_RETRY_LIMIT && isRetryableTxFailure(error, Boolean(deps.protectedWorkspaceId))) {
        await sleep(BASE_RETRY_DELAY_MS * attempt)
        continue
      }

      throw error
    }
  }
}
