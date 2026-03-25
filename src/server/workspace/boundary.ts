/**
 * Workspace boundary — route scoping and pass-through rules.
 * Stub — implementation in Phase 3.
 * Mirrors Python's workspace_boundary_router_hosted.py.
 */

export const WORKSPACE_PASSTHROUGH_PREFIXES = [
  '/auth/',
  '/api/v1/me',
  '/api/v1/workspaces',
  '/api/v1/files',
  '/api/v1/git',
] as const
