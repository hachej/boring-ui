// Historical local shims kept only for editor fallback when package DTS has not
// been built yet. Runtime code should import the real package subpaths.

declare module '@boring/core/front' {
  export const CoreFront: any
  export const ThemeToggle: any
  export const UserMenu: any
  export const UserSettingsPage: any
  export const WorkspaceSwitcher: any
  export const WorkspaceSettingsPage: any
  export const useCoreCommands: any
  export const useCurrentWorkspace: any
}

declare module '@boring/core/app/front' {
  export const CoreWorkspaceAgentFront: any
}

declare module '@boring/core/app/server' {
  export const createCoreWorkspaceAgentServer: any
}

declare module '@boring/core/server' {
  export const loadConfig: any
}

declare module '@boring/core/server/db' {
  export const runMigrations: any
}
