import type { FastifyInstance } from 'fastify'
import type { CoreConfig } from '../../shared/types.js'

export interface UserStore {
  getById(id: string): Promise<unknown>
}

export interface WorkspaceStore {
  get(id: string): Promise<unknown>
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
