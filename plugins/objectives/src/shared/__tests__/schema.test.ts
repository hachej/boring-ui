import { describe, expect, it } from "vitest"
import { OBJECTIVE_ID_PATTERN } from "../constants"
import { ObjectiveIdSchema, ObjectiveSchema, validateCreateObjectiveInput, validateUpdateObjectiveInput } from "../schema"

describe("objectives schema", () => {
  it("accepts a minimal create input", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown fields (strict)", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
      goal: "not allowed",
    })
    expect(result.success).toBe(false)
  })

  it("rejects an invalid status", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
      status: "in_progress",
    })
    expect(result.success).toBe(false)
  })

  it("requires an id for update", () => {
    const result = validateUpdateObjectiveInput({ title: "Renamed" })
    expect(result.success).toBe(false)
  })

  it("accepts a partial update", () => {
    const result = validateUpdateObjectiveInput({ id: "obj_1", current: 250, status: "achieved" })
    expect(result.success).toBe(true)
  })

  it("rejects a create input whose aggregate serialized size exceeds the safe cap", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "x".repeat(4_000),
      metric: "weekly active users",
      baseline: 100,
      target: 500,
      constraints: Array.from({ length: 50 }, () => "c".repeat(500)),
      evidenceRefs: Array.from({ length: 100 }, () => "e".repeat(500)),
    })
    expect(result.success).toBe(false)
  })

  it("accepts a create input at the field limits when it stays under the aggregate cap", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
    })
    expect(result.success).toBe(true)
  })

  it("accepts an optional clientRequestId on create", () => {
    const result = validateCreateObjectiveInput({
      title: "Ship v2",
      objective: "Ship the v2 rewrite to production",
      metric: "weekly active users",
      baseline: 100,
      target: 500,
      clientRequestId: "retry-1",
    })
    expect(result.success).toBe(true)
  })
})

describe("ObjectiveIdSchema", () => {
  it("matches OBJECTIVE_ID_PATTERN", () => {
    expect(ObjectiveIdSchema.safeParse("obj-123-abc").success).toBe(true)
    expect(OBJECTIVE_ID_PATTERN.test("obj-123-abc")).toBe(true)
  })

  it("rejects ids with underscores, uppercase, or an empty string", () => {
    expect(ObjectiveIdSchema.safeParse("obj_123").success).toBe(false)
    expect(ObjectiveIdSchema.safeParse("Obj-123").success).toBe(false)
    expect(ObjectiveIdSchema.safeParse("").success).toBe(false)
  })

  it("rejects __proto__ and other dangerous keys as ids", () => {
    expect(ObjectiveIdSchema.safeParse("__proto__").success).toBe(false)
    expect(ObjectiveIdSchema.safeParse("constructor").success).toBe(true) // plain word — safe as a Map key, not a special property here
  })
})

describe("ObjectiveSchema", () => {
  const base = {
    id: "obj-1",
    title: "Ship v2",
    objective: "Ship the v2 rewrite to production",
    metric: "weekly active users",
    baseline: 100,
    target: 500,
    current: 100,
    status: "active" as const,
    constraints: [] as string[],
    evidenceRefs: [] as string[],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }

  it("accepts a well-formed stored record", () => {
    expect(ObjectiveSchema.safeParse(base).success).toBe(true)
  })

  it("rejects a stored record with a non-canonical id", () => {
    expect(ObjectiveSchema.safeParse({ ...base, id: "obj_1" }).success).toBe(false)
  })

  it("rejects unknown fields (strict)", () => {
    expect(ObjectiveSchema.safeParse({ ...base, extra: "nope" }).success).toBe(false)
  })
})
