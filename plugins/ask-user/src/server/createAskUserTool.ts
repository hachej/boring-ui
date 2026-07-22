import { applyHandoverOperations, currentHandoverArtifactsFromStructuredDetails } from "@hachej/boring-workspace/shared"
import { HANDOVER_ERROR_CODES } from "../shared/error-codes"
import { validateAskUserToolInput } from "../shared/schema"
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
  executionMode: "sequential"
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, sessionId?: string, structuredDetails?: readonly { detail: unknown }[], ownerPrincipalId?: string): Promise<AskUserToolResultPayload>
}

export type AskUserToolOptions = {
  runtime: AskUserRuntime
  sessionId: string | (() => string)
}

export function createAskUserTool(options: AskUserToolOptions): AskUserToolDefinition {
  return {
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user a blocking structured question in Workspace. Supports true multi-field forms and optional human-facing artifacts.",
    executionMode: "sequential",
    promptSnippet: "Use `ask_user` only when work is blocked on a human decision. It opens a blocking form in Chat and Inbox; do not simulate the question in prose. Pass `schema: { wireVersion: 1, fields: [...] }`. Register every human-facing deliverable relevant to the decision in the plural `artifacts` array as `{ id, surfaceKind, target, title, description? }`; never infer artifacts from files, diffs, branches, titles, prompts, or prose.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short question title." },
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
    async execute(_toolCallId, params, signal, sessionId, structuredDetails, ownerPrincipalId) {
      const parsed = validateAskUserToolInput(params)
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. Pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }.` }],
        }
      }
      const input = parsed.data as AskUserToolInput
      if (structuredDetails && input.artifacts?.length) {
        const current = currentHandoverArtifactsFromStructuredDetails(structuredDetails)
        const next = applyHandoverOperations(current, input.artifacts.map((artifact) => ({ action: "upsert" as const, artifact })))
        if (input.artifacts.some((artifact) => !next.some((candidate) => candidate.id === artifact.id && candidate === artifact))) {
          return {
            isError: true,
            content: [{ type: "text", text: "Invalid ask_user input: artifacts would exceed the current run handover bounds." }],
            details: { code: HANDOVER_ERROR_CODES.INVALID_INPUT },
          }
        }
      }
      try {
        const result = await options.runtime.ask({ ...input, sessionId: sessionId ?? resolveSessionId(options.sessionId), ownerPrincipalId }, signal)
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

function resolveSessionId(sessionId: string | (() => string)): string {
  return typeof sessionId === "function" ? sessionId() : sessionId
}

function formatAskUserResult(result: AskUserToolResult, input: AskUserToolInput): AskUserToolResultPayload {
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

