/**
 * Auth middleware — extracts session from cookie, populates request context.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 */
import type { FastifyRequest, FastifyReply } from 'fastify'

export async function authMiddleware(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  throw new Error('Not implemented — see bd-rwy92.4')
}
