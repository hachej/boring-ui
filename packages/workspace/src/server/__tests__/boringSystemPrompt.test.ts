import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

describe("buildBoringSystemPrompt", () => {
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
    // Server-side canonical shape:
    expect(prompt).toContain("defineServerPlugin")
    expect(prompt).toContain("@hachej/boring-workspace/server")
    expect(prompt).toContain("execute") // not "handler"
    expect(prompt).toContain('content: [{ type: "text"')
    // Skill pointer for deeper questions:
    expect(prompt).toContain("boring-plugin-authoring")
  })

  test("does not mention the scaffold command when none is provided", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).not.toContain("Step 1 — scaffold")
    expect(prompt).not.toContain("scaffold-plugin")
  })

  test("surfaces the scaffold command as Step 1 when provided", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "npx @hachej/boring-ui-cli scaffold-plugin",
    })
    expect(prompt).toContain("Step 1 — scaffold")
    expect(prompt).toContain("npx @hachej/boring-ui-cli scaffold-plugin <kebab-name>")
  })

  test("stays under 5000 chars (templates inlined, scaffold pointer optional)", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "npx @hachej/boring-ui-cli scaffold-plugin",
    })
    expect(prompt.length).toBeLessThan(5000)
  })
})
