import { HUMAN_INPUT_OPS, type WorkspaceBridgeCallResponse } from "@hachej/boring-workspace/server"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { validateAskUserToolInput } from "../shared/schema"
import type { AskUserAnswerValue, AskUserCancelReason, AskUserToolInput, AskUserToolResult } from "../shared/types"

type ToolResultPayload = {
  content: Array<{ type: "text"; text: string }>
  details?: unknown
  isError?: boolean
}

type PiToolDefinition = {
  name: "ask_user"
  label: string
  description: string
  promptSnippet?: string
  parameters: Record<string, unknown>
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResultPayload>
}

type PiToolRegistrar = {
  registerTool(tool: PiToolDefinition): void
}

export interface AskUserBridgeRequestInput {
  requestId: string
  sessionId: string
  toolCallId: string
  title: string
  context?: string
  schema: AskUserToolInput["schema"]
  timeoutMs?: number
}

export type AskUserBridgeCancelReason = AskUserCancelReason | "server_restart"

export type AskUserBridgeWaitResult =
  | { status: "answered"; answer: { questionId: string; sessionId: string; values: unknown; answeredAt: string } }
  | { status: "cancelled"; questionId: string; sessionId: string; reason: AskUserBridgeCancelReason }

export interface AskUserWorkspaceBridgeContext {
  sessionId: string | (() => string)
  callHumanInputRequest(input: AskUserBridgeRequestInput, signal?: AbortSignal): Promise<WorkspaceBridgeCallResponse<AskUserBridgeWaitResult>>
  logger?: Pick<Console, "debug" | "warn" | "error">
}

export interface AskUserWorkspaceBridgeClient {
  request(toolCallId: string, input: AskUserToolInput, signal?: AbortSignal): Promise<AskUserToolResult>
}

export type AskUserPiExtensionFactory = (pi: PiToolRegistrar) => void

export function createWorkspaceBridgeClient(ctx: AskUserWorkspaceBridgeContext): AskUserWorkspaceBridgeClient {
  return {
    async request(toolCallId, input, signal) {
      const sessionId = resolveSessionId(ctx.sessionId)
      ctx.logger?.debug?.("ask_user bridge request", { op: HUMAN_INPUT_OPS.request, requestId: toolCallId, sessionId })
      const response = await ctx.callHumanInputRequest({
        requestId: toolCallId,
        sessionId,
        toolCallId,
        title: input.title,
        context: input.context,
        schema: input.schema,
        timeoutMs: input.timeoutMs,
      }, signal)
      if (!response.ok) {
        ctx.logger?.warn?.("ask_user bridge request failed", { code: response.error.code, op: HUMAN_INPUT_OPS.request })
        return { status: "cancelled", questionId: toolCallId, sessionId, reason: "runtime_unavailable" }
      }
      return mapBridgeResult(response.output, sessionId)
    },
  }
}

export function createAskUserPiExtensionFactory(ctx?: AskUserWorkspaceBridgeContext): AskUserPiExtensionFactory {
  return (pi) => {
    const client = ctx ? createWorkspaceBridgeClient(ctx) : undefined
    ctx?.logger?.debug?.("ask_user pi extension registering tool", { tool: "ask_user", op: HUMAN_INPUT_OPS.request })
    pi.registerTool({
      name: "ask_user",
      label: "Ask user",
      description: "Ask the user a blocking structured question in the Workspace Questions pane.",
      promptSnippet: "Use `ask_user` when you need a missing user decision before continuing. Pass schema: { wireVersion: 1, fields: [...] }.",
      parameters: askUserToolParameters,
      async execute(toolCallId, params, signal) {
        const parsed = validateAskUserToolInput(params)
        if (!parsed.success) {
          return errorResult(`Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. Pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }.`)
        }
        if (!client) {
          return errorResult("ask_user is unavailable: WorkspaceBridge in-process context was not provided.", { code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE })
        }
        try {
          const result = await client.request(toolCallId, parsed.data, signal)
          return formatAskUserResult(result)
        } catch (error) {
          ctx?.logger?.error?.("ask_user bridge execution failed", { errorName: error instanceof Error ? error.name : typeof error })
          return errorResult(`ask_user failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })
  }
}

function resolveSessionId(sessionId: string | (() => string)): string {
  return typeof sessionId === "function" ? sessionId() : sessionId
}

function mapBridgeResult(result: AskUserBridgeWaitResult, fallbackSessionId: string): AskUserToolResult {
  if (result.status === "answered") {
    return {
      status: "answered",
      answer: {
        questionId: result.answer.questionId,
        sessionId: result.answer.sessionId,
        values: normalizeAnswerValues(result.answer.values),
        submittedAt: result.answer.answeredAt,
      },
    }
  }
  return {
    status: "cancelled",
    questionId: result.questionId,
    sessionId: result.sessionId || fallbackSessionId,
    reason: mapCancelReason(result.reason),
  }
}

function mapCancelReason(reason: AskUserBridgeCancelReason): AskUserCancelReason {
  return reason === "server_restart" ? "abandoned" : reason
}

function normalizeAnswerValues(values: unknown): Record<string, AskUserAnswerValue> {
  return values && typeof values === "object" && !Array.isArray(values)
    ? values as Record<string, AskUserAnswerValue>
    : { answer: values as AskUserAnswerValue }
}

function formatAskUserResult(result: AskUserToolResult): ToolResultPayload {
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

function errorResult(message: string, details?: unknown): ToolResultPayload {
  return { isError: true, content: [{ type: "text", text: message }], details }
}

const askUserToolParameters = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short question title." },
    context: { type: "string", description: "Optional context shown above the form." },
    schema: {
      type: "object",
      description: "Structured multi-field form schema. Use { wireVersion: 1, fields: [...] }.",
      properties: {
        wireVersion: { type: "number", enum: [1] },
        submitLabel: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text", "textarea", "select", "radio", "multiselect", "checkbox", "number"] },
              name: { type: "string" },
              label: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["type", "name", "label"],
            additionalProperties: true,
          },
        },
      },
      required: ["wireVersion", "fields"],
      additionalProperties: true,
    },
    timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
  },
  required: ["title", "schema"],
  additionalProperties: false,
}

export default createAskUserPiExtensionFactory()
