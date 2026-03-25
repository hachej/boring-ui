/**
 * Auth HTTP routes — delegates to AuthService.
 * Stub — implementation in Phase 1 (bd-rwy92.4).
 */
import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../services/auth.js'

export async function registerAuthRoutes(
  _app: FastifyInstance,
  _authService: AuthService,
): Promise<void> {
  throw new Error('Not implemented — see bd-rwy92.4: Auth system port')
}
