import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

describe("buildBoringSystemPrompt", () => {
  test("points the agent at the boring-plugin-authoring skill", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).toContain("<available_skills>")
  })

  test("stays minimal — the skill is the doc, the prompt is just a pointer", () => {
    const prompt = buildBoringSystemPrompt()
    // Doc-content shouldn't be inlined.
    expect(prompt).not.toContain("BoringFrontFactory")
    expect(prompt).not.toContain("registerPanel")
    expect(prompt).not.toContain("definePlugin")
    expect(prompt.length).toBeLessThan(700)
  })
})
