/**
 * Workspaces service — transport-independent workspace CRUD + settings.
 * Mirrors Python's workspace_router_hosted.py.
 */
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
} from '../../shared/types.js'

export interface WorkspaceServiceDeps {
  databaseUrl?: string
  workspaceRoot: string
  settingsKey?: string
}

export interface WorkspaceService {
  list(userId: string): Promise<Workspace[]>
  create(userId: string, name: string): Promise<Workspace>
  get(workspaceId: string): Promise<Workspace>
  update(
    workspaceId: string,
    updates: Partial<Pick<Workspace, 'name'>>,
  ): Promise<Workspace>
  delete(workspaceId: string): Promise<void>
  getSettings(workspaceId: string): Promise<Record<string, string>>
  putSetting(workspaceId: string, key: string, value: string): Promise<void>
  getRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  retryRuntime(workspaceId: string): Promise<WorkspaceRuntime>
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>
  addMember(
    workspaceId: string,
    userId: string,
    role: string,
  ): Promise<WorkspaceMember>
  removeMember(workspaceId: string, userId: string): Promise<void>
  listInvites(workspaceId: string): Promise<WorkspaceInvite[]>
  createInvite(
    workspaceId: string,
    email: string,
    role: string,
  ): Promise<WorkspaceInvite>
  revokeInvite(inviteId: string): Promise<void>
}

export function createWorkspaceService(
  _deps: WorkspaceServiceDeps,
): WorkspaceService {
  throw new Error(
    'Not implemented — see bd-k8box.1 (Phase 3: Workspaces service)',
  )
}
