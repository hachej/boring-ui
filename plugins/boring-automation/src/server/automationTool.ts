import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-agent/shared"
import { z } from "zod"
import {
  AutomationCreateSchema,
  AutomationPatchSchema,
  BORING_AUTOMATION_ERROR_CODES,
  type BoringAutomationErrorCode,
} from "../shared"
import { parseAutomationModel } from "./manualRunExecutor"
import type { AutomationOperations, AutomationUpdateInput } from "./operations"
import { AutomationStoreError } from "./store"

export const BORING_AUTOMATION_TOOL_NAME = "boring_automation"

const nonEmpty = z.string().trim().min(1)
const limit = z.number().int().min(1).max(100).optional()
const thinkingLevel = z.enum(["off", "low", "medium", "high"])

const listInput = z.object({ operation: z.literal("list"), limit }).strict()
const getInput = z.object({ operation: z.literal("get"), automationId: nonEmpty }).strict()
const createInput = z.object({
  operation: z.literal("create"),
  title: nonEmpty,
  enabled: z.boolean().optional(),
  cron: nonEmpty,
  timezone: nonEmpty,
  model: nonEmpty,
  thinkingLevel: thinkingLevel.optional(),
  prompt: z.string().optional(),
}).strict()
const updateInput = z.object({
  operation: z.literal("update"),
  automationId: nonEmpty,
  title: nonEmpty.optional(),
  enabled: z.boolean().optional(),
  cron: nonEmpty.optional(),
  timezone: nonEmpty.optional(),
  model: nonEmpty.optional(),
  thinkingLevel: thinkingLevel.optional(),
  prompt: z.string().optional(),
}).strict()
const idInput = (operation: "pause" | "resume" | "run" | "delete") => z.object({
  operation: z.literal(operation),
  automationId: nonEmpty,
}).strict()
const listRunsInput = z.object({ operation: z.literal("list_runs"), automationId: nonEmpty, limit }).strict()

const AutomationToolInputSchema = z.discriminatedUnion("operation", [
  listInput,
  getInput,
  createInput,
  updateInput,
  idInput("pause"),
  idInput("resume"),
  idInput("run"),
  listRunsInput,
  idInput("delete"),
])

type AutomationToolInput = z.infer<typeof AutomationToolInputSchema>
type ToolOperation = AutomationToolInput["operation"]

export interface BoringAutomationToolDependencies {
  resolveOperationsForActor(actorContext: { workspaceId?: string; userId?: string }): Promise<{
    operations: AutomationOperations
  }>
}

export function createBoringAutomationTool(deps: BoringAutomationToolDependencies): AgentTool {
  return {
    name: BORING_AUTOMATION_TOOL_NAME,
    description: [
      "Manage scheduled automations in the active workspace.",
      "Supports list, get, create, update, pause, resume, run, list_runs, and delete.",
      "Models supplied to create/update must use explicit provider:model-id syntax.",
      "Pause affects future scheduled runs only; manual run remains allowed.",
      "Delete removes automation metadata only and preserves prompt files, run history, and sessions.",
    ].join(" "),
    promptSnippet: "Use boring_automation to manage scheduled prompts in this workspace.",
    parameters: automationToolJsonSchema(),
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const operation = operationForError(params)
      try {
        assertNotAborted(ctx)
        if (!isPlainRecord(params)) throw invalidBody()
        const parsed = AutomationToolInputSchema.safeParse(params)
        if (!parsed.success) throw invalidBody()
        validateToolInput(parsed.data)
        const { operations } = await deps.resolveOperationsForActor({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
        })
        assertNotAborted(ctx)
        const details = await executeOperation(operations, parsed.data, ctx)
        return result(details, false)
      } catch (cause) {
        return result(errorDetails(operation, cause), true)
      }
    },
  }
}

async function executeOperation(operations: AutomationOperations, input: AutomationToolInput, ctx: ToolExecContext) {
  switch (input.operation) {
    case "list": {
      const listed = await operations.list(input.limit)
      return { ok: true as const, operation: input.operation, automations: listed.items, truncated: listed.truncated }
    }
    case "get": {
      return { ok: true as const, operation: input.operation, ...(await operations.get(input.automationId)) }
    }
    case "create": {
      assertNotAborted(ctx)
      const { operation: _operation, ...body } = input
      const automation = await operations.create(AutomationCreateSchema.parse(body))
      return { ok: true as const, operation: input.operation, automation }
    }
    case "update": {
      assertNotAborted(ctx)
      const { operation: _operation, automationId, prompt, ...metadata } = input
      const patch = Object.keys(metadata).length > 0 ? AutomationPatchSchema.parse(metadata) : {}
      const update: AutomationUpdateInput = { ...patch, ...(prompt !== undefined ? { prompt } : {}) }
      const automation = await operations.update(automationId, update)
      return { ok: true as const, operation: input.operation, automation }
    }
    case "pause": {
      assertNotAborted(ctx)
      return { ok: true as const, operation: input.operation, automation: await operations.pause(input.automationId) }
    }
    case "resume": {
      assertNotAborted(ctx)
      return { ok: true as const, operation: input.operation, automation: await operations.resume(input.automationId) }
    }
    case "run": {
      assertNotAborted(ctx)
      return { ok: true as const, operation: input.operation, run: await operations.run(input.automationId) }
    }
    case "list_runs": {
      const listed = await operations.listRuns(input.automationId, input.limit)
      return { ok: true as const, operation: input.operation, runs: listed.items, truncated: listed.truncated }
    }
    case "delete": {
      assertNotAborted(ctx)
      return { ok: true as const, operation: input.operation, deleted: await operations.delete(input.automationId) }
    }
  }
}

