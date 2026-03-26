import { createAiSdkServerTools } from '../services/aiSdkTools.js'

export function createAiSdkTools(
  context: {
    workspaceRoot?: string
    backendUrl?: string
    internalApiToken?: string
    uiWorkspaceKey?: string
  } = {},
) {
  return createAiSdkServerTools(context)
}
