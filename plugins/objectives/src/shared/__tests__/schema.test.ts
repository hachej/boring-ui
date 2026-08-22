import { describe, expect, it } from "vitest"
import { validateCreateObjectiveInput, validateUpdateObjectiveInput } from "../schema"

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
})
