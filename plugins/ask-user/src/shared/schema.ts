import { z } from "zod"
import {
  ASK_USER_FIELD_NAME_PATTERN,
  ASK_USER_RESERVED_FIELD_NAMES,
  ASK_USER_SCHEMA_LIMITS,
  ASK_USER_COMMAND_KINDS,
} from "./constants"

const isoStringSchema = z.string().min(1)
const fieldNameSchema = z
  .string()
  .regex(ASK_USER_FIELD_NAME_PATTERN, "field name must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$")
  .refine((name) => !ASK_USER_RESERVED_FIELD_NAMES.has(name), "field name is reserved")

const boundedString = (max: number) => z.string().max(max)
const optionalBoundedString = (max: number) => boundedString(max).optional()

const askUserOptionSchema = z
  .object({
    value: z.string().min(1).max(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    label: boundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    description: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxHelpTextLength),
  })
  .strict()

const baseFieldSchema = {
  name: fieldNameSchema,
  label: boundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
  required: z.boolean().optional(),
  helpText: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxHelpTextLength),
}

function safePattern(pattern: string): boolean {
  try {
    // Approximate RE2 safety: disallow features known to cause JS regex footguns.
    if (/\\[1-9]/.test(pattern)) return false
    if (/\(\?([=!<]|<=|<!)/.test(pattern)) return false
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

const textFieldSchema = z
  .object({
    type: z.literal("text"),
    ...baseFieldSchema,
    placeholder: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    defaultValue: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength),
    minLength: z.number().int().min(0).max(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength).optional(),
    maxLength: z.number().int().min(0).max(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength).optional(),
    pattern: z.string().max(512).refine(safePattern, "pattern must be safe and valid").optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minLength"], message: "minLength must be <= maxLength" })
    }
    if (field.defaultValue !== undefined) {
      if (field.minLength !== undefined && field.defaultValue.length < field.minLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue shorter than minLength" })
      }
      if (field.maxLength !== undefined && field.defaultValue.length > field.maxLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue longer than maxLength" })
      }
    }
  })

const textareaFieldSchema = z
  .object({
    type: z.literal("textarea"),
    ...baseFieldSchema,
    placeholder: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    defaultValue: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength),
    minLength: z.number().int().min(0).max(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength).optional(),
    maxLength: z.number().int().min(0).max(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minLength"], message: "minLength must be <= maxLength" })
    }
  })

function optionsRefinement(field: { options: Array<{ value: string }>; defaultValue?: string }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>()
  for (let i = 0; i < field.options.length; i++) {
    const value = field.options[i]?.value
    if (seen.has(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options", i, "value"], message: "duplicate option value" })
    }
    seen.add(value)
  }
  if (field.defaultValue !== undefined && !seen.has(field.defaultValue)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue must reference an option value" })
  }
}

const selectFieldSchema = z
  .object({
    type: z.literal("select"),
    ...baseFieldSchema,
    options: z.array(askUserOptionSchema).min(2).max(ASK_USER_SCHEMA_LIMITS.maxOptionsPerField),
    defaultValue: z.string().optional(),
  })
  .strict()
  .superRefine(optionsRefinement)

const radioFieldSchema = z
  .object({
    type: z.literal("radio"),
    ...baseFieldSchema,
    options: z.array(askUserOptionSchema).min(2).max(ASK_USER_SCHEMA_LIMITS.maxOptionsPerField),
    defaultValue: z.string().optional(),
  })
  .strict()
  .superRefine(optionsRefinement)

const multiselectFieldSchema = z
  .object({
    type: z.literal("multiselect"),
    ...baseFieldSchema,
    options: z.array(askUserOptionSchema).min(1).max(ASK_USER_SCHEMA_LIMITS.maxOptionsPerField),
    defaultValue: z.array(z.string()).optional(),
    minSelections: z.number().int().min(0).optional(),
    maxSelections: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    const values = new Set<string>()
    for (let i = 0; i < field.options.length; i++) {
      const value = field.options[i]?.value
      if (values.has(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options", i, "value"], message: "duplicate option value" })
      }
      values.add(value)
    }
    if (field.defaultValue) {
      for (const value of field.defaultValue) {
        if (!values.has(value)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue must reference option values" })
        }
      }
    }
    if (field.minSelections !== undefined && field.maxSelections !== undefined && field.minSelections > field.maxSelections) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minSelections"], message: "minSelections must be <= maxSelections" })
    }
    if (field.maxSelections !== undefined && field.maxSelections > field.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxSelections"], message: "maxSelections must be <= options.length" })
    }
  })

const checkboxFieldSchema = z
  .object({
    type: z.literal("checkbox"),
    name: fieldNameSchema,
    label: boundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    defaultValue: z.boolean().optional(),
    helpText: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxHelpTextLength),
  })
  .strict()

