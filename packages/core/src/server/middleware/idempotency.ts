import type { preHandlerHookHandler, FastifyRequest, FastifyReply } from 'fastify'
import { eq, lt, sql } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import { idempotencyKeys } from '../db/schema.js'

export interface IdempotencyEntry {
  responseStatus: number
  responseBody: unknown
}

export interface IdempotencyKeyStore {
  sweep(): Promise<void>
  find(key: string): Promise<IdempotencyEntry | null>
  set(key: string, scope: string, status: number, body: unknown): Promise<void>
}

export function createDrizzleIdempotencyStore(db: Database): IdempotencyKeyStore {
  return {
    async sweep() {
      await db.delete(idempotencyKeys).where(
        lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`),
      )
    },
    async find(key: string) {
      const rows = await db
        .select({
          responseStatus: idempotencyKeys.responseStatus,
          responseBody: idempotencyKeys.responseBody,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key))
        .limit(1)
      return rows[0] ?? null
    },
    async set(key: string, scope: string, status: number, body: unknown) {
      await db
        .insert(idempotencyKeys)
        .values({ key, scope, responseStatus: status, responseBody: body })
        .onConflictDoNothing()
    },
  }
}

const REQUEST_KEY = '__idempotencyKey'
const REQUEST_SCOPE = '__idempotencyScope'

export function createIdempotencyMiddleware(store: IdempotencyKeyStore) {
  function guard(scope: string): preHandlerHookHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const key = request.headers['idempotency-key']
      if (typeof key !== 'string' || key.length === 0) return

      const compositeKey = `${scope}:${key}`

      await store.sweep()

      const existing = await store.find(compositeKey)
      if (existing) {
        reply.status(existing.responseStatus).send(existing.responseBody)
        return reply
      }

      ;(request as unknown as Record<string, unknown>)[REQUEST_KEY] = compositeKey
      ;(request as unknown as Record<string, unknown>)[REQUEST_SCOPE] = scope
    }
  }

  async function onSendCapture(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown> {
    const key = (request as unknown as Record<string, unknown>)[REQUEST_KEY] as string | undefined
    const scope = (request as unknown as Record<string, unknown>)[REQUEST_SCOPE] as string | undefined
    if (!key || !scope) return payload

    if (typeof payload !== 'string') {
      request.log.warn({ idempotencyKey: key }, 'idempotency.skip-non-json')
      return payload
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      request.log.warn({ idempotencyKey: key }, 'idempotency.skip-non-json')
      return payload
    }

    await store.set(key, scope, reply.statusCode, parsed)
    return payload
  }

  return { guard, onSendCapture }
}
