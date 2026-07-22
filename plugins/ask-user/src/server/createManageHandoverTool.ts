import {
  HandoverOperationSchema,
  HumanArtifactListSchema,
  applyHandoverOperations,
  currentHandoverArtifactsFromStructuredDetails,
  type HandoverOperation,
} from "@hachej/boring-workspace/shared"
import { z } from "zod"
import { HANDOVER_ERROR_CODES } from "../shared/error-codes"

const ManageHandoverInputSchema = z.discriminatedUnion("action", [
  HandoverOperationSchema.options[0],
  HandoverOperationSchema.options[1],
  z.object({ action: z.literal("list") }).strict(),
])

type ManageHandoverInput = z.infer<typeof ManageHandoverInputSchema>

export interface ManageHandoverToolResult {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  details?: unknown
}

export interface ManageHandoverToolDefinition {
  name: "manage_handover"
  label: string
  description: string
  promptSnippet: string
  executionMode: "sequential"
  parameters: Record<string, unknown>
  execute(params: Record<string, unknown>, structuredDetails?: readonly { detail: unknown }[]): Promise<ManageHandoverToolResult>
}

export function createManageHandoverTool(): ManageHandoverToolDefinition {
  return {
    name: "manage_handover",
    label: "Manage handover",
    description: "Register, update, remove, or list intentional human-facing deliverables for this agent run. Non-blocking; never use it to request human input.",
    promptSnippet: "Use `manage_handover` for intentional human-facing outputs. `upsert` a deliverable by stable ID, `remove` stale registrations, or `list` the current run registry. This never blocks and never creates Inbox state.",
    executionMode: "sequential",
    parameters: {
      type: "object",
      oneOf: [
        {
          properties: {
            action: { const: "upsert" },
            artifact: {
              type: "object",
              properties: {
                id: { type: "string" },
                surfaceKind: { type: "string" },
                target: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
              },
              required: ["id", "surfaceKind", "target", "title"],
              additionalProperties: false,
            },
          },
          required: ["action", "artifact"],
          additionalProperties: false,
        },
        {
          properties: { action: { const: "remove" }, artifactId: { type: "string" } },
          required: ["action", "artifactId"],
          additionalProperties: false,
        },
        {
          properties: { action: { const: "list" } },
          required: ["action"],
          additionalProperties: false,
        },
      ],
    },
    async execute(params, structuredDetails) {
      const parsed = ManageHandoverInputSchema.safeParse(params)
      if (!parsed.success) return invalidResult(parsed.error.issues[0]?.message ?? parsed.error.message)
      if (!structuredDetails) {
        return {
          isError: true,
          content: [{ type: "text", text: "manage_handover requires trusted native transcript context." }],
          details: { code: HANDOVER_ERROR_CODES.CONTEXT_UNAVAILABLE },
        }
      }

      const current = currentHandoverArtifactsFromStructuredDetails(structuredDetails)
      if (parsed.data.action === "list") {
        return {
          content: [{ type: "text", text: current.length === 0
            ? "No human-facing deliverables are registered for this run."
            : `Registered human-facing deliverables: ${current.map((artifact) => `${artifact.id}: ${artifact.title}`).join("; ")}` }],
          details: { kind: "boring.handover.snapshot", wireVersion: 1, artifacts: current },
        }
      }

      const operation: HandoverOperation = parsed.data
      const next = applyHandoverOperations(current, [operation])
      if (!HumanArtifactListSchema.safeParse(next).success || (operation.action === "upsert" && !next.some((artifact) => artifact.id === operation.artifact.id && artifact === operation.artifact))) {
        return invalidResult("operation would exceed the current run artifact bounds")
      }
      return {
        content: [{ type: "text", text: operation.action === "upsert"
          ? `Registered ${operation.artifact.id}: ${operation.artifact.title}.`
          : `Removed ${operation.artifactId} from this run's handover registry.` }],
        details: { kind: "boring.handover.operation", wireVersion: 1, operation },
      }
    },
  }
}

function invalidResult(message: string): ManageHandoverToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Invalid manage_handover input: ${message}.` }],
    details: { code: HANDOVER_ERROR_CODES.INVALID_INPUT },
  }
}

export { ManageHandoverInputSchema }
export type { ManageHandoverInput }
