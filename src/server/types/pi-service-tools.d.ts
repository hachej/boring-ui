declare module '../../pi_service/tools.mjs' {
  export function buildSessionSystemPrompt(
    basePrompt: string,
    context?: { workspaceRoot?: string },
  ): string

  export function createWorkspaceTools(
    context?: { workspaceRoot?: string },
  ): any[]
}
