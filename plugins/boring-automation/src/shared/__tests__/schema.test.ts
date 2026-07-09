import { describe, expect, it } from "vitest"
import { AutomationCreateSchema, AutomationPatchSchema, AutomationRunCreateSchema, AutomationRunPatchSchema } from "../schema"

describe("automation schemas", () => {
  it("validates automation create and patch input", () => {
    expect(AutomationCreateSchema.parse({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "model-a" })).toMatchObject({
      title: "Daily",
      cron: "0 9 * * *",
    })
    expect(() => AutomationCreateSchema.parse({ title: "", cron: "", timezone: "UTC", model: "model-a" })).toThrow()
    expect(() => AutomationPatchSchema.parse({})).toThrow()
    expect(AutomationPatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  it("validates run metadata create and patch input", () => {
    expect(AutomationRunCreateSchema.parse({
      automationId: "a1",
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: "0 9 * * *",
      timezoneSnapshot: "UTC",
    })).toMatchObject({ automationId: "a1", trigger: "manual" })
    expect(() => AutomationRunCreateSchema.parse({ automationId: "a1", trigger: "manual" })).toThrow()
    expect(() => AutomationRunPatchSchema.parse({})).toThrow()
    expect(AutomationRunPatchSchema.parse({ status: "succeeded", totalTokens: 1 })).toEqual({ status: "succeeded", totalTokens: 1 })
  })
})
