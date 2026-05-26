import type { ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent"
import { Type, type Static } from "@sinclair/typebox"
import { HUMAN_INPUT_OPS, type WorkspaceBridgeCallResponse } from "@hachej/boring-workspace/server"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import { validateAskUserToolInput } from "../shared/schema"
import type { AskUserAnswerValue, AskUserCancelReason, AskUserToolInput, AskUserToolResult } from "../shared/types"

type ToolResultPayload = {
  content: Array<{ type: "text"; text: string }>
  details: unknown
  isError?: boolean
}


export interface AskUserBridgeRequestInput {
  requestId: string
  sessionId: string
  toolCallId: string
  title: string
  context?: string
  schema: AskUserToolInput["schema"]
  payload?: unknown
  timeoutMs?: number
}

export type AskUserBridgeCancelReason = AskUserCancelReason | "server_restart"

export type AskUserBridgeWaitResult =
  | { status: "answered"; answer: { questionId: string; sessionId: string; values: unknown; answeredAt: string } }
  | { status: "cancelled"; questionId: string; sessionId: string; reason: AskUserBridgeCancelReason }

export interface AskUserWorkspaceBridgeContext {
  sessionId?: string | (() => string)
  callHumanInputRequest(input: AskUserBridgeRequestInput, signal?: AbortSignal): Promise<WorkspaceBridgeCallResponse<AskUserBridgeWaitResult>>
  logger?: Pick<Console, "debug" | "warn" | "error">
}

export interface AskUserWorkspaceBridgeClient {
  request(toolCallId: string, input: AskUserToolInput, signal?: AbortSignal): Promise<AskUserToolResult>
}

export type AskUserPiExtensionFactory = ExtensionFactory

export const ASK_USER_PROMPT_SNIPPET = "Use `ask_user` for material decisions that require the user's judgement. Ask one focused question with schema: { wireVersion: 1, fields: [...] }; do not roleplay the answer in chat."

export const ASK_USER_PROMPT_GUIDELINES = [
  "Use ask_user only at a real decision boundary: user-visible architecture, schema/API/deploy/security blast radius, costly-to-undo migrations, destructive/data-loss/prod changes, unclear requirements that materially change implementation, or preference-dependent tradeoffs with no repo convention.",
  "Do not ask for trivial choices or questions already answered by user instructions, AGENTS.md, existing code, tests, or repo conventions; proceed and state the assumption instead.",
  "Before asking, gather enough evidence to synthesize the options and consequences. Ask one focused question with actionable choices; use at most two questions if the first is cancelled or still ambiguous.",
  "Prefer radio/select for mutually exclusive choices, multiselect for independent toggles, textarea for freeform context, and checkbox for confirmation. Always use schema.wireVersion = 1 with explicit fields.",
  "After the user answers, commit the decision and continue. Reopen ask_user only when new information creates a materially new ambiguity.",
]

export function createWorkspaceBridgeClient(ctx: AskUserWorkspaceBridgeContext): AskUserWorkspaceBridgeClient {
  return {
    async request(toolCallId, input, signal) {
      const sessionId = resolveConfiguredSessionId(ctx.sessionId)
      if (!sessionId) {
        return { status: "cancelled", questionId: toolCallId, sessionId: "unknown", reason: "runtime_unavailable" }
      }
      return await requestAskUserBridge(ctx, toolCallId, input, signal, sessionId)
    },
  }
}

export function createAskUserPiExtensionFactory(ctx?: AskUserWorkspaceBridgeContext): AskUserPiExtensionFactory {
  return (pi) => {
    ctx?.logger?.debug?.("ask_user pi extension registering tool", { tool: "ask_user", op: HUMAN_INPUT_OPS.request })
    pi.registerTool({
      name: "ask_user",
      label: "Ask user",
      description: "Ask the user a blocking structured question in the Workspace Questions pane.",
      promptSnippet: ASK_USER_PROMPT_SNIPPET,
      promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
      parameters: askUserToolParameters,
      async execute(
        toolCallId: string,
        params: Static<typeof askUserToolParameters>,
        signal?: AbortSignal,
        _onUpdate?: unknown,
        toolCtx?: ExtensionContext,
      ) {
        const parsed = validateAskUserToolInput(params)
        if (!parsed.success) {
          return errorResult(`Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. Pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }.`)
        }
        if (!ctx) {
          return errorResult("ask_user is unavailable: WorkspaceBridge in-process context was not provided.", { code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE })
        }
        const sessionId = resolveExecutionSessionId(ctx.sessionId, toolCtx)
        if (!sessionId) {
          return errorResult("ask_user is unavailable: WorkspaceBridge session context was not provided.", { code: ASK_USER_ERROR_CODES.RUNTIME_UNAVAILABLE })
        }
        try {
          const result = await requestAskUserBridge(ctx, toolCallId, parsed.data, signal, sessionId)
          return formatAskUserResult(result)
        } catch (error) {
          ctx.logger?.error?.("ask_user bridge execution failed", { errorName: error instanceof Error ? error.name : typeof error })
          return errorResult(`ask_user failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })
  }
}

async function requestAskUserBridge(
  ctx: AskUserWorkspaceBridgeContext,
  toolCallId: string,
  input: AskUserToolInput,
  signal: AbortSignal | undefined,
  sessionId: string,
): Promise<AskUserToolResult> {
  ctx.logger?.debug?.("ask_user bridge request", { op: HUMAN_INPUT_OPS.request, requestId: toolCallId, sessionId })
  const response = await ctx.callHumanInputRequest({
    requestId: toolCallId,
    sessionId,
    toolCallId,
    title: input.title,
    context: input.context,
    schema: input.schema,
    payload: { title: input.title, context: input.context, schema: input.schema },
    timeoutMs: input.timeoutMs,
  }, signal)
  if (!response.ok) {
    ctx.logger?.warn?.("ask_user bridge request failed", { code: response.error.code, op: HUMAN_INPUT_OPS.request })
    return { status: "cancelled", questionId: toolCallId, sessionId, reason: "runtime_unavailable" }
  }
  return mapBridgeResult(response.output, sessionId)
}

function resolveConfiguredSessionId(sessionId: string | (() => string) | undefined): string | undefined {
  if (typeof sessionId === "function") return sessionId()
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function resolveExecutionSessionId(
  configuredSessionId: string | (() => string) | undefined,
  toolCtx?: ExtensionContext,
): string | undefined {
  return resolveConfiguredSessionId(configuredSessionId)
    ?? resolveConfiguredSessionId(toolCtx?.sessionManager?.getSessionId?.())
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
  return { isError: true, content: [{ type: "text", text: message }], details: details ?? {} }
}

const askUserToolParameters = Type.Object({
  title: Type.String({ description: "Short question title." }),
  context: Type.Optional(Type.String({ description: "Optional context shown above the form." })),
  schema: Type.Object({
    wireVersion: Type.Number({ enum: [1] }),
    submitLabel: Type.Optional(Type.String()),
    fields: Type.Array(Type.Object({
      type: Type.String({ enum: ["text", "textarea", "select", "radio", "multiselect", "checkbox", "number"] }),
      name: Type.String(),
      label: Type.String(),
      required: Type.Optional(Type.Boolean()),
    }, { additionalProperties: true })),
  }, {
    description: "Structured multi-field form schema. Use { wireVersion: 1, fields: [...] }.",
    additionalProperties: true,
  }),
  timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds." })),
}, { additionalProperties: false })

export default createAskUserPiExtensionFactory()
