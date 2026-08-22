import { z } from "zod"
import { OBJECTIVE_SCHEMA_LIMITS, OBJECTIVE_STATUSES } from "./constants"

export const ObjectiveStatusSchema = z.enum(OBJECTIVE_STATUSES)

const boundedString = (max: number) => z.string().max(max)
const titleSchema = boundedString(OBJECTIVE_SCHEMA_LIMITS.maxTitleLength).min(1)
const objectiveStatementSchema = boundedString(OBJECTIVE_SCHEMA_LIMITS.maxObjectiveLength).min(1)
const metricSchema = boundedString(OBJECTIVE_SCHEMA_LIMITS.maxMetricLength).min(1)
const outcomeSchema = boundedString(OBJECTIVE_SCHEMA_LIMITS.maxOutcomeLength)
const constraintsSchema = z
  .array(boundedString(OBJECTIVE_SCHEMA_LIMITS.maxConstraintLength))
  .max(OBJECTIVE_SCHEMA_LIMITS.maxConstraints)
const evidenceRefsSchema = z
  .array(boundedString(OBJECTIVE_SCHEMA_LIMITS.maxEvidenceRefLength))
  .max(OBJECTIVE_SCHEMA_LIMITS.maxEvidenceRefs)

export const ObjectiveSchema = z
  .object({
    id: z.string().min(1),
    title: titleSchema,
    objective: objectiveStatementSchema,
    metric: metricSchema,
    baseline: z.number().finite(),
    target: z.number().finite(),
    current: z.number().finite(),
    status: ObjectiveStatusSchema,
    constraints: constraintsSchema,
    evidenceRefs: evidenceRefsSchema,
    outcome: outcomeSchema.optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()

export const CreateObjectiveInputSchema = z
  .object({
    title: titleSchema,
    objective: objectiveStatementSchema,
    metric: metricSchema,
    baseline: z.number().finite(),
    target: z.number().finite(),
    current: z.number().finite().optional(),
    status: ObjectiveStatusSchema.optional(),
    constraints: constraintsSchema.optional(),
    evidenceRefs: evidenceRefsSchema.optional(),
    outcome: outcomeSchema.optional(),
  })
  .strict()

export const UpdateObjectiveInputSchema = z
  .object({
    id: z.string().min(1),
    title: titleSchema.optional(),
    objective: objectiveStatementSchema.optional(),
    metric: metricSchema.optional(),
    baseline: z.number().finite().optional(),
    target: z.number().finite().optional(),
    current: z.number().finite().optional(),
    status: ObjectiveStatusSchema.optional(),
    constraints: constraintsSchema.optional(),
    evidenceRefs: evidenceRefsSchema.optional(),
    outcome: outcomeSchema.optional(),
  })
  .strict()

export const GetObjectiveInputSchema = z.object({ id: z.string().min(1) }).strict()
export const ListObjectivesInputSchema = z.object({ status: ObjectiveStatusSchema.optional() }).strict()

export function validateCreateObjectiveInput(value: unknown) {
  return CreateObjectiveInputSchema.safeParse(value)
}

export function validateUpdateObjectiveInput(value: unknown) {
  return UpdateObjectiveInputSchema.safeParse(value)
}

export function validateGetObjectiveInput(value: unknown) {
  return GetObjectiveInputSchema.safeParse(value)
}

export function validateListObjectivesInput(value: unknown) {
  return ListObjectivesInputSchema.safeParse(value)
}

export type CreateObjectiveInputValue = z.infer<typeof CreateObjectiveInputSchema>
export type UpdateObjectiveInputValue = z.infer<typeof UpdateObjectiveInputSchema>
