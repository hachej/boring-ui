import { sql } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import { creditGrants, outreachLeads, outreachLinks, workspaceMembers, workspaces } from '../db/schema.js'
import { ERROR_CODES, HttpError } from '../../shared/errors.js'

export interface AuthIdentityAdapter {
  transferAnonymousOwnership(input: {
    anonymousUserId: string
    claimedUserId: string
    claimedEmail?: string | null
  }): Promise<void>
}

interface LeadTransferRow {
  id: string
  outreachLinkId: string
}

function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? rows as T[] : []
}

function outreachClaimConflict(message: string): HttpError {
  return new HttpError({
    status: 409,
    code: ERROR_CODES.OUTREACH_CLAIM_CONFLICT,
    message,
  })
}

export function createOutreachAuthIdentityAdapter(db: Database, appId: string): AuthIdentityAdapter {
  return {
    async transferAnonymousOwnership(input) {
      if (input.anonymousUserId === input.claimedUserId) return

      await db.transaction(async (tx) => {
        const [anonymousLead] = rowsFromExecute<LeadTransferRow>(await tx.execute(sql`
          SELECT id, outreach_link_id AS "outreachLinkId"
          FROM ${outreachLeads}
          WHERE app_id = ${appId}
            AND user_id = ${input.anonymousUserId}
          FOR UPDATE
        `))
        const [claimedLead] = rowsFromExecute<LeadTransferRow>(await tx.execute(sql`
          SELECT id, outreach_link_id AS "outreachLinkId"
          FROM ${outreachLeads}
          WHERE app_id = ${appId}
            AND user_id = ${input.claimedUserId}
          FOR UPDATE
        `))

        if (!anonymousLead) {
          if (claimedLead) {
            throw outreachClaimConflict('Anonymous outreach lead was already claimed')
          }
          return
        }

        if (claimedLead && claimedLead.outreachLinkId !== anonymousLead.outreachLinkId) {
          throw outreachClaimConflict('Cannot claim anonymous outreach lead into an account with another outreach lead')
        }

        await tx.execute(sql`
          INSERT INTO ${creditGrants} (user_id, amount_micros, reason, expires_at, created_at)
          SELECT ${input.claimedUserId}, source.amount_micros, source.reason, source.expires_at, source.created_at
          FROM ${creditGrants} source
          JOIN ${outreachLinks} link
            ON source.reason = ('outreach:' || link.id || ':initial_credit')
          WHERE source.user_id = ${input.anonymousUserId}
            AND link.app_id = ${appId}
          ON CONFLICT (user_id, reason) DO NOTHING
        `)
        await tx.execute(sql`
          DELETE FROM ${creditGrants} source
          USING ${outreachLinks} link
          WHERE source.user_id = ${input.anonymousUserId}
            AND source.reason = ('outreach:' || link.id || ':initial_credit')
            AND link.app_id = ${appId}
        `)
        await tx.execute(sql`
          INSERT INTO ${workspaceMembers} (workspace_id, user_id, role, created_at)
          SELECT source.workspace_id, ${input.claimedUserId}, source.role, source.created_at
          FROM ${workspaceMembers} source
          JOIN ${workspaces} ws
            ON source.workspace_id = ws.id
          WHERE ws.app_id = ${appId}
            AND source.user_id = ${input.anonymousUserId}
          ON CONFLICT (workspace_id, user_id) DO NOTHING
        `)
        await tx.execute(sql`
          DELETE FROM ${workspaceMembers} source
          USING ${workspaces} ws
          WHERE source.workspace_id = ws.id
            AND ws.app_id = ${appId}
            AND source.user_id = ${input.anonymousUserId}
        `)
        await tx.execute(sql`
          UPDATE ${workspaces}
          SET created_by = ${input.claimedUserId}
          WHERE created_by = ${input.anonymousUserId}
            AND app_id = ${appId}
        `)

        if (claimedLead) {
          const deleted = rowsFromExecute<{ id: string }>(await tx.execute(sql`
            DELETE FROM ${outreachLeads}
            WHERE id = ${anonymousLead.id}
              AND app_id = ${appId}
              AND user_id = ${input.anonymousUserId}
            RETURNING id
          `))
          if (deleted.length !== 1) {
            throw outreachClaimConflict('Anonymous outreach lead transfer lost the claim race')
          }
          await tx.execute(sql`
            UPDATE ${outreachLeads}
            SET status = 'claimed',
                claimed_at = COALESCE(claimed_at, now()),
                claimed_email = COALESCE(${input.claimedEmail ?? null}, claimed_email),
                updated_at = now()
            WHERE id = ${claimedLead.id}
              AND app_id = ${appId}
          `)
          return
        }

        const transferred = rowsFromExecute<{ id: string }>(await tx.execute(sql`
          UPDATE ${outreachLeads}
          SET user_id = ${input.claimedUserId},
              status = 'claimed',
              claimed_at = now(),
              claimed_email = COALESCE(${input.claimedEmail ?? null}, claimed_email),
              updated_at = now()
          WHERE id = ${anonymousLead.id}
            AND app_id = ${appId}
            AND user_id = ${input.anonymousUserId}
          RETURNING id
        `))
        if (transferred.length !== 1) {
          throw outreachClaimConflict('Anonymous outreach lead transfer lost the claim race')
        }
      })
    },
  }
}
