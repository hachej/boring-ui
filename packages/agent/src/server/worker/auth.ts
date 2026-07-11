import type { FastifyReply, FastifyRequest } from 'fastify'
import { constantTimeTokenEqual, WORKER_INTERNAL_TOKEN_HEADER } from '../index'
import { WORKER_ERROR_CODES } from './error-codes'

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
        code: WORKER_ERROR_CODES.AUTH_INVALID,
        message: 'invalid internal token',
        statusCode: 401,
      },
    })
    return false
  }
  return true
}
