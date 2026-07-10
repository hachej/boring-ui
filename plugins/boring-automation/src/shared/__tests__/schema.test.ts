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

  it("validates storage-neutral run metadata input", () => {
    expect(AutomationRunCreateSchema.parse({
      automationId: "a1",
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      scheduledFor: null,
      sessionId: null,
    })).toMatchObject({ automationId: "a1", trigger: "manual", scheduledFor: null, sessionId: null })
    expect(() => AutomationRunCreateSchema.parse({ automationId: "a1", trigger: "manual" })).toThrow()
    expect(() => AutomationRunCreateSchema.parse({
      automationId: "a1",
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      cronSnapshot: "0 9 * * *",
    })).toThrow()
    expect(() => AutomationRunPatchSchema.parse({})).toThrow()
    expect(AutomationRunPatchSchema.parse({ status: "succeeded", totalTokens: null })).toEqual({ status: "succeeded", totalTokens: null })
  })
})
