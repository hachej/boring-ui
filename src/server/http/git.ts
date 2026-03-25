/**
 * Git HTTP routes — delegates to GitService.
 * Stub — implementation in Phase 2.
 */
import type { FastifyInstance } from 'fastify'
import type { GitService } from '../services/git.js'

export async function registerGitRoutes(
  _app: FastifyInstance,
  _gitService: GitService,
): Promise<void> {
  throw new Error('Not implemented — see Phase 2: Git HTTP routes')
}
