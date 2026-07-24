import { describe, expect, it } from "vitest"
import { ASK_USER_COMMAND_KINDS, ASK_USER_SCHEMA_LIMITS } from "../constants"
import { ASK_USER_ERROR_CODES, ASK_USER_ERROR_CODE_VALUES } from "../error-codes"
import {
  AskUserFormSchemaSchema,
  AskUserToolInputSchema,
  QuestionsCommandSchema,
} from "../schema"

const validSchema = {
  wireVersion: 1,
  fields: [
    {
      type: "radio",
      name: "strategy",
      label: "Strategy",
      required: true,
      options: [
        { value: "memory", label: "Memory" },
        { value: "redis", label: "Redis" },
      ],
      defaultValue: "memory",
    },
  ],
} as const

describe("ask-user shared schema", () => {
  it("accepts a valid schema and tool input", () => {
    expect(AskUserFormSchemaSchema.safeParse(validSchema).success).toBe(true)
    expect(
      AskUserToolInputSchema.safeParse({ title: "Pick a strategy", schema: validSchema }).success,
    ).toBe(true)
  })

  it("accepts only the plural bounded HumanArtifact contract", () => {
    const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
    expect(AskUserToolInputSchema.safeParse({ title: "Review", schema: validSchema, artifacts: [artifact] }).success).toBe(true)
    expect(AskUserToolInputSchema.safeParse({ title: "Review", schema: validSchema, artifact }).success).toBe(false)
    expect(AskUserToolInputSchema.safeParse({ title: "Review", schema: validSchema, artifacts: [artifact, artifact] }).success).toBe(false)
  })

  it("rejects unknown wireVersion", () => {
    expect(AskUserFormSchemaSchema.safeParse({ ...validSchema, wireVersion: 2 }).success).toBe(false)
  })

  it("rejects duplicate field names", () => {
    const result = AskUserFormSchemaSchema.safeParse({
      wireVersion: 1,
      fields: [
        { type: "text", name: "same", label: "One" },
        { type: "textarea", name: "same", label: "Two" },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.message.includes("duplicate field name"))).toBe(true)
  })

  it("rejects reserved and invalid field names", () => {
    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "text", name: "__proto__", label: "Bad" }],
      }).success,
    ).toBe(false)
    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "text", name: "1bad", label: "Bad" }],
      }).success,
    ).toBe(false)
  })

  it("rejects duplicate option values and invalid defaults", () => {
    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [
          {
            type: "select",
            name: "choice",
            label: "Choice",
            options: [
              { value: "a", label: "A" },
              { value: "a", label: "Again" },
            ],
          },
        ],
      }).success,
    ).toBe(false)

    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [
          {
            type: "radio",
            name: "choice",
            label: "Choice",
            defaultValue: "missing",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("enforces numeric finite/integer/default bounds", () => {
    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "number", name: "count", label: "Count", integer: true, defaultValue: 1.5 }],
      }).success,
    ).toBe(false)

    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "number", name: "count", label: "Count", min: 10, max: 1 }],
      }).success,
    ).toBe(false)
  })

  it("enforces timeout and serialized-size limits", () => {
    expect(
      AskUserToolInputSchema.safeParse({
        title: "Too fast",
        schema: validSchema,
        timeoutMs: ASK_USER_SCHEMA_LIMITS.minTimeoutMs - 1,
      }).success,
    ).toBe(false)

    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [
          {
            type: "text",
            name: "huge",
            label: "Huge",
            helpText: "x".repeat(ASK_USER_SCHEMA_LIMITS.maxSerializedSchemaBytes),
          },
        ],
      }).success,
    ).toBe(false)
  })

  it("rejects unsafe regex patterns and inconsistent length constraints", () => {
    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "text", name: "value", label: "Value", pattern: "(a)\\1" }],
      }).success,
    ).toBe(false)

    expect(
      AskUserFormSchemaSchema.safeParse({
        wireVersion: 1,
        fields: [{ type: "text", name: "value", label: "Value", minLength: 5, maxLength: 2 }],
      }).success,
    ).toBe(false)
  })

  it("validates Questions command payloads", () => {
    expect(
      QuestionsCommandSchema.safeParse({
        kind: ASK_USER_COMMAND_KINDS.SUBMIT,
        params: {
          questionId: "q1",
          sessionId: "s1",
          answerToken: "token",
          values: { strategy: "redis" },
        },
      }).success,
    ).toBe(true)

    expect(
      QuestionsCommandSchema.safeParse({
        kind: ASK_USER_COMMAND_KINDS.SUBMIT,
        params: { questionId: "q1", sessionId: "s1", values: {} },
      }).success,
    ).toBe(false)
  })
})

describe("ask-user error codes", () => {
  it("exports plugin-scoped stable error codes", () => {
    expect(ASK_USER_ERROR_CODES.SCHEMA_INVALID).toBe("ASK_USER_SCHEMA_INVALID")
    expect(new Set(ASK_USER_ERROR_CODE_VALUES).size).toBe(ASK_USER_ERROR_CODE_VALUES.length)
    expect(ASK_USER_ERROR_CODE_VALUES).toContain("ASK_USER_RUNTIME_UNAVAILABLE")
  })
})