function validateToolInput(input: AutomationToolInput): void {
  if (input.operation === "update" && !Object.keys(input).some((key) => key !== "operation" && key !== "automationId")) {
    throw invalidBody()
  }
  if (input.operation === "create") parseAutomationModel(input.model)
  if (input.operation === "update" && input.model !== undefined) parseAutomationModel(input.model)
}

function assertNotAborted(ctx: ToolExecContext): void {
  if (ctx.abortSignal.aborted) {
    throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.TOOL_ABORTED, "automation tool call was aborted")
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function operationForError(params: unknown): ToolOperation | "unknown" {
  if (!isPlainRecord(params)) return "unknown"
  const operation = (params as { operation?: unknown }).operation
  return typeof operation === "string" && TOOL_OPERATIONS.has(operation as ToolOperation)
    ? operation as ToolOperation
    : "unknown"
}

const TOOL_OPERATIONS = new Set<ToolOperation>(["list", "get", "create", "update", "pause", "resume", "run", "list_runs", "delete"])

function errorDetails(operation: ToolOperation | "unknown", cause: unknown) {
  const code = knownErrorCode(cause)
  return { ok: false as const, operation, code, error: publicErrorMessage(code) }
}

function knownErrorCode(cause: unknown): BoringAutomationErrorCode {
  if (cause instanceof AutomationStoreError && Object.values(BORING_AUTOMATION_ERROR_CODES).includes(cause.code as BoringAutomationErrorCode)) {
    return cause.code as BoringAutomationErrorCode
  }
  if (cause instanceof z.ZodError) {
    const field = cause.issues[0]?.path[0]
    if (field === "cron") return BORING_AUTOMATION_ERROR_CODES.INVALID_CRON
    if (field === "timezone") return BORING_AUTOMATION_ERROR_CODES.INVALID_TIMEZONE
    return BORING_AUTOMATION_ERROR_CODES.INVALID_BODY
  }
  return BORING_AUTOMATION_ERROR_CODES.OPERATION_FAILED
}

function publicErrorMessage(code: BoringAutomationErrorCode): string {
  switch (code) {
    case BORING_AUTOMATION_ERROR_CODES.INVALID_BODY: return "Invalid automation tool input."
    case BORING_AUTOMATION_ERROR_CODES.INVALID_CRON: return "The cron schedule must contain five valid fields."
    case BORING_AUTOMATION_ERROR_CODES.INVALID_TIMEZONE: return "The timezone must be a valid IANA timezone."
    case BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL: return "Use explicit provider:model-id syntax, for example anthropic:claude-sonnet."
    case BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND: return "Automation not found in the active workspace."
    case BORING_AUTOMATION_ERROR_CODES.PROMPT_CONFLICT: return "The automation prompt changed elsewhere. Reload it before saving."
    case BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND: return "Automation run not found in the active workspace."
    case BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE: return "This automation already has an active run."
    case BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED: return "This scheduled automation occurrence was already recorded."
    case BORING_AUTOMATION_ERROR_CODES.RUN_EXECUTOR_UNAVAILABLE: return "Automation execution is unavailable."
    case BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE: return "Automation tool context is unavailable."
    case BORING_AUTOMATION_ERROR_CODES.TOOL_ABORTED: return "Automation tool call was aborted."
    case BORING_AUTOMATION_ERROR_CODES.TRIGGER_FORBIDDEN: return "Automation trigger is forbidden."
    case BORING_AUTOMATION_ERROR_CODES.TRIGGER_UNAUTHORIZED: return "Automation trigger is unauthorized."
    case BORING_AUTOMATION_ERROR_CODES.OWNER_UNAUTHORIZED: return "Automation owner is unauthorized."
    case BORING_AUTOMATION_ERROR_CODES.RUN_FAILED: return "Automation execution failed."
    case BORING_AUTOMATION_ERROR_CODES.OPERATION_FAILED: return "Automation operation failed."
  }
}

function invalidBody(): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.INVALID_BODY, "invalid automation tool input")
}

function result(details: object, isError: boolean): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details, isError }
}

function automationToolJsonSchema(): Record<string, unknown> {
  const id = { type: "string", minLength: 1 }
  const limitSchema = { type: "integer", minimum: 1, maximum: 100 }
  const operationOnly = (operation: string, extra: Record<string, unknown> = {}, required: string[] = []) => ({
    type: "object",
    properties: { operation: { const: operation }, ...extra },
    required: ["operation", ...required],
    additionalProperties: false,
  })
  return {
    oneOf: [
      operationOnly("list", { limit: limitSchema }),
      operationOnly("get", { automationId: id }, ["automationId"]),
      operationOnly("create", {
        title: id, enabled: { type: "boolean" }, cron: id, timezone: id, model: id,
        thinkingLevel: { enum: ["off", "low", "medium", "high"] }, prompt: { type: "string" },
      }, ["title", "cron", "timezone", "model"]),
      {
        ...operationOnly("update", {
          automationId: id, title: id, enabled: { type: "boolean" }, cron: id, timezone: id, model: id,
          thinkingLevel: { enum: ["off", "low", "medium", "high"] }, prompt: { type: "string" },
        }, ["automationId"]),
        anyOf: ["title", "enabled", "cron", "timezone", "model", "thinkingLevel", "prompt"].map((field) => ({ required: [field] })),
      },
      operationOnly("pause", { automationId: id }, ["automationId"]),
      operationOnly("resume", { automationId: id }, ["automationId"]),
      operationOnly("run", { automationId: id }, ["automationId"]),
      operationOnly("list_runs", { automationId: id, limit: limitSchema }, ["automationId"]),
      operationOnly("delete", { automationId: id }, ["automationId"]),
    ],
  }
}
