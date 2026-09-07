import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace"
import { OBJECTIVE_STATUSES } from "../shared/constants"
import { ObjectiveError, OBJECTIVE_ERROR_CODES } from "../shared/error-codes"
import {
  validateCreateObjectiveInput,
  validateGetObjectiveInput,
  validateListObjectivesInput,
  validateUpdateObjectiveInput,
} from "../shared/schema"
import type { ObjectiveStore } from "./objectiveStore"

export interface CreateObjectiveToolsOptions {
  store: ObjectiveStore
}

const statusEnum = { type: "string", enum: [...OBJECTIVE_STATUSES] }

function textResult(text: string, details: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, isError }
}

function invalidFailure(prefix: string, message: string): ToolResult {
  return textResult(`${prefix}: ${message}`, { code: OBJECTIVE_ERROR_CODES.VALIDATION_INVALID }, true)
}

function failure(prefix: string, error: unknown): ToolResult {
  const objectiveError = error instanceof ObjectiveError
    ? error
    : new ObjectiveError(OBJECTIVE_ERROR_CODES.STORE_IO, "unexpected objective storage failure", { cause: error })
  return textResult(
    `${prefix}: ${objectiveError.message}`,
    { code: objectiveError.code },
    true,
  )
}

export function createObjectiveTools(options: CreateObjectiveToolsOptions): AgentTool[] {
  const { store } = options
  return [
    {
      name: "list_objectives",
      description: "List one page of Objectives, optionally filtered by status. Pass nextCursor as cursor to continue.",
      parameters: {
        type: "object",
        properties: {
          status: statusEnum,
          limit: { type: "number", minimum: 1, maximum: 20 },
          cursor: { type: "string", pattern: "^[0-9]+$" },
        },
        additionalProperties: false,
      },
      async execute(params: Record<string, unknown>, _ctx: ToolExecContext) {
        const parsed = validateListObjectivesInput(params)
        if (!parsed.success) return invalidFailure("Invalid list_objectives input", parsed.error.issues[0]?.message ?? parsed.error.message)
        try {
          const all = await store.list(parsed.data.status)
          const offset = parsed.data.cursor ? Number(parsed.data.cursor) : 0
          if (!Number.isSafeInteger(offset) || offset > all.length) {
            return invalidFailure("Invalid list_objectives input", "cursor is out of range")
          }
          const limit = parsed.data.limit ?? 20
          const objectives = all.slice(offset, offset + limit)
          const nextOffset = offset + objectives.length
          const nextCursor = nextOffset < all.length ? String(nextOffset) : undefined
          return textResult(
            `Found ${objectives.length} objective(s) in this page${nextCursor ? "; more are available" : ""}.`,
            { objectives, ...(nextCursor ? { nextCursor } : {}) },
          )
        } catch (error) {
          return failure("list_objectives failed", error)
        }
      },
    },
    {
      name: "get_objective",
      description: "Get a single Objective by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params: Record<string, unknown>, _ctx: ToolExecContext) {
        const parsed = validateGetObjectiveInput(params)
        if (!parsed.success) return invalidFailure("Invalid get_objective input", parsed.error.issues[0]?.message ?? parsed.error.message)
        try {
          const objective = await store.get(parsed.data.id)
          if (!objective) {
            return textResult(
              `Objective ${parsed.data.id} not found.`,
              { code: OBJECTIVE_ERROR_CODES.NOT_FOUND, objective: null },
              true,
            )
          }
          return textResult(`Objective ${objective.id}: ${objective.title}.`, { objective })
        } catch (error) {
          return failure("get_objective failed", error)
        }
      },
    },
    {
      name: "create_objective",
      description: "Create an Objective: a statement, a metric, a baseline/target/current, constraints, and evidence references. Never call this 'goal', 'investigation', or 'action' when talking to the user; the kernel noun is Objective.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title." },
          objective: { type: "string", description: "The objective statement — what 'done' means." },
          metric: { type: "string", description: "The metric this objective is measured by." },
          baseline: { type: "number", description: "Starting value of the metric." },
          target: { type: "number", description: "Target value of the metric." },
          current: { type: "number", description: "Current value of the metric. Defaults to baseline." },
          status: statusEnum,
          constraints: { type: "array", items: { type: "string" }, description: "Constraints bounding how this objective may be pursued." },
          evidenceRefs: { type: "array", items: { type: "string" }, description: "References (paths, URLs, artifact ids) supporting progress." },
          outcome: { type: "string", description: "Optional outcome note, typically set when the objective is achieved or abandoned." },
          clientRequestId: { type: "string", description: "Optional idempotency key. Retrying create_objective with the same clientRequestId returns the original objective instead of creating a duplicate." },
        },
        required: ["title", "objective", "metric", "baseline", "target"],
        additionalProperties: false,
      },
      async execute(params: Record<string, unknown>, _ctx: ToolExecContext) {
        const parsed = validateCreateObjectiveInput(params)
        if (!parsed.success) return invalidFailure("Invalid create_objective input", parsed.error.issues[0]?.message ?? parsed.error.message)
        try {
          const objective = await store.create(parsed.data)
          return textResult(`Created objective ${objective.id}: ${objective.title}.`, { objective })
        } catch (error) {
          return failure("create_objective failed", error)
        }
      },
    },
    {
      name: "update_objective",
      description: "Update an existing Objective by id. Only the provided fields change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          objective: { type: "string" },
          metric: { type: "string" },
          baseline: { type: "number" },
          target: { type: "number" },
          current: { type: "number" },
          status: statusEnum,
          constraints: { type: "array", items: { type: "string" } },
          evidenceRefs: { type: "array", items: { type: "string" } },
          outcome: { type: "string" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params: Record<string, unknown>, _ctx: ToolExecContext) {
        const parsed = validateUpdateObjectiveInput(params)
        if (!parsed.success) return invalidFailure("Invalid update_objective input", parsed.error.issues[0]?.message ?? parsed.error.message)
        try {
          const objective = await store.update(parsed.data)
          return textResult(`Updated objective ${objective.id}.`, { objective })
        } catch (error) {
          return failure("update_objective failed", error)
        }
      },
    },
  ]
}
