export function getDefaultTasksWorkspaceRoot(): string | undefined {
  return process.env.BORING_AGENT_WORKSPACE_ROOT
}

export function getGitHubCliEnv(): Record<string, string | undefined> {
  return { ...process.env, GH_PROMPT_DISABLED: "1" }
}
