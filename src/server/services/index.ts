/**
 * Service layer barrel export.
 * All services are transport-independent — no Fastify/tRPC imports.
 */
export type { FileService, FileServiceDeps } from './files.js'
export { createFileService } from './files.js'

export type { GitService, GitServiceDeps } from './git.js'
export { createGitService } from './git.js'

export type { ExecService, ExecServiceDeps } from './exec.js'
export { createExecService } from './exec.js'

export type { AuthService, AuthServiceDeps } from './auth.js'
export { createAuthService, COOKIE_NAME, SESSION_ALGORITHM } from './auth.js'

export type { WorkspaceService, WorkspaceServiceDeps } from './workspaces.js'
export { createWorkspaceService } from './workspaces.js'

export type { UserService, UserServiceDeps } from './users.js'
export { createUserService } from './users.js'

export type {
  CapabilitiesService,
  CapabilitiesServiceDeps,
} from './capabilities.js'
export { createCapabilitiesService } from './capabilities.js'

export type { ApprovalStore } from './approval.js'
export { createInMemoryApprovalStore } from './approval.js'

export type { UIStateService } from './uiState.js'
export { createUIStateService } from './uiState.js'

export type { GitHubService, GitHubServiceDeps } from './github.js'
export { createGitHubService } from './github.js'
