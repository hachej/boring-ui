import { z } from "zod"
import { AUTOMATION_SCHEDULE_ERRORS, isValidFiveFieldCron, isValidIanaTimeZone } from "./schedule"

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
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
  prompt: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  addScheduleIssues(ctx, value)
})

export const AutomationPatchSchema = z.object({
  title: nonEmptyString.optional(),
  enabled: z.boolean().optional(),
  cron: nonEmptyString.optional(),
  timezone: nonEmptyString.optional(),
  model: nonEmptyString.optional(),
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, "at least one field must be provided")
  .superRefine((value, ctx) => {
    addScheduleIssues(ctx, value)
  })

export const PromptUpdateSchema = z.object({
  prompt: z.string(),
}).strict()

export const AutomationRunBeginSchema = z.object({
  automationId: nonEmptyString,
  trigger: AutomationRunTriggerSchema,
  scheduledFor: isoString.nullable().optional(),
  promptSnapshot: z.string(),
  modelSnapshot: nonEmptyString,
  createdAt: isoString.optional(),
}).strict()

export const AutomationRunLifecyclePatchSchema = z.object({
  sessionId: nonEmptyString.nullable().optional(),
  status: AutomationRunStatusSchema.optional(),
  startedAt: isoString.nullable().optional(),
  completedAt: isoString.nullable().optional(),
  durationMs: nonNegativeInteger.nullable().optional(),
  inputTokens: nonNegativeInteger.nullable().optional(),
  outputTokens: nonNegativeInteger.nullable().optional(),
  totalTokens: nonNegativeInteger.nullable().optional(),
  error: z.string().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one field must be provided")

export const IdParamsSchema = z.object({ id: nonEmptyString })

function addScheduleIssues(
  ctx: z.RefinementCtx,
  value: { cron?: string; timezone?: string },
): void {
  if (value.cron !== undefined && !isValidFiveFieldCron(value.cron)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cron"], message: AUTOMATION_SCHEDULE_ERRORS.INVALID_CRON })
  }
  if (value.timezone !== undefined && !isValidIanaTimeZone(value.timezone)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: AUTOMATION_SCHEDULE_ERRORS.INVALID_TIMEZONE })
  }
}

export type AutomationCreateInput = z.infer<typeof AutomationCreateSchema>
export type AutomationPatchInput = z.infer<typeof AutomationPatchSchema>
export type AutomationRunBeginInput = z.infer<typeof AutomationRunBeginSchema>
export type AutomationRunLifecyclePatchInput = z.infer<typeof AutomationRunLifecyclePatchSchema>