const numberFieldSchema = z
  .object({
    type: z.literal("number"),
    ...baseFieldSchema,
    defaultValue: z.number().finite().optional(),
    placeholder: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    integer: z.boolean().optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["min"], message: "min must be <= max" })
    }
    if (field.defaultValue !== undefined) {
      if (field.integer && !Number.isInteger(field.defaultValue)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue must be an integer" })
      }
      if (field.min !== undefined && field.defaultValue < field.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue must be >= min" })
      }
      if (field.max !== undefined && field.defaultValue > field.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultValue"], message: "defaultValue must be <= max" })
      }
    }
  })

export const AskUserFieldSchema = z.union([
  textFieldSchema,
  textareaFieldSchema,
  selectFieldSchema,
  multiselectFieldSchema,
  checkboxFieldSchema,
  radioFieldSchema,
  numberFieldSchema,
])

export const AskUserFormSchemaSchema = z
  .object({
    wireVersion: z.literal(1),
    fields: z.array(AskUserFieldSchema).min(1).max(ASK_USER_SCHEMA_LIMITS.maxFields),
    submitLabel: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxLabelLength),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const names = new Set<string>()
    for (let i = 0; i < schema.fields.length; i++) {
      const name = schema.fields[i]?.name
      if (names.has(name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", i, "name"], message: "duplicate field name" })
      }
      names.add(name)
    }
    if (serializedSize(schema) > ASK_USER_SCHEMA_LIMITS.maxSerializedSchemaBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "schema exceeds max serialized size" })
    }
  })

export const AskUserArtifactSchema = z
  .object({
    surfaceKind: z.string().min(1),
    target: z.string().min(1),
  })
  .strict()

export const AskUserToolInputSchema = z
  .object({
    title: boundedString(ASK_USER_SCHEMA_LIMITS.maxTitleLength).min(1),
    context: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxContextLength),
    schema: AskUserFormSchemaSchema,
    artifact: AskUserArtifactSchema.optional(),
    timeoutMs: z
      .number()
      .int()
      .min(ASK_USER_SCHEMA_LIMITS.minTimeoutMs)
      .max(ASK_USER_SCHEMA_LIMITS.maxTimeoutMs)
      .optional(),
  })
  .strict()

export const AskUserRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    title: boundedString(ASK_USER_SCHEMA_LIMITS.maxTitleLength).optional(),
    context: optionalBoundedString(ASK_USER_SCHEMA_LIMITS.maxContextLength),
    schema: AskUserFormSchemaSchema.optional(),
    artifact: AskUserArtifactSchema.optional(),
    timeoutMs: z
      .number()
      .int()
      .min(ASK_USER_SCHEMA_LIMITS.minTimeoutMs)
      .max(ASK_USER_SCHEMA_LIMITS.maxTimeoutMs)
      .optional(),
  })
  .strict()

export const AskUserAnswerValueSchema = z.union([
  z.string().max(ASK_USER_SCHEMA_LIMITS.maxFreeformAnswerLength),
  z.array(z.string()).max(ASK_USER_SCHEMA_LIMITS.maxOptionsPerField),
  z.boolean(),
  z.number().finite(),
  z.null(),
])

export const AskUserAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    sessionId: z.string().min(1),
    values: z.record(fieldNameSchema, AskUserAnswerValueSchema),
    submittedAt: isoStringSchema,
  })
  .strict()

const commandParamsBase = {
  questionId: z.string().min(1),
  sessionId: z.string().min(1),
}

export const QuestionsSubmitCommandSchema = z
  .object({
    kind: z.literal(ASK_USER_COMMAND_KINDS.SUBMIT),
    params: z
      .object({
        ...commandParamsBase,
        answerToken: z.string().min(1),
        values: z.record(fieldNameSchema, AskUserAnswerValueSchema),
      })
      .strict(),
  })
  .strict()

export const QuestionsCancelCommandSchema = z
  .object({
    kind: z.literal(ASK_USER_COMMAND_KINDS.CANCEL),
    params: z.object({ ...commandParamsBase, answerToken: z.string().min(1) }).strict(),
  })
  .strict()


export const QuestionsCommandSchema = z.discriminatedUnion("kind", [
  QuestionsSubmitCommandSchema,
  QuestionsCancelCommandSchema,
])

export function serializedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

export function validateAskUserFormSchema(value: unknown) {
  return AskUserFormSchemaSchema.safeParse(value)
}

export function validateAskUserToolInput(value: unknown) {
  return AskUserToolInputSchema.safeParse(value)
}

export type AskUserFieldInput = z.infer<typeof AskUserFieldSchema>
export type AskUserFormSchemaInput = z.infer<typeof AskUserFormSchemaSchema>
export type AskUserToolInputValue = z.infer<typeof AskUserToolInputSchema>
