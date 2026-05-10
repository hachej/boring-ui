import { ASK_USER_PLUGIN_ID } from "../shared/constants"
import { validateAskUserToolInput } from "../shared/schema"
import type { AskUserToolInput, AskUserToolResult } from "../shared/types"
import type { AskUserRuntime } from "./AskUserRuntime"

export type AskUserPiToolResult = {
  content: Array<{ type: "text"; text: string }>
  details?: unknown
  isError?: boolean
}

export type AskUserPiToolDefinition = {
  name: "ask_user"
  label: string
  description: string
  parameters: Record<string, unknown>
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<AskUserPiToolResult>
}

export type AskUserPiExtensionApi = {
  registerTool(tool: AskUserPiToolDefinition): void
}

export type AskUserPiExtensionFactory = (api: unknown) => void | Promise<void>

export type AskUserPiExtensionOptions = {
  runtime: AskUserRuntime
  sessionId: string | (() => string)
}

export function createAskUserPiTool(options: AskUserPiExtensionOptions): AskUserPiToolDefinition {
  return {
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user a blocking structured question in the Workspace Questions pane.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short question title." },
        context: { type: "string", description: "Optional context shown above the form." },
        schema: { type: "object", description: "Structured form schema." },
        timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
      },
      required: ["title", "schema"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      const parsed = validateAskUserToolInput(params)
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}` }],
        }
      }
      const input = parsed.data as AskUserToolInput
      const result = await options.runtime.ask({ ...input, sessionId: resolveSessionId(options.sessionId) }, signal)
      return formatAskUserResult(result)
    },
  }
}

export function createAskUserPiExtensionFactory(options: AskUserPiExtensionOptions): AskUserPiExtensionFactory {
  return (api) => {
    // Principle 3 justification: native pi-ask-user inspired this tool shape, but Workspace
    // owns its own implementation because answers must flow through the Questions pane,
    // persisted React form state, and a browser->server command channel instead of Pi-only UI.
    ;(api as AskUserPiExtensionApi).registerTool(createAskUserPiTool(options))
  }
}

function resolveSessionId(sessionId: string | (() => string)): string {
  return typeof sessionId === "function" ? sessionId() : sessionId
}

function formatAskUserResult(result: AskUserToolResult): AskUserPiToolResult {
  if (result.status === "answered") {
    return {
      content: [{ type: "text", text: `User answered: ${JSON.stringify(result.answer.values)}` }],
      details: result,
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: `User question cancelled: ${result.reason}` }],
    details: result,
  }
}

export const ASK_USER_PI_EXTENSION_ID = `${ASK_USER_PLUGIN_ID}.pi-extension` as const
