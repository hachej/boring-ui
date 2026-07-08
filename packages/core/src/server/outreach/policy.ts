import { and, eq } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import { outreachLeads } from '../db/schema.js'

export type AnonymousDecision = { allowed: true } | { allowed: false; reason: string }

export async function isAnonymousOutreachUser(db: Database, appId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: outreachLeads.id })
    .from(outreachLeads)
    .where(and(
      eq(outreachLeads.appId, appId),
      eq(outreachLeads.userId, userId),
      eq(outreachLeads.status, 'anonymous'),
    ))
    .limit(1)
  return Boolean(rows[0])
}

export async function isClaimedOutreachUser(db: Database, appId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: outreachLeads.id })
    .from(outreachLeads)
    .where(and(
      eq(outreachLeads.appId, appId),
      eq(outreachLeads.userId, userId),
      eq(outreachLeads.status, 'claimed'),
    ))
    .limit(1)
  return Boolean(rows[0])
}

export function decideAnonymousRequest(method: string, path: string): AnonymousDecision {
  if (method === 'HEAD' || method === 'OPTIONS') return { allowed: true }
  if (method === 'GET' && path === '/api/v1/me') return { allowed: true }
  if (method === 'GET' && /^\/api\/v1\/workspaces\/[^/]+$/.test(path)) return { allowed: true }
  if (method === 'POST' && path === '/api/v1/outreach/claim') return { allowed: true }
  return { allowed: false, reason: 'Anonymous outreach users must claim an account before this action.' }
}
