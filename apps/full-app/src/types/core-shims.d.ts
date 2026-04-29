declare module '@boring/core/front' {
  export const BoringApp: any
  export const ThemeToggle: any
  export const UserMenu: any
  export const WorkspaceSwitcher: any
  export const useCurrentWorkspace: any
}

declare module '@boring/core/server' {
  export type BetterAuthInstance = any
  export const authHook: any
  export const createAuth: any
  export const createCoreApp: any
  export const loadConfig: any
  export const registerInviteRoutes: any
  export const registerMemberRoutes: any
  export const registerRoutes: any
  export const registerSettingsRoutes: any
  export const registerWorkspaceRoutes: any
}

declare module '@boring/core/server/db' {
  export const createDatabase: any
  export class PostgresUserStore {
    constructor(db: any)
  }
  export class PostgresWorkspaceStore {
    constructor(db: any, workspaceSettingsKey?: string)
  }
}
