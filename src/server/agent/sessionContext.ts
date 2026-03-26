import type { ServerConfig } from '../config.js'
import { resolveWorkspaceBackend, resolveWorkspacePath } from '../workspace/resolver.js'

const normalizeWorkspaceId = (value: unknown) => String(value || '').trim()

export interface AgentSessionContext {
  workspaceId: string
  workspaceRoot: string
}

interface ResolveAgentSessionOptions {
  allowExplicitRoot?: boolean
}

export function resolveUiWorkspaceKey(
  config: ServerConfig,
  payload: Record<string, unknown> = {},
  workspaceIdHeader?: string,
): string {
  const session = resolveAgentSessionContext(config, payload, workspaceIdHeader)
  if (session.workspaceId) {
    return `workspace:${session.workspaceId}`
  }
  return `root:${session.workspaceRoot}`
}

export function resolveAgentSessionContext(
  config: ServerConfig,
  payload: Record<string, unknown> = {},
  workspaceIdHeader?: string,
  options: ResolveAgentSessionOptions = {},
): AgentSessionContext {
  const workspaceId = normalizeWorkspaceId(
    payload.workspace_id
    || payload.workspaceId
    || workspaceIdHeader
    || '',
  )
  const explicitRoot = String(
    payload.workspace_root
    || payload.workspaceRoot
    || '',
  ).trim()

  if (explicitRoot && options.allowExplicitRoot) {
    return {
      workspaceId,
      workspaceRoot: resolveWorkspacePath(config.workspaceRoot, explicitRoot),
    }
  }

  if (workspaceId && config.workspaceBackend === 'bwrap') {
    return {
      workspaceId,
      workspaceRoot: resolveWorkspaceBackend(config, workspaceId).workspacePath,
    }
  }

  return {
    workspaceId,
    workspaceRoot: config.workspaceRoot,
  }
}
