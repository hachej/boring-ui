import type { FastifyInstance, FastifyRequest } from 'fastify'
import type {
  CoreConfig,
  CapabilitiesResponse,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRuntime,
  WorkspaceRuntimeResource,
  WorkspaceRuntimeResourceInput,
  WorkspaceRuntimeResourceSelector,
  MemberRole,
} from '../../shared/types.js'
import type { ERROR_CODES } from '../../shared/errors.js'
import type { WorkspaceProvisioner } from '../provisioner/types.js'
import type {
  CoreProductRequestScope,
  CoreProductRouting,
  CoreProductRoutingConfig,
} from '../productDeclarations.js'

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
  putClientUserSettings?(
    userId: string,
    appId: string,
    updates: { displayName?: string; settings?: Record<string, unknown> },
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
  patchUserSettingsJsonPath?(
    userId: string,
    appId: string,
    path: string[],
    value: unknown,
  ): Promise<{ displayName: string; email: string; settings: Record<string, unknown> }>
}

export interface WorkspaceStoreCreateOptions {
  readonly workspaceTypeId?: string
  isDefault?: boolean
  id?: string
  managedBy?: string
}

export interface WorkspaceStore {
  create(userId: string, name: string, appId: string, opts?: WorkspaceStoreCreateOptions): Promise<Workspace>
  list(userId: string, appId: string): Promise<Workspace[]>
  get(id: string): Promise<Workspace | null>
  getIncludingDeleted(id: string): Promise<Workspace | null>
  restore(id: string): Promise<Workspace | null>
  update(id: string, updates: Partial<Pick<Workspace, 'name'>>): Promise<Workspace | null>
  delete(id: string): Promise<{ removed: boolean; code?: typeof ERROR_CODES.NOT_FOUND }>
  getWorkspacesWhereSoleOwner(userId: string): Promise<Workspace[]>
  isMember(workspaceId: string, userId: string): Promise<boolean>
  getMemberRole(workspaceId: string, userId: string): Promise<MemberRole | null>
  listMembers(workspaceId: string): Promise<Array<WorkspaceMember & { user: Pick<User, 'id' | 'email' | 'name' | 'image'> }>>
  upsertMember(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember>
  createMemberIfAbsent(workspaceId: string, userId: string, role: MemberRole): Promise<WorkspaceMember | null>
  updateMemberRole(workspaceId: string, userId: string, role: MemberRole, opts?: { forbidExistingOwnerMutation?: boolean }): Promise<{ member?: WorkspaceMember; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER | typeof ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN }>
  removeMember(workspaceId: string, userId: string, opts?: { allowLastOwner?: boolean; forbidExistingOwnerMutation?: boolean }): Promise<{ removed: boolean; code?: typeof ERROR_CODES.LAST_OWNER | typeof ERROR_CODES.NOT_MEMBER | typeof ERROR_CODES.AGENT_HOST_MANAGED_WORKSPACE_MUTATION_FORBIDDEN }>
  listInvites(workspaceId: string): Promise<WorkspaceInvite[]>
  createInvite(workspaceId: string, email: string, role: MemberRole, invitedBy: string | null, opts?: { ttlDays?: number }): Promise<{ invite: WorkspaceInvite; rawToken: string }>
  getInvite(workspaceId: string, inviteId: string): Promise<WorkspaceInvite | null>
  getInviteByTokenHash(tokenHash: string): Promise<WorkspaceInvite | null>
  revokeInvite(workspaceId: string, inviteId: string): Promise<boolean>
  acceptInvite(workspaceId: string, inviteId: string, userId: string): Promise<{ invite: WorkspaceInvite; member: WorkspaceMember }>
  incrementInviteFailedAttempts(inviteId: string): Promise<{ failedAttempts: number; lockedUntil: string | null }>
  resetInviteFailedAttempts(inviteId: string): Promise<void>
  getWorkspaceSettings(workspaceId: string): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>
  putWorkspaceSettings(workspaceId: string, settings: Record<string, string>): Promise<Array<{ key: string; configured: boolean; updated_at: string }>>
  getWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  putWorkspaceRuntime(workspaceId: string, state: Partial<WorkspaceRuntime>): Promise<WorkspaceRuntime>
  getWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<WorkspaceRuntimeResource | null>
  putWorkspaceRuntimeResource(
    workspaceId: string,
    resource: WorkspaceRuntimeResourceInput,
  ): Promise<WorkspaceRuntimeResource>
  deleteWorkspaceRuntimeResource(
    workspaceId: string,
    selector: WorkspaceRuntimeResourceSelector,
  ): Promise<void>
  listWorkspaceRuntimeResources(
    workspaceId?: string,
  ): Promise<WorkspaceRuntimeResource[]>
  retryWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntime | null>
  getUiState(userId: string, workspaceId: string): Promise<Record<string, unknown> | null>
  putUiState(userId: string, workspaceId: string, state: Record<string, unknown>): Promise<void>
}

export interface AuthProvider {
  verifySession(token: string): Promise<unknown>
  cookieName(): string
}

export type CapabilitiesContributor = (ctx: {
  config: CoreConfig
}) => Partial<CapabilitiesResponse> | Promise<Partial<CapabilitiesResponse>>

export interface CoreRequestScope {
  readonly bindingId: string
  readonly workspaceId: string
  readonly defaultDeploymentId: string
  readonly activeRevision: string
  readonly resolvedDigest: string
}

export type CoreRequestScopeResolver = (request: FastifyRequest) => CoreRequestScope | undefined | Promise<CoreRequestScope | undefined>

export interface CreateCoreAppOptions {
  authProvider?: AuthProvider
  userStore?: UserStore
  workspaceStore?: WorkspaceStore
  provisioner?: WorkspaceProvisioner
  manageShutdown?: boolean
  requestScopeResolver?: CoreRequestScopeResolver
  coreProductRouting?: CoreProductRoutingConfig
  sharedAuthCookieDomain?: string
}

declare module 'fastify' {
  interface FastifyInstance {
    config: CoreConfig
    workspaceStore: WorkspaceStore
    provisioner: WorkspaceProvisioner | null
    addRedactionPaths(paths: string[]): void
    registerCapabilitiesContributor(
      name: string,
      fn: CapabilitiesContributor,
    ): void
    capabilitiesCache: CapabilitiesResponse | null
    coreProductRouting: CoreProductRouting | null
    sharedAuthCookieDomain: string | null
    sharedAuthTrustedOrigins: readonly string[] | null
  }
  interface FastifyRequest {
    user?: { id: string; email: string; name: string | null; emailVerified: boolean } | null
    cspNonce?: string
    requestScope?: CoreRequestScope
    productScope?: CoreProductRequestScope
  }
}
