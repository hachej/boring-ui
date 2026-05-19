import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

describe("buildBoringSystemPrompt", () => {
  test("renders a numbered TODO workflow", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt).toMatch(/\*\*1\.\s+Scaffold/)
    expect(prompt).toMatch(/\*\*2\.\s+Edit/)
    expect(prompt).toMatch(/\*\*3\.\s+Verify/)
    expect(prompt).toMatch(/\*\*4\.\s+Ask the user to run `\/reload`/)
  })

  test("includes the scaffold and verify CLI invocations", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt).toContain("boring-ui scaffold-plugin <kebab-name>")
    expect(prompt).toContain("boring-ui verify-plugin")
  })

  test("names every common hallucination", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    // API factories:
    expect(prompt).toContain("createPlugin")
    expect(prompt).toContain("defineFrontPlugin")
    // Method names:
    expect(prompt).toContain("registerComponent")
    expect(prompt).toContain("addPanel")
    // Imports:
    expect(prompt).toContain("@hachej/boring-pi")
    expect(prompt).toContain("@hachej/pi-sdk")
    // Server-tool method + return shape + manifest:
    expect(prompt).toContain("handler")
    expect(prompt).toContain("execute")
    expect(prompt).toContain('content: [{ type: "text"')
    expect(prompt).toContain("boring.server: true")
  })

  test("does NOT inline the canonical code blocks (scaffold owns the shape)", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    // The verbose `import { definePlugin } ... export default
    // definePlugin({ id: ..., panels: [{ id, label, component }] })`
    // skeleton is NOT inlined. The agent reads the scaffold output for
    // the exact shape; the prompt only names the wrong things.
    expect(prompt).not.toContain("```tsx")
    expect(prompt).not.toContain("```ts\n")
    expect(prompt).not.toContain("function MyPane")
    expect(prompt).not.toContain("defineServerPlugin({")
  })

  test("points at the boring-plugin-authoring skill for the long tail", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).toContain("<available_skills>")
  })

  test("without scaffoldCommand, step 1 is reading the skill", () => {
    const prompt = buildBoringSystemPrompt({ verifyCommand: "boring-ui verify-plugin" })
    expect(prompt).toContain("Read the `boring-plugin-authoring` skill")
    expect(prompt).not.toMatch(/\*\*1\.\s+Scaffold/)
  })

  test("stays under 3000 chars in the full configuration", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt.length).toBeLessThan(3000)
  })
})
