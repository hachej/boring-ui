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
  execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, sessionId?: string): Promise<AskUserToolResultPayload>
}

export type AskUserToolOptions = {
  runtime: AskUserRuntime
  sessionId: string | (() => string)
}

export function createAskUserTool(options: AskUserToolOptions): AskUserToolDefinition {
  return {
    name: "ask_user",
    label: "Ask user",
    description: "Ask the user a blocking structured question in the Workspace Questions pane. Supports true multi-field forms via schema.fields (text, textarea, select, radio, multiselect, checkbox, number).",
    promptSnippet: "Use `ask_user` whenever you need a human decision. It opens a blocking form in the Workspace Questions pane; do not simulate the question in chat. Pass `schema: { wireVersion: 1, fields: [...] }` with field types `text`, `textarea`, `select`, `radio`, `multiselect`, `checkbox`, or `number`. If your question is about an artifact you have produced (e.g., a plan file, a design spec, an HTML demo, or a code diff), ALWAYS pass the `artifact` parameter containing `{ surfaceKind: 'file' | 'browser', target: string }` so the user can inspect it next to your question.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short question title." },
        context: { type: "string", description: "Optional context shown above the form." },
        artifact: {
          type: "object",
          description: "Optional associated artifact the user should review, e.g. { surfaceKind: 'file', target: 'path/to/plan.md' } or { surfaceKind: 'browser', target: 'http://localhost:5173' }.",
          properties: {
            surfaceKind: { type: "string", description: "Kind of surface to open, e.g. 'file' or 'browser'." },
            target: { type: "string", description: "The path or URL to open." },
          },
          required: ["surfaceKind", "target"],
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
    async execute(_toolCallId, params, signal, sessionId) {
      const parsed = validateAskUserToolInput(params)
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. Pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }.` }],
        }
      }
      const input = parsed.data as AskUserToolInput
      try {
        const result = await options.runtime.ask({ ...input, sessionId: sessionId ?? resolveSessionId(options.sessionId) }, signal)
        return formatAskUserResult(result)
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

function formatAskUserResult(result: AskUserToolResult): AskUserToolResultPayload {
  if (result.status === "answered") {
    return {
      content: [{ type: "text", text: `User answered: ${JSON.stringify(result.answer.values)}. Continue the conversation using this answer.` }],
      details: result,
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: `User question cancelled: ${result.reason}` }],
    details: result,
  }
}

