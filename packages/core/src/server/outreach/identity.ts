import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import { outreachLeads, workspaceMembers, workspaces } from '../db/schema.js'

export interface AuthIdentityAdapter {
  transferAnonymousOwnership(input: {
    anonymousUserId: string
    claimedUserId: string
    claimedEmail?: string | null
  }): Promise<void>
}

export function createOutreachAuthIdentityAdapter(db: Database, appId: string): AuthIdentityAdapter {
  return {
    async transferAnonymousOwnership(input) {
      if (input.anonymousUserId === input.claimedUserId) return

      await db.transaction(async (tx) => {
        const [anonymousLead] = await tx
          .select()
          .from(outreachLeads)
          .where(and(
            eq(outreachLeads.appId, appId),
            eq(outreachLeads.userId, input.anonymousUserId),
          ))
          .limit(1)
        const [claimedLead] = await tx
          .select()
          .from(outreachLeads)
          .where(and(
            eq(outreachLeads.appId, appId),
            eq(outreachLeads.userId, input.claimedUserId),
          ))
          .limit(1)

        if (anonymousLead && claimedLead && claimedLead.outreachLinkId !== anonymousLead.outreachLinkId) {
          throw new Error('Cannot claim anonymous outreach lead into an account with another outreach lead')
        }
        if (anonymousLead && claimedLead && claimedLead.outreachLinkId === anonymousLead.outreachLinkId) {
          await tx
            .delete(outreachLeads)
            .where(and(
              eq(outreachLeads.appId, appId),
              eq(outreachLeads.userId, input.anonymousUserId),
            ))
        }

        await tx.execute(sql`
          DELETE FROM ${workspaceMembers} source
          USING ${workspaceMembers} target, ${workspaces} ws
          WHERE source.workspace_id = target.workspace_id
            AND source.workspace_id = ws.id
            AND ws.app_id = ${appId}
            AND source.user_id = ${input.anonymousUserId}
            AND target.user_id = ${input.claimedUserId}
        `)
        await tx.execute(sql`
          UPDATE ${workspaceMembers}
          SET user_id = ${input.claimedUserId}
          FROM ${workspaces} ws
          WHERE workspace_members.workspace_id = ws.id
            AND ws.app_id = ${appId}
            AND workspace_members.user_id = ${input.anonymousUserId}
            AND NOT EXISTS (
              SELECT 1 FROM ${workspaceMembers} target
              WHERE target.workspace_id = workspace_members.workspace_id
                AND target.user_id = ${input.claimedUserId}
            )
        `)
        await tx.execute(sql`
          UPDATE ${workspaces}
          SET created_by = ${input.claimedUserId}
          WHERE created_by = ${input.anonymousUserId}
            AND app_id = ${appId}
        `)
        await tx.execute(sql`
          UPDATE ${outreachLeads}
          SET user_id = ${input.claimedUserId},
              status = 'claimed',
              claimed_at = now(),
              claimed_email = COALESCE(${input.claimedEmail ?? null}, claimed_email),
              updated_at = now()
          WHERE user_id = ${input.anonymousUserId}
            AND app_id = ${appId}
            AND NOT EXISTS (
              SELECT 1 FROM ${outreachLeads} target
              WHERE target.app_id = ${appId}
                AND target.user_id = ${input.claimedUserId}
            )
        `)
      })
    },
  }
}
