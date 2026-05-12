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
  promptSnippet?: string
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
    description: "Ask the user a blocking structured question in the Workspace Questions pane. Supports true multi-field forms via schema.fields (text, textarea, select, radio, multiselect, checkbox, number).",
    promptSnippet: "Use `ask_user` whenever you need a missing user decision before continuing. It opens a blocking form in the Workspace Questions pane; do not simulate the question in chat. It supports true multi-field forms: pass `schema: { wireVersion: 1, fields: [...] }` with field types `text`, `textarea`, `select`, `radio`, `multiselect`, `checkbox`, or `number`. Do not describe fields only in `context`; put every requested input in `schema.fields`. Omitting schema is accepted only for an obvious simple A/B choice.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short question title." },
        context: { type: "string", description: "Optional context shown above the form." },
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
      required: ["title"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      const parsed = validateAskUserToolInput(normalizeAskUserToolParams(params))
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid ask_user input: ${parsed.error.issues[0]?.message ?? parsed.error.message}. For multi-field forms, pass schema: { wireVersion: 1, fields: [{ type, name, label, ... }] }; do not list fields only in context.` }],
        }
      }
      const input = parsed.data as AskUserToolInput
      try {
        const result = await options.runtime.ask({ ...input, sessionId: resolveSessionId(options.sessionId) }, signal)
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

export function createAskUserPiExtensionFactory(options: AskUserPiExtensionOptions): AskUserPiExtensionFactory {
  return (api) => {
    // Principle 3 justification: native pi-ask-user inspired this tool shape, but Workspace
    // owns its own implementation because answers must flow through the Questions pane,
    // persisted React form state, and a browser->server command channel instead of Pi-only UI.
    ;(api as AskUserPiExtensionApi).registerTool(createAskUserPiTool(options))
  }
}

function normalizeAskUserToolParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeJsonSchemaRequired(params)
  if (normalized.schema && typeof normalized.schema === "object" && "wireVersion" in normalized.schema) return normalized
  if (!isObviousBinaryChoice(normalized)) return normalized
  return {
    ...normalized,
    schema: {
      wireVersion: 1,
      fields: [
        {
          type: "radio",
          name: "choice",
          label: "Choose one",
          required: true,
          options: [
            { value: "A", label: "A" },
            { value: "B", label: "B" },
          ],
        },
      ],
    },
  }
}

function normalizeJsonSchemaRequired(params: Record<string, unknown>): Record<string, unknown> {
  const { required: topLevelRequired, ...withoutTopLevelRequired } = params
  const schema = withoutTopLevelRequired.schema
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return withoutTopLevelRequired

  const schemaRecord = schema as Record<string, unknown>
  const { required, ...schemaWithoutRequired } = schemaRecord
  if (!Array.isArray(required) || !Array.isArray(schemaRecord.fields)) {
    return schemaRecord === schema ? withoutTopLevelRequired : { ...withoutTopLevelRequired, schema: schemaWithoutRequired }
  }

  const requiredNames = new Set(required.filter((value): value is string => typeof value === "string"))
  return {
    ...withoutTopLevelRequired,
    schema: {
      ...schemaWithoutRequired,
      fields: schemaRecord.fields.map((field) => {
        if (!field || typeof field !== "object" || Array.isArray(field)) return field
        const fieldRecord = field as Record<string, unknown>
        return typeof fieldRecord.name === "string" && requiredNames.has(fieldRecord.name)
          ? { ...fieldRecord, required: fieldRecord.required ?? true }
          : fieldRecord
      }),
    },
  }
}

function isObviousBinaryChoice(params: Record<string, unknown>): boolean {
  const text = `${typeof params.title === "string" ? params.title : ""} ${typeof params.context === "string" ? params.context : ""}`.toLowerCase()
  return /\b(a\s*or\s*b|choose\s+(?:one\s+)?(?:between\s+)?a\s*(?:\/|or)\s*b|pick\s+(?:either\s+)?a\s*(?:\/|or)\s*b)\b/.test(text)
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
