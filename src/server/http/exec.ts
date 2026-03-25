/**
 * Exec HTTP routes — delegates to ExecService.
 * Stub — implementation in Phase 2 (bd-qvv02.1).
 */
import type { FastifyInstance } from 'fastify'
import type { ExecService } from '../services/exec.js'

export async function registerExecRoutes(
  _app: FastifyInstance,
  _execService: ExecService,
): Promise<void> {
  throw new Error('Not implemented — see bd-qvv02.1: BwrapBackend')
}
