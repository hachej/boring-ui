import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { AgentHostActiveCollectionReader } from './activeCollectionReader.js'
import { AgentHostErrorCode } from './agentHostPlan.js'

export interface AgentHostReadinessOptions {
  readonly activeReader: AgentHostActiveCollectionReader
}

function failure(request: FastifyRequest, reply: FastifyReply, status: 421 | 503, code: string): FastifyReply {
  return reply.status(status).header('cache-control', 'no-store').send({ error: code, code, message: code, requestId: request.id })
}

export function registerAgentHostReadinessRoute(app: FastifyInstance, options: AgentHostReadinessOptions): void {
  app.get('/internal/agent-host/readiness', async (request, reply) => {
    if (request.raw.socket.remoteAddress !== '127.0.0.1' || request.requestScope !== undefined) {
      return failure(request, reply, 421, AgentHostErrorCode.HOST_SCOPE_VIOLATION)
    }
    let collection
    try { collection = await options.activeReader.read() } catch { collection = null }
    if (!collection) return failure(request, reply, 503, AgentHostErrorCode.COLLECTION_NOT_READY)
    const ready = new Map(collection.observation.bindings.map((binding) => [binding.bindingId, binding.ready]))
    const bindings = collection.desired.plan.bindings
      .map(({ bindingId }) => ({ bindingId, ready: ready.get(bindingId) === true }))
      .sort((left, right) => left.bindingId < right.bindingId ? -1 : left.bindingId > right.bindingId ? 1 : 0)
    if (bindings.some((binding) => !binding.ready) || ready.size !== bindings.length) {
      return failure(request, reply, 503, AgentHostErrorCode.COLLECTION_NOT_READY)
    }
    return reply.header('cache-control', 'no-store').send({
      schemaVersion: 1,
      activeRevision: collection.active.revisionId,
      desiredStateDigest: collection.active.desiredStateDigest,
      bindings,
    })
  })
}
