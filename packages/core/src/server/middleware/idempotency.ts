import { createHash } from 'node:crypto'
import type { preHandlerHookHandler, FastifyRequest, FastifyReply } from 'fastify'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { Database } from '../db/connection.js'
import { idempotencyKeys } from '../db/schema.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'

export interface IdempotencyEntry {
  responseStatus: number
  responseBody: unknown
}

export type IdempotencyClaim =
  | { status: 'claimed' | 'pending' | 'conflict' }
  | { status: 'replay'; entry: IdempotencyEntry }

export interface IdempotencyKeyStore {
  sweep(): Promise<void>
  find(key: string): Promise<IdempotencyEntry | null>
  set(key: string, scope: string, status: number, body: unknown): Promise<void>
  /** Atomically reserve the key before effects; an existing claim must never be replaced. */
  claim(key: string, scope: string, requestHash: string): Promise<IdempotencyClaim>
}

export function createDrizzleIdempotencyStore(db: Database): IdempotencyKeyStore {
  return {
    async sweep() {
      // A lost response/host crash can leave effects with an unknown outcome.
      // Never expire an unresolved claim into permission to repeat those effects.
      await db.delete(idempotencyKeys).where(and(
        isNotNull(idempotencyKeys.responseStatus),
        lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`),
      ))
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
      const entry = rows[0]
      return entry?.responseStatus != null
        ? { responseStatus: entry.responseStatus, responseBody: entry.responseBody }
        : null
    },
    async claim(key, scope, requestHash) {
      const inserted = await db.insert(idempotencyKeys)
        .values({ key, scope, requestHash })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key })
      if (inserted.length > 0) return { status: 'claimed' }

      const [existing] = await db.select().from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key)).limit(1)
      // A concurrent sweep can remove an expired completed entry between the
      // insert and read. Refuse this attempt; a retry may acquire the key.
      if (!existing) return { status: 'pending' }
      if (existing.scope !== scope || existing.requestHash !== requestHash) {
        return { status: 'conflict' }
      }
      if (existing.responseStatus === null) return { status: 'pending' }
      return {
        status: 'replay',
        entry: { responseStatus: existing.responseStatus, responseBody: existing.responseBody },
      }
    },
    async set(key: string, scope: string, status: number, body: unknown) {
      await db.insert(idempotencyKeys)
        .values({ key, scope, responseStatus: status, responseBody: body })
        .onConflictDoUpdate({
          target: idempotencyKeys.key,
          set: { responseStatus: status, responseBody: body, createdAt: sql`now()` },
          setWhere: and(eq(idempotencyKeys.scope, scope), isNull(idempotencyKeys.responseStatus)),
        })
    },
  }
}

const REQUEST_CLAIM = Symbol('idempotencyClaim')
type ClaimedRequest = FastifyRequest & { [REQUEST_CLAIM]?: { key: string; scope: string } }

export function createIdempotencyMiddleware(store: IdempotencyKeyStore) {
  function guard(
    scope: string | ((request: FastifyRequest) => string),
    options?: { legacyScope?: string },
  ): preHandlerHookHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const key = request.headers['idempotency-key']
      if (typeof key !== 'string' || key.length === 0) return

      const requestScope = typeof scope === 'string' ? scope : scope(request)
      const compositeKey = JSON.stringify([requestScope, key])
      // JSON member order does not change request identity.
      const body = JSON.stringify(request.body ?? null, (_key, value: unknown) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
          : value,
      )
      const requestHash = createHash('sha256').update(body).digest('hex')

      await store.sweep()
      // The previous key format had no actor/tenant/payload identity. A live
      // receipt proves possible effects, but is not safe to replay or repeat.
      if (options?.legacyScope && await store.find(`${options.legacyScope}:${key}`)) {
        throw new HttpError({
          status: 409,
          code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
          message: 'Idempotency-Key has an unscoped legacy response; inspect the original request before retrying',
          requestId: request.id,
        })
      }
      const claim = await store.claim(compositeKey, requestScope, requestHash)
      if (claim.status === 'replay') {
        reply.status(claim.entry.responseStatus).send(claim.entry.responseBody)
        return reply
      }
      if (claim.status === 'conflict' || claim.status === 'pending') {
        throw new HttpError({
          status: 409,
          code: claim.status === 'conflict'
            ? ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT
            : ERROR_CODES.IDEMPOTENCY_IN_PROGRESS,
          message: claim.status === 'conflict'
            ? 'Idempotency-Key was already used with a different request'
            : 'The original request is in progress or its outcome is unknown; retry this key later',
          requestId: request.id,
        })
      }

      ;(request as ClaimedRequest)[REQUEST_CLAIM] = { key: compositeKey, scope: requestScope }
    }
  }

  async function onSendCapture(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown> {
    const claim = (request as ClaimedRequest)[REQUEST_CLAIM]
    if (!claim) return payload
    // A failed cache write may cause Fastify to run onSend for its error reply.
    // Keep the claim unresolved rather than replacing the original outcome.
    delete (request as ClaimedRequest)[REQUEST_CLAIM]

    if (typeof payload !== 'string') {
      request.log.warn({ idempotencyKey: claim.key }, 'idempotency.skip-non-json')
      return payload
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      request.log.warn({ idempotencyKey: claim.key }, 'idempotency.skip-non-json')
      return payload
    }

    await store.set(claim.key, claim.scope, reply.statusCode, parsed)
    return payload
  }

  return { guard, onSendCapture }
}
