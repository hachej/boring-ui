export function configuredWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT || process.cwd()
}
