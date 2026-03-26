// @ts-ignore -- legacy JS PI tool helpers are reused from the sidecar for the server runtime.
import { buildSessionSystemPrompt as buildSessionSystemPromptRaw, createWorkspaceTools as createWorkspaceToolsRaw } from '../../pi_service/tools.mjs'

export function buildSessionSystemPrompt(
  basePrompt: string,
  context?: { workspaceRoot?: string },
): string {
  return buildSessionSystemPromptRaw(basePrompt, context)
}

export function createWorkspaceTools(
  context?: { workspaceRoot?: string },
): any[] {
  return createWorkspaceToolsRaw(context)
}
