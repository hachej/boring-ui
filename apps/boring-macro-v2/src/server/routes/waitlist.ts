/**
 * Waitlist route — public endpoint for landing page email signups.
 *
 * Stores emails in ClickHouse. Falls back gracefully when CH is unavailable.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { DataService } from '../services/clickhouse'
import { loadMacroConfig } from '../config'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const WAITLIST_DDL = `
CREATE TABLE IF NOT EXISTS waitlist (
    email String,
    created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY email
`

let tableReady = false

export async function registerWaitlistRoute(app: FastifyInstance): Promise<void> {
  const macroConfig = await loadMacroConfig()
  const svc = macroConfig.clickhouse ? new DataService(macroConfig.clickhouse) : null

  app.post('/api/waitlist', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body as Record<string, unknown>) || {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (!email || !EMAIL_RE.test(email) || email.length > 320) {
      return reply.code(400).send({ ok: false, error: 'Valid email required' })
    }

    if (!svc) {
      // No ClickHouse configured — accept silently
      return { ok: true }
    }

    try {
      if (!tableReady) {
        await svc.rawCommand(WAITLIST_DDL)
        tableReady = true
      }

      await svc.rawCommand(
        `INSERT INTO waitlist (email) VALUES ({email:String})`,
        { email },
      )
    } catch (err) {
      app.log.error({ err }, 'Waitlist insert failed')
      // Don't expose internal errors — still return success to user
    }

    return { ok: true }
  })
}
