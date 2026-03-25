/**
 * Request ID middleware — ensures every request has a unique correlation ID.
 * Mirrors Python's middleware/request_id.py.
 */
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string
  }
}

export async function registerRequestIdHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    request.requestId =
      (request.headers['x-request-id'] as string) || randomUUID()
  })

  // Add request_id to response headers
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.requestId)
  })
}
