import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

describe("buildBoringSystemPrompt", () => {
  test("inlines the declarative canonical shape", () => {
    const prompt = buildBoringSystemPrompt()
    // Canonical declarative config — the agent should not need to guess any of these:
    expect(prompt).toContain("definePlugin({")
    expect(prompt).toContain("panels:")
    expect(prompt).toContain("commands:")
    expect(prompt).toContain("leftTabs:")
    expect(prompt).toContain("surfaceResolvers:")
    expect(prompt).toContain("setup")
    expect(prompt).toContain("@hachej/boring-workspace/plugin")
    expect(prompt).toContain(".pi/extensions/")
    expect(prompt).toContain("front/index.tsx")
  })

  test("calls out the high-signal forbidden patterns", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toContain("createPlugin")
    expect(prompt).toContain("defineFrontPlugin")
    expect(prompt).toContain("@hachej/boring-pi")
    // Server tool common mistake:
    expect(prompt).toContain("handler")
    expect(prompt).toContain("execute")
  })

  test("inlines the server-side canonical shape", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toContain("defineServerPlugin")
    expect(prompt).toContain("@hachej/boring-workspace/server")
    expect(prompt).toContain('content: [{ type: "text"')
  })

  test("points at the boring-plugin-authoring skill for the long tail", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).toContain("<available_skills>")
  })

  test("does not mention scaffold-plugin when no scaffoldCommand is provided", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).not.toContain("Step 1 — scaffold")
  })

  test("surfaces the scaffold command as Step 1 when provided", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "npx @hachej/boring-ui-cli scaffold-plugin",
    })
    expect(prompt).toContain("Step 1 — scaffold")
    expect(prompt).toContain("npx @hachej/boring-ui-cli scaffold-plugin <kebab-name>")
  })

  test("stays under 5000 chars", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "npx @hachej/boring-ui-cli scaffold-plugin",
    })
    expect(prompt.length).toBeLessThan(5000)
  })
})
