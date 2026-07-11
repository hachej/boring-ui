import { describe, expect, it } from "vitest"
import { AutomationCreateSchema, AutomationPatchSchema, AutomationRunBeginSchema, AutomationRunLifecyclePatchSchema } from "../schema"

describe("automation schemas", () => {
  it("validates automation create and patch input", () => {
    expect(AutomationCreateSchema.parse({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "model-a" })).toMatchObject({
      title: "Daily",
      cron: "0 9 * * *",
    })
    expect(() => AutomationCreateSchema.parse({ title: "", cron: "", timezone: "UTC", model: "model-a" })).toThrow()
    expect(() => AutomationPatchSchema.parse({})).toThrow()
    expect(AutomationPatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
    expect(AutomationPatchSchema.parse({ timezone: "America/New_York" })).toEqual({ timezone: "America/New_York" })
    expect(() => AutomationCreateSchema.parse({ title: "Bad", cron: "0 0 9 * * *", timezone: "UTC", model: "model-a" })).toThrow("Invalid cron schedule")
    expect(() => AutomationCreateSchema.parse({ title: "Bad", cron: "0 9 * * *", timezone: "Mars/Base", model: "model-a" })).toThrow("Invalid timezone")
  })

  it("validates executor-owned run metadata input", () => {
    expect(AutomationRunBeginSchema.parse({
      automationId: "a1",
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      scheduledFor: null,
      createdAt: "2026-07-09T09:00:00.000Z",
    })).toMatchObject({ automationId: "a1", trigger: "manual", scheduledFor: null })
    expect(() => AutomationRunBeginSchema.parse({ automationId: "a1", trigger: "manual" })).toThrow()
    expect(() => AutomationRunBeginSchema.parse({
      automationId: "a1",
      trigger: "manual",
      promptSnapshot: "prompt",
      modelSnapshot: "model-a",
      sessionId: null,
    })).toThrow()
    expect(() => AutomationRunLifecyclePatchSchema.parse({})).toThrow()
    expect(() => AutomationRunLifecyclePatchSchema.parse({ scheduledFor: null })).toThrow()
    expect(AutomationRunLifecyclePatchSchema.parse({ status: "succeeded", totalTokens: null })).toEqual({ status: "succeeded", totalTokens: null })
  })
})
