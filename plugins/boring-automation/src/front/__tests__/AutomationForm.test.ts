import { describe, expect, it } from "vitest"
import type { Automation } from "../../shared"
import { draftFromAutomation, toAutomationPatch, validateAutomationDraft } from "../AutomationForm"

describe("dispatch-only automation editing", () => {
  it("preserves null cron while allowing other metadata to be serialized", () => {
    const automation: Automation = {
      id: "worker-slot-1",
      title: "worker-slot-1",
      enabled: true,
      cron: null,
      timezone: "UTC",
      model: "openai-codex:gpt-5.6-sol",
      agentTypeId: "boring-worker",
      sessionMode: "new",
      promptRef: ".agents/automation/worker-slot.md",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    }
    const draft = { ...draftFromAutomation(automation, "worker prompt"), title: "worker-slot-primary" }

    expect(validateAutomationDraft(draft)).toEqual({})
    expect(toAutomationPatch(draft)).toEqual({
      title: "worker-slot-primary",
      enabled: true,
      timezone: "UTC",
      model: "openai-codex:gpt-5.6-sol",
      thinkingLevel: "medium",
    })
  })
})
