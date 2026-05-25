import type { AgentTool, ToolResult } from '@hachej/boring-agent/shared'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'
import type { WorkspaceBridgeCallRequest, WorkspaceBridgeCallResponse } from '@hachej/boring-workspace/server'

type PiAskUserTool = {
  name: 'ask_user'
  description: string
  promptSnippet?: string
  parameters: Record<string, unknown>
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>
}

export interface AskUserBridgeToolContext {
  callAsRuntime<TOutput = unknown>(
    request: WorkspaceBridgeCallRequest,
    options?: { sessionId?: string; signal?: AbortSignal },
  ): Promise<WorkspaceBridgeCallResponse<TOutput>>
}

export function createAskUserBridgeTool(ctx: AskUserBridgeToolContext): AgentTool {
  const template = captureAskUserTool(ctx, 'metadata')
  return {
    name: template.name,
    description: template.description,
    promptSnippet: template.promptSnippet,
    parameters: template.parameters,
    async execute(params, toolCtx) {
      const tool = captureAskUserTool(ctx, toolCtx.sessionId ?? 'default')
      return await tool.execute(toolCtx.toolCallId, params, toolCtx.abortSignal)
    },
  }
}

function captureAskUserTool(ctx: AskUserBridgeToolContext, sessionId: string): PiAskUserTool {
  let tool: PiAskUserTool | undefined
  createAskUserPiExtensionFactory({
    sessionId,
    callHumanInputRequest: async (input, signal) => await ctx.callAsRuntime(
      { op: 'human-input.v1.request', requestId: input.requestId, input },
      { sessionId: input.sessionId, signal },
    ),
  })({ registerTool: (candidate) => { tool = candidate as PiAskUserTool } })
  if (!tool) throw new Error('ask_user bridge tool failed to register')
  return tool
}
