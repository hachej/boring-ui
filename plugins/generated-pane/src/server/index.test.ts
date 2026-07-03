import { describe, expect, it } from "vitest"
import { GENERATED_PANE_VALIDATE_OP, createGeneratedPaneServerPlugin } from "./index"

describe("createGeneratedPaneServerPlugin", () => {
  it("registers base validate op with generated-pane capability", async () => {
    const plugin = createGeneratedPaneServerPlugin()
    const contribution = plugin.workspaceBridgeHandlers?.find((handler) => handler.definition.op === GENERATED_PANE_VALIDATE_OP)
    expect(contribution?.definition.requiredCapabilities).toEqual(["generated-pane:validate"])
    const output = await contribution?.handler({
      input: {
        spec: {
          kind: "boring.generated-pane",
          version: 1,
          profile: "base",
          root: "main",
          elements: { main: { type: "Text", props: { text: "Hello" } } },
        },
      },
      context: { callerClass: "runtime", workspaceId: "default", capabilities: ["generated-pane:validate"], actor: { actorKind: "agent" } },
      definition: contribution.definition,
      signal: new AbortController().signal,
    })
    expect(output).toMatchObject({ ok: true, diagnostics: [] })
  })

  it("returns diagnostics for malformed top-level specs", async () => {
    const plugin = createGeneratedPaneServerPlugin()
    const contribution = plugin.workspaceBridgeHandlers?.find((handler) => handler.definition.op === GENERATED_PANE_VALIDATE_OP)
    const output = await contribution?.handler({
      input: { spec: null },
      context: { callerClass: "runtime", workspaceId: "default", capabilities: ["generated-pane:validate"], actor: { actorKind: "agent" } },
      definition: contribution.definition,
      signal: new AbortController().signal,
    })
    expect(output).toMatchObject({ ok: false })
    expect(JSON.stringify(output)).toContain("generated-pane.invalid_root")
  })
})
