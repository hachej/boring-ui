import path from 'node:path'

export function projectNameFromWorkspaceRoot(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot)
  const name = path.basename(resolved).trim()
  return name || 'workspace'
}
