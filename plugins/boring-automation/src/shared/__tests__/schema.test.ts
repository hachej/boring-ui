import { describe, expect, it } from "vitest"
import { MAX_AUTOMATION_DURATION_MS } from "../schedule"
import { AutomationCreateSchema, AutomationPatchSchema, AutomationRunBeginSchema, AutomationRunLifecyclePatchSchema, AutomationRunStatusSchema } from "../schema"

describe("automation schemas", () => {
  it("validates automation create and patch input", () => {
    expect(AutomationCreateSchema.parse({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "model-a" })).toMatchObject({
      title: "Daily",
      cron: "0 9 * * *",
    })
    expect(AutomationCreateSchema.parse({ title: "Dispatch only", timezone: "UTC", model: "model-a" })).toEqual({
      title: "Dispatch only",
      timezone: "UTC",
      model: "model-a",
    })
    expect(() => AutomationCreateSchema.parse({ title: "", cron: "", timezone: "UTC", model: "model-a" })).toThrow()
    expect(() => AutomationPatchSchema.parse({})).toThrow()
    expect(AutomationPatchSchema.parse({ enabled: false })).toEqual({ enabled: false })
    expect(AutomationPatchSchema.parse({ timezone: "America/New_York" })).toEqual({ timezone: "America/New_York" })
    expect(AutomationCreateSchema.parse({ title: "Daily", cron: "0 9 * * *", timezone: "UTC", model: "model-a", agentTypeId: "researcher" })).toMatchObject({ agentTypeId: "researcher" })
    expect(AutomationPatchSchema.parse({ agentTypeId: " reviewer " })).toEqual({ agentTypeId: "reviewer" })
    expect(AutomationPatchSchema.parse({ runDurationCapMs: 42_000 })).toEqual({ runDurationCapMs: 42_000 })
    expect(AutomationPatchSchema.parse({ runDurationCapMs: MAX_AUTOMATION_DURATION_MS })).toEqual({ runDurationCapMs: MAX_AUTOMATION_DURATION_MS })
    expect(AutomationPatchSchema.parse({ runDurationCapMs: null })).toEqual({ runDurationCapMs: null })
    expect(() => AutomationPatchSchema.parse({ runDurationCapMs: 0 })).toThrow()
    expect(() => AutomationPatchSchema.parse({ runDurationCapMs: MAX_AUTOMATION_DURATION_MS + 1 })).toThrow()
    expect(() => AutomationCreateSchema.parse({ title: "Bad", cron: "0 0 9 * * *", timezone: "UTC", model: "model-a" })).toThrow("Invalid cron schedule")
    expect(() => AutomationCreateSchema.parse({ title: "Bad", cron: "0 9 * * *", timezone: "Mars/Base", model: "model-a" })).toThrow("Invalid timezone")
  })

  it("uses the complete shared runtime run-status vocabulary", () => {
    expect(AutomationRunStatusSchema.options).toEqual([
      "queued", "dispatching", "running", "succeeded", "failed", "cancelled", "outcome-unknown",
    ])
    expect(AutomationRunStatusSchema.parse("dispatching")).toBe("dispatching")
    expect(AutomationRunStatusSchema.parse("outcome-unknown")).toBe("outcome-unknown")
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
    expect(AutomationRunLifecyclePatchSchema.parse({ durationMs: MAX_AUTOMATION_DURATION_MS })).toEqual({ durationMs: MAX_AUTOMATION_DURATION_MS })
    expect(() => AutomationRunLifecyclePatchSchema.parse({ durationMs: MAX_AUTOMATION_DURATION_MS + 1 })).toThrow()
  })
})
