import type { AgentTool, ToolExecContext, ToolResult } from "@hachej/boring-workspace"
import { OBJECTIVE_STATUSES } from "../shared/constants"
import {
  validateCreateObjectiveInput,
  validateGetObjectiveInput,
  validateListObjectivesInput,
  validateUpdateObjectiveInput,
} from "../shared/schema"
import { ObjectiveStoreError, type ObjectiveStore } from "./objectiveStore"

export interface CreateObjectiveToolsOptions {
  store: ObjectiveStore
}

const statusEnum = { type: "string", enum: [...OBJECTIVE_STATUSES] }

function textResult(text: string, details: unknown, isError = false): ToolResult {
  return { content: [{ type: "text", text }], details, isError }
}

function failure(prefix: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return textResult(
    `${prefix}: ${message}`,
    error instanceof ObjectiveStoreError ? { code: error.code } : undefined,
    true,
  )
}

export function createObjectiveTools(options: CreateObjectiveToolsOptions): AgentTool[] {
  const { store } = options
  return [
    {
      name: "list_objectives",
      description: "List Objectives (the thin Goal primitive), optionally filtered by status.",
      parameters: {
        type: "object",
        properties: { status: statusEnum },
        additionalProperties: false,
      },
      async execute(params: Record<string, unknown>, _ctx: ToolExecContext) {
        const parsed = validateListObjectivesInput(params)
        if (!parsed.success) return textResult(`Invalid list_objectives input: ${parsed.error.issues[0]?.message ?? parsed.error.message}`, undefined, true)
        try {
          const objectives = await store.list(parsed.data.status)
          return textResult(`Found ${objectives.length} objective(s).`, { objectives })
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
        if (!parsed.success) return textResult(`Invalid get_objective input: ${parsed.error.issues[0]?.message ?? parsed.error.message}`, undefined, true)
        try {
          const objective = await store.get(parsed.data.id)
          if (!objective) return textResult(`Objective ${parsed.data.id} not found.`, { objective: null }, true)
          return textResult(`Objective ${objective.id}: ${objective.title}.`, { objective })
        } catch (error) {
          return failure("get_objective failed", error)
        }
      },
    },
    {
      name: "create_objective",
      description: "Create an Objective — the thin Goal primitive: a statement, a metric, a baseline/target/current, constraints, and evidence references. Never call this 'goal', 'investigation', or 'action' when talking to the user; the kernel noun is Objective.",
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
        if (!parsed.success) return textResult(`Invalid create_objective input: ${parsed.error.issues[0]?.message ?? parsed.error.message}`, undefined, true)
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
        if (!parsed.success) return textResult(`Invalid update_objective input: ${parsed.error.issues[0]?.message ?? parsed.error.message}`, undefined, true)
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
