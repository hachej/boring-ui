/**
 * Workspace HTTP routes — delegates to WorkspaceService.
 * Stub — implementation in Phase 3 (bd-k8box.1).
 */
import type { FastifyInstance } from 'fastify'
import type { WorkspaceService } from '../services/workspaces.js'

export async function registerWorkspaceRoutes(
  _app: FastifyInstance,
  _workspaceService: WorkspaceService,
): Promise<void> {
  throw new Error('Not implemented — see bd-k8box.1: Workspaces service')
}
