import { validateAskUserToolInput } from "../shared/schema"
import { ASK_USER_ERROR_CODES } from "../shared/error-codes"
import type { AskUserToolInput, AskUserToolResult } from "../shared/types"
import type { AskUserRuntime } from "./askUserRuntime"

export type AskUserToolResultPayload = {
  content: Array<{ type: "text"; text: string }>
  details?: unknown
  isError?: boolean
}

export type AskUserToolDefinition = {
  name: "ask_user"
  label: string
  description: string
  parameters: Record<string, unknown>
  promptSnippet?: string
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, sessionId?: string, ownerPrincipalId?: string, deliveryContext?: { agentTypeId?: string; workspaceId?: string; userId?: string }): Promise<AskUserToolResultPayload>
}

export type AskUserToolOptions = {
  runtime: AskUserRuntime
  sessionId: string | (() => string)
}

export function createAskUserTool(options: AskUserToolOptions): AskUserToolDefinition {
  return {
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user a structured question in Workspace. Blocking questions wait for an answer; non-blocking questions return immediately and deliver the answer later as a follow-up.",
    promptSnippet: "Use `ask_user` with `blocking: false` for decisions that should not stop the current turn; the answer returns later as a follow-up message. Omit `blocking` (or pass true) only when work cannot continue without the answer. Pass `schema: { wireVersion: 1, fields: [...] }`. Register every human-facing deliverable relevant to the decision in the plural `artifacts` array as `{ id, surfaceKind, target, title, description? }`; never infer artifacts from files, diffs, branches, titles, prompts, or prose.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short question title." },
        blocking: { type: "boolean", description: "Defaults to true. False creates the question and returns immediately." },
        context: { type: "string", description: "Optional context shown above the form." },
        artifacts: {
          type: "array",
          maxItems: 100,
          description: "Optional explicitly registered human-facing deliverables, in registration order.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable opaque ID unique within this run." },
              surfaceKind: { type: "string", description: "Registered Workspace surface kind." },
              target: { type: "string", description: "Surface target handled by that registered surface." },
              title: { type: "string", description: "Human-facing artifact title." },
              description: { type: "string", description: "Optional concise human-facing description." },
            },
            required: ["id", "surfaceKind", "target", "title"],
            additionalProperties: false,
          },
        },
        schema: {
          type: "object",
          description: "Structured multi-field form schema. Use { wireVersion: 1, fields: [...] }. Supported field types: text, textarea, select, radio, multiselect, checkbox, number.",
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
                  helpText: { type: "string" },
                  placeholder: { type: "string" },
                  options: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" }, description: { type: "string" } }, required: ["value", "label"] } },
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
    },
    async execute(toolCallId, params, signal, sessionId, ownerPrincipalId, deliveryContext) {
      const parsed = validateAskUserToolInput(params)
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. Pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }.` }],
        }
      }
      const input = parsed.data as AskUserToolInput
      try {
        if (input.blocking === false && !hasVerifiedNonBlockingCoordinates(sessionId, ownerPrincipalId, deliveryContext)) {
          return {
            isError: true,
            content: [{ type: "text", text: "ask_user failed: non-blocking questions require verified session, workspace, owner, and Agent coordinates" }],
            details: { code: ASK_USER_ERROR_CODES.UNAUTHORIZED },
          }
        }
        const result = await options.runtime.ask({
          ...input,
          toolCallId,
          sessionId: sessionId ?? resolveSessionId(options.sessionId),
          ownerPrincipalId,
          agentTypeId: deliveryContext?.agentTypeId,
          workspaceId: deliveryContext?.workspaceId,
          askingUserId: deliveryContext?.userId,
        }, signal)
        return formatAskUserResult(result, input)
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `ask_user failed: ${error instanceof Error ? error.message : String(error)}` }],
          details: error && typeof error === "object" && "code" in error ? { code: error.code } : undefined,
        }
      }
    },
  }
}

function hasVerifiedNonBlockingCoordinates(
  sessionId: string | undefined,
  ownerPrincipalId: string | undefined,
  deliveryContext: { agentTypeId?: string; workspaceId?: string; userId?: string } | undefined,
): boolean {
  return !!sessionId
    && !!ownerPrincipalId
    && !!deliveryContext?.agentTypeId
    && !!deliveryContext.workspaceId
    && deliveryContext.userId === ownerPrincipalId
}

function resolveSessionId(sessionId: string | (() => string)): string {
  return typeof sessionId === "function" ? sessionId() : sessionId
}

function formatAskUserResult(result: AskUserToolResult, input: AskUserToolInput): AskUserToolResultPayload {
  if (result.status === "pending") {
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
    }
  }
  if (result.status === "answered") {
    const operations = (input.artifacts ?? []).map((artifact) => ({ action: "upsert" as const, artifact }))
    return {
      content: [{ type: "text", text: `User answered: ${JSON.stringify(result.answer.values)}. Continue the conversation using this answer.` }],
      details: operations.length === 0 ? result : {
        ...result,
        handover: { kind: "boring.handover.operations", wireVersion: 1, operations },
      },
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: `User question cancelled: ${result.reason}` }],
    details: result,
  }
}
