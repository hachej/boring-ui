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

  test("calls out the highest-leverage manifest mistake (boring.server: true)", () => {
    const prompt = buildBoringSystemPrompt({ scaffoldCommand: "x", verifyCommand: "y" })
    expect(prompt).toContain("NEVER the boolean `true`")
  })

  test("points at the boring-plugin-authoring skill for the long tail", () => {
    const prompt = buildBoringSystemPrompt({ scaffoldCommand: "x", verifyCommand: "y" })
    expect(prompt).toContain("boring-plugin-authoring")
    expect(prompt).toContain("<available_skills>")
  })

  test("without scaffoldCommand, step 1 is creating files (no scaffold available)", () => {
    const prompt = buildBoringSystemPrompt()
    expect(prompt).toMatch(/\*\*1\.\s+Create the plugin files/)
    expect(prompt).toContain("definePlugin")
    expect(prompt).not.toMatch(/\*\*1\.\s+Scaffold/)
  })

  test("inlines the front-file definePlugin skeleton (most violated piece)", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt).toContain("definePlugin({")
    expect(prompt).toContain("@hachej/boring-workspace/plugin")
    expect(prompt).toContain("panels: [")
    expect(prompt).toContain("commands: [")
  })

  test("verifyCommand=false drops the verify step", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: false,
    })
    expect(prompt).not.toContain("Verify")
    expect(prompt).not.toContain("verify-plugin")
  })

  test("stays under 3500 chars in the full configuration", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui scaffold-plugin",
      verifyCommand: "boring-ui verify-plugin",
    })
    expect(prompt.length).toBeLessThan(3500)
  })
})
