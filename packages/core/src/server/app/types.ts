import type { FastifyInstance } from 'fastify'
import type {
  CoreConfig,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
  MemberRole,
} from '../../shared/types.js'
import type { ERROR_CODES } from '../../shared/errors.js'

export interface UserStore {
  getById(id: string): Promise<User | null>
  getByEmail(email: string): Promise<User | null>
  upsert(userId: string, data: { email: string; name?: string }): Promise<User>
  getUserSettings(userId: string, appId: string): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
  putUserSettings(
    userId: string,
    appId: string,
    updates: { displayName?: string; email?: string; settings?: Record<string, unknown> },
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
}

export interface WorkspaceStore {
  create(userId: string, name: string, appId: string): Promise<Workspace>
  list(userId: string, appId: string): Promise<Workspace[]>
  get(id: string): Promise<Workspace | null>
  update(id: string, updates: Partial<Pick<Workspace, 'name'>>): Promise<Workspace | null>
  delete(id: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.WORKSPACE_PROVISIONING | typeof ERROR_CODES.NOT_FOUND }>
  getWorkspacesWhereSoleOwner(userId: string): Promise<Workspace[]>
  isMember(workspaceId: string, userId: string): Promise<boolean>
  getMemberRole(workspaceId: string, userId: string): Promise<MemberRole | null>
  listMembers(workspaceId: string): Promise<Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }>>
  upsertMember(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember>
  removeMember(workspaceId: string, userId: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER | typeof ERROR_CODES.WORKSPACE_PROVISIONING }>
  listInvites(workspaceId: string): Promise<WorkspaceInvite[]>
  createInvite(workspaceId: string, email: string, role: MemberRole, invitedBy: string | null): Promise<{ invite: WorkspaceInvite; rawToken: string }>
  getInvite(workspaceId: string, inviteId: string): Promise<WorkspaceInvite | null>
  getInviteByTokenHash(tokenHash: string): Promise<WorkspaceInvite | null>
  revokeInvite(workspaceId: string, inviteId: string): Promise<boolean>
  acceptInvite(workspaceId: string, inviteId: string, userId: string): Promise<{ invite: WorkspaceInvite; member: WorkspaceMember }>
  getWorkspaceSettings(workspaceId: string): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>
  putWorkspaceSettings(workspaceId: string, settings: Record<string, string>): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>
  getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  putWorkspaceRuntime(workspaceId: string, state: Partial<WorkspaceRuntime>): Promise<WorkspaceRuntime>
  retryWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  getUiState(userId: string, workspaceId: string): Promise<Record<string, unknown> | null>
  putUiState(userId: string, workspaceId: string, state: Record<string, unknown>): Promise<void>
}

export interface AuthProvider {
  verifySession(token: string): Promise<unknown>
  cookieName(): string
}

export interface CreateCoreAppOptions {
  authProvider?: AuthProvider
  userStore?: UserStore
  workspaceStore?: WorkspaceStore
  manageShutdown?: boolean
}

declare module 'fastify' {
  interface FastifyInstance {
    config: CoreConfig
    addRedactionPaths(paths: string[]): void
  }
  interface FastifyRequest {
    user?: { id: string; email: string; name: string | null } | null
  }
}
