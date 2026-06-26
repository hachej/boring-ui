import { describe, expect, test } from "vitest"
import { buildBoringSystemPrompt } from "../boringSystemPrompt"

// Most tests use a fixture boring-pi root so we exercise the happy
// "docs paths emitted" path without depending on the real install layout.
const FIXTURE_PI_ROOT = "/fake/node_modules/@hachej/boring-pi"

describe("buildBoringSystemPrompt", () => {
  test("renders a numbered TODO workflow", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toMatch(/\*\*1\.\s+Check plugin-root support/)
    expect(prompt).toMatch(/\*\*2\.\s+Edit/)
    expect(prompt).toMatch(/\*\*3\.\s+Install plugin-local deps/)
    expect(prompt).toMatch(/\*\*4\.\s+Verify/)
    expect(prompt).toMatch(/\*\*5\.\s+Ask the user to run `\/reload`/)
  })

  test("includes the scaffold and verify CLI invocations", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toContain("boring-ui-plugin status --json")
    expect(prompt).toContain("boring-ui-plugin scaffold <kebab-name>")
    expect(prompt).toContain("boring-ui-plugin verify")
  })

  test("teaches installing an existing plugin via boring-ui-plugin install, not npm install", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toContain("## Installing an existing or published plugin")
    expect(prompt).toContain("boring-ui-plugin install <source>")
    expect(prompt).toContain("npm:<package>")
    // The exact failure mode: plain npm install does not register the plugin.
    expect(prompt).toContain("does NOT register it as a plugin")
    expect(prompt).toContain("boring-ui-plugin list")
    expect(prompt).toContain("boring-ui-plugin remove <id-or-source>")
  })

  test("teaches plugin-local deps and boring-ui-kit defaults", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toContain("@hachej/boring-ui-kit")
    expect(prompt).toContain("plugin-local deps")
    expect(prompt).toContain("npm install <dep>")
    expect(prompt).toContain("/reload` never installs packages")
  })

  test("names every common hallucination", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
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

  test("teaches Pi extension tools with mandatory parameters schema", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toContain('parameters: { type: "object", properties: {} }')
    expect(prompt).toContain("parameters` is mandatory")
    expect(prompt).not.toContain("pi.registerTool({ name, description, execute })")
  })

  test("does NOT inline the canonical code blocks (scaffold owns the shape)", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
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

  test("emits a pi-style docs pointer block with workspace-readable paths into boring-pi", () => {
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    // Heading + each of the 4 docs targets.
    expect(prompt).toContain("## boring-ui plugin authoring documentation")
    expect(prompt).toContain(`${FIXTURE_PI_ROOT}/skills/boring-plugin-authoring/SKILL.md`)
    expect(prompt).toContain(`${FIXTURE_PI_ROOT}/references/workspace/panels.md`)
    expect(prompt).toContain(`${FIXTURE_PI_ROOT}/references/workspace/bridge.md`)
    expect(prompt).toContain(`${FIXTURE_PI_ROOT}/references/workspace/plugins.md`)
  })

  test("docs block falls back to <available_skills> reference when boring-pi cannot be resolved", () => {
    // Empty string isn't truthy → resolveBoringPiRoot returns null →
    // degraded path. We pass an explicit invalid override to bypass the
    // real require.resolve so the test is hermetic.
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: null,
    })
    // Workflow + hallucinations still present.
    expect(prompt).toMatch(/\*\*1\.\s+Check plugin-root support/)
    // No absolute paths emitted.
    expect(prompt).not.toContain("/skills/boring-plugin-authoring/SKILL.md")
    // Falls back to skill discovery via <available_skills>.
    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain("boring-plugin-authoring")
  })

  test("without scaffoldCommand, step 1 is reading the skill", () => {
    const prompt = buildBoringSystemPrompt({
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt).toContain("Read the `boring-plugin-authoring` skill")
    expect(prompt).not.toMatch(/\*\*1\.\s+Check plugin-root support/)
  })

  test("stays under 5500 chars in the full configuration", () => {
    // The pi-style docs pointer block, compact deps/design-system reminders,
    // and the short install-an-existing-plugin section are still much cheaper
    // than inlining the full authoring docs. Keep a ceiling so the appendix
    // doesn't drift back toward inlining content the agent should `read` on
    // demand instead.
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
      boringPiRootOverride: FIXTURE_PI_ROOT,
    })
    expect(prompt.length).toBeLessThan(5500)
  })

  test("uses require.resolve to find @hachej/boring-pi when no override is provided", () => {
    // No override → exercises the real resolver. In a workspace where
    // boring-pi is a real dep (the case in this monorepo), docs
    // paths SHOULD be emitted.
    const prompt = buildBoringSystemPrompt({
      scaffoldCommand: "boring-ui-plugin scaffold",
      verifyCommand: "boring-ui-plugin verify",
    })
    // The pointer block heading is always there.
    expect(prompt).toContain("## boring-ui plugin authoring documentation")
    // Path resolution succeeded → docs paths land in the prompt.
    expect(prompt).toMatch(/skills\/boring-plugin-authoring\/SKILL\.md/)
    expect(prompt).toMatch(/references\/workspace\/panels\.md/)
  })
})
