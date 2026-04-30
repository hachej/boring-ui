import type { NavigateFunction } from 'react-router-dom'

export interface WorkspaceCommand {
  id: string
  label: string
  keywords?: string[]
  run: () => void
}

export function getWorkspaceCommands(workspaceId: string, navigate: NavigateFunction): WorkspaceCommand[] {
  return [
    {
      id: 'workspace:settings',
      label: 'Workspace settings',
      keywords: ['workspace', 'settings', 'edit', 'rename', 'delete'],
      run: () => navigate(`/w/${workspaceId}/settings`),
    },
    {
      id: 'workspace:members',
      label: 'Manage members',
      keywords: ['members', 'team', 'people', 'roles'],
      run: () => navigate(`/w/${workspaceId}/members`),
    },
    {
      id: 'workspace:invites',
      label: 'Invite to workspace',
      keywords: ['invite', 'add', 'new member'],
      run: () => navigate(`/w/${workspaceId}/invites`),
    },
  ]
}
