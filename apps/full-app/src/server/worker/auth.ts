import type { FastifyReply, FastifyRequest } from 'fastify'
import { constantTimeTokenEqual } from '@hachej/boring-sandbox/providers'
import { WORKER_INTERNAL_TOKEN_HEADER } from '@hachej/boring-sandbox/shared'

export function verifyInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string,
): boolean {
  const provided = request.headers[WORKER_INTERNAL_TOKEN_HEADER]
  const token = Array.isArray(provided) ? provided[0] : provided
  if (typeof token !== 'string' || !constantTimeTokenEqual(token, expectedToken)) {
    reply.code(401).send({
      error: {
        code: 'auth_invalid',
        message: 'invalid internal token',
        statusCode: 401,
      },
    })
    return false
  }
  return true
}
