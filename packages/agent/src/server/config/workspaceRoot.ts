const WORKSPACE_ROOT_ENV = 'BORING_AGENT_WORKSPACE_ROOT'

export function resolveWorkspaceRoot(defaultRoot = process.cwd()): string {
  const configured = process.env[WORKSPACE_ROOT_ENV]?.trim()
  if (!configured) return defaultRoot
  return configured
}
