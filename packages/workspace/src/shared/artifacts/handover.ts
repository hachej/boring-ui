import { z } from "zod"
import { HUMAN_ARTIFACT_LIMITS, HumanArtifactListSchema, HumanArtifactSchema, type HumanArtifact } from "./humanArtifact"

export const HANDOVER_OPERATION_DETAIL_KINDS = [
  "boring.handover.operation",
  "boring.handover.operations",
] as const

const artifactIdSchema = z.string().trim().min(1).max(HUMAN_ARTIFACT_LIMITS.maxIdLength)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "must not contain control characters")

export const HandoverOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("upsert"), artifact: HumanArtifactSchema }).strict(),
  z.object({ action: z.literal("remove"), artifactId: artifactIdSchema }).strict(),
])

export type HandoverOperation = z.infer<typeof HandoverOperationSchema>

export const HandoverOperationDetailsSchema = z.object({
  kind: z.literal("boring.handover.operation"),
  wireVersion: z.literal(1),
  operation: HandoverOperationSchema,
}).strict()

export const HandoverOperationsDetailsSchema = z.object({
  kind: z.literal("boring.handover.operations"),
  wireVersion: z.literal(1),
  operations: z.array(HandoverOperationSchema).max(HUMAN_ARTIFACT_LIMITS.maxArtifactsPerRun),
}).strict()

export const HandoverSnapshotDetailsSchema = z.object({
  kind: z.literal("boring.handover.snapshot"),
  wireVersion: z.literal(1),
  artifacts: HumanArtifactListSchema,
}).strict()

export type HandoverOperationDetails = z.infer<typeof HandoverOperationDetailsSchema>
export type HandoverOperationsDetails = z.infer<typeof HandoverOperationsDetailsSchema>
export type HandoverSnapshotDetails = z.infer<typeof HandoverSnapshotDetailsSchema>

export interface ProjectedHandover {
  id: string
  runId: string
  terminalEntryId: string
  createdAt?: string
  artifacts: HumanArtifact[]
}

interface ActiveRun {
  runId: string
  artifacts: HumanArtifact[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function applyHandoverOperations(
  current: readonly HumanArtifact[],
  operations: readonly HandoverOperation[],
): HumanArtifact[] {
  let artifacts = [...current]
  for (const operation of operations) {
    const before = artifacts
    if (operation.action === "remove") {
      artifacts = artifacts.filter((artifact) => artifact.id !== operation.artifactId)
    } else {
      const index = artifacts.findIndex((artifact) => artifact.id === operation.artifact.id)
      artifacts = index < 0
        ? [...artifacts, operation.artifact]
        : artifacts.map((artifact, artifactIndex) => artifactIndex === index ? operation.artifact : artifact)
    }
    if (!HumanArtifactListSchema.safeParse(artifacts).success) artifacts = before
  }
  return artifacts
}

export function handoverOperationsFromDetails(details: unknown): HandoverOperation[] {
  const single = HandoverOperationDetailsSchema.safeParse(details)
  if (single.success) return [single.data.operation]
  const multiple = HandoverOperationsDetailsSchema.safeParse(details)
  if (multiple.success) return multiple.data.operations
  return isRecord(details) && "handover" in details
    ? handoverOperationsFromDetails(details.handover)
    : []
}

export type HandoverProjectionEvent =
  | { type: "run-start"; runId: string }
  | { type: "tool-result"; entryId: string; isError: boolean; details?: unknown }
  | { type: "run-terminal"; entryId: string; state: "success" | "error" | "aborted" | "interrupted"; createdAt?: string }

export interface StructuredDetailRecord {
  detail: unknown
}

export function projectHandovers(events: readonly HandoverProjectionEvent[]): ProjectedHandover[] {
  const handovers: ProjectedHandover[] = []
  let active: ActiveRun | null = null

  for (const event of events) {
    if (event.type === "run-start") {
      active = { runId: event.runId, artifacts: [] }
      continue
    }
    if (event.type === "tool-result") {
      if (active && !event.isError) {
        active.artifacts = applyHandoverOperations(active.artifacts, handoverOperationsFromDetails(event.details))
      }
      continue
    }
    if (event.state === "success" && active && active.artifacts.length > 0) {
      handovers.push({
        id: `handover:${event.entryId}`,
        runId: active.runId,
        terminalEntryId: event.entryId,
        createdAt: event.createdAt,
        artifacts: [...active.artifacts],
      })
    }
    active = null
  }

  return handovers
}

export function currentHandoverArtifactsFromStructuredDetails(
  details: readonly StructuredDetailRecord[],
): HumanArtifact[] {
  return details.reduce(
    (artifacts, record) => applyHandoverOperations(artifacts, handoverOperationsFromDetails(record.detail)),
    [] as HumanArtifact[],
  )
}
