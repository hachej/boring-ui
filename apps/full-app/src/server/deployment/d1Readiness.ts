import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { D1ActiveCollectionReader } from './activeCollectionReader.js'
import { D1HostErrorCode } from './d1Plan.js'

export interface D1ReadinessOptions {
  readonly activeReader: D1ActiveCollectionReader
}

function failure(request: FastifyRequest, reply: FastifyReply, status: 421 | 503, code: string): FastifyReply {
  return reply.status(status).header('cache-control', 'no-store').send({ error: code, code, message: code, requestId: request.id })
}

export function registerD1ReadinessRoute(app: FastifyInstance, options: D1ReadinessOptions): void {
  app.get('/internal/d1/readiness', async (request, reply) => {
    if (request.raw.socket.remoteAddress !== '127.0.0.1' || request.requestScope !== undefined) {
      return failure(request, reply, 421, D1HostErrorCode.HOST_SCOPE_VIOLATION)
    }
    let collection
    try { collection = await options.activeReader.read() } catch { collection = null }
    if (!collection) return failure(request, reply, 503, D1HostErrorCode.COLLECTION_NOT_READY)
    const ready = new Map(collection.observation.bindings.map((binding) => [binding.bindingId, binding.ready]))
    const bindings = collection.desired.plan.bindings
      .map(({ bindingId }) => ({ bindingId, ready: ready.get(bindingId) === true }))
      .sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
    if (bindings.some((binding) => !binding.ready) || ready.size !== bindings.length) {
      return failure(request, reply, 503, D1HostErrorCode.COLLECTION_NOT_READY)
    }
    return reply.header('cache-control', 'no-store').send({
      schemaVersion: 1,
      activeRevision: collection.active.revisionId,
      desiredStateDigest: collection.active.desiredStateDigest,
      bindings,
    })
  })
}
