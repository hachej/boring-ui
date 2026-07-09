import { z } from "zod"

const nonEmptyString = z.string().trim().min(1)
const isoString = z.string().datetime({ offset: true })
const nonNegativeInteger = z.number().int().nonnegative()

export const AutomationRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"])
export const AutomationRunTriggerSchema = z.enum(["manual", "scheduled"])

export const AutomationCreateSchema = z.object({
  title: nonEmptyString,
  enabled: z.boolean().optional(),
  cron: nonEmptyString,
  timezone: nonEmptyString,
  model: nonEmptyString,
  prompt: z.string().optional(),
}).strict()

export const AutomationPatchSchema = z.object({
  title: nonEmptyString.optional(),
  enabled: z.boolean().optional(),
  cron: nonEmptyString.optional(),
  timezone: nonEmptyString.optional(),
  model: nonEmptyString.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one field must be provided")

export const PromptUpdateSchema = z.object({
  prompt: z.string(),
}).strict()

export const AutomationRunCreateSchema = z.object({
  automationId: nonEmptyString,
  sessionId: nonEmptyString.optional(),
  status: AutomationRunStatusSchema.optional(),
  trigger: AutomationRunTriggerSchema,
  scheduledFor: isoString.optional(),
  startedAt: isoString.optional(),
  completedAt: isoString.optional(),
  durationMs: nonNegativeInteger.optional(),
  inputTokens: nonNegativeInteger.optional(),
  outputTokens: nonNegativeInteger.optional(),
  totalTokens: nonNegativeInteger.optional(),
  promptSnapshot: z.string(),
  modelSnapshot: nonEmptyString,
  cronSnapshot: nonEmptyString,
  timezoneSnapshot: nonEmptyString,
  error: z.string().optional(),
}).strict()

export const AutomationRunPatchSchema = z.object({
  sessionId: nonEmptyString.nullable().optional(),
  status: AutomationRunStatusSchema.optional(),
  scheduledFor: isoString.nullable().optional(),
  startedAt: isoString.nullable().optional(),
  completedAt: isoString.nullable().optional(),
  durationMs: nonNegativeInteger.nullable().optional(),
  inputTokens: nonNegativeInteger.nullable().optional(),
  outputTokens: nonNegativeInteger.nullable().optional(),
  totalTokens: nonNegativeInteger.nullable().optional(),
  error: z.string().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one field must be provided")

export const IdParamsSchema = z.object({ id: nonEmptyString })
export const RunIdParamsSchema = z.object({ id: nonEmptyString, runId: nonEmptyString })

export type AutomationCreateInput = z.infer<typeof AutomationCreateSchema>
export type AutomationPatchInput = z.infer<typeof AutomationPatchSchema>
export type AutomationRunCreateInput = z.infer<typeof AutomationRunCreateSchema>
export type AutomationRunPatchInput = z.infer<typeof AutomationRunPatchSchema>
