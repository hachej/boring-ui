import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

describe("buildBoringSystemPrompt", () => {
  test("points the agent at the boring-plugin-authoring skill", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).toContain("<available_skills>")
  })

  test("inlines the canonical plugin shape and forbidden patterns", () => {
    const prompt = buildBoringSystemPrompt()
    // Canonical shape — the agent should not need to guess any of these:
    expect(prompt).toContain("definePlugin")
    expect(prompt).toContain("registerPanel")
    expect(prompt).toContain("registerPanelCommand")
    expect(prompt).toContain("registerLeftTab")
    expect(prompt).toContain("registerSurfaceResolver")
    expect(prompt).toContain("@hachej/boring-workspace/plugin")
    expect(prompt).toContain(".pi/extensions/")
    expect(prompt).toContain("front/index.tsx")
    // Forbidden patterns we want the agent to recognize:
    expect(prompt).toContain("createPlugin")
    expect(prompt).toContain("registerComponent")
    expect(prompt).toContain("defineFrontPlugin")
    // Skill pointer for deeper questions:
    expect(prompt).toContain("boring-plugin-authoring")
    // Cap at 3000 chars — small enough to keep context budget for the user task.
    expect(prompt.length).toBeLessThan(3000)
  })
})
