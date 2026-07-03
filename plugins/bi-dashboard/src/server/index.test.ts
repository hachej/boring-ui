import { describe, expect, it } from "vitest"
import { sampleBiDashboardSpec } from "../front/sampleSpec"
import { BI_DASHBOARD_VALIDATE_OP, createBiDashboardServerPlugin } from "./index"

describe("createBiDashboardServerPlugin", () => {
  it("registers spec-only validate op with bi-dashboard capability", async () => {
    const plugin = createBiDashboardServerPlugin({ workspaceRoot: "/workspace" })
    const contribution = plugin.workspaceBridgeHandlers?.find((handler) => handler.definition.op === BI_DASHBOARD_VALIDATE_OP)
    expect(contribution?.definition.requiredCapabilities).toEqual(["bi-dashboard:validate"])
    expect(JSON.stringify(contribution?.definition.inputSchema)).not.toContain("path")
    const output = await contribution?.handler({
      input: { spec: sampleBiDashboardSpec },
      context: { callerClass: "runtime", workspaceId: "default", capabilities: ["bi-dashboard:validate"], actor: { actorKind: "agent" } },
      definition: contribution.definition,
      signal: new AbortController().signal,
    })
    expect(output).toMatchObject({ ok: true })
  })

  it("returns diagnostics for malformed top-level specs", async () => {
    const plugin = createBiDashboardServerPlugin({ workspaceRoot: "/workspace" })
    const contribution = plugin.workspaceBridgeHandlers?.find((handler) => handler.definition.op === BI_DASHBOARD_VALIDATE_OP)
    const output = await contribution?.handler({
      input: { spec: null },
      context: { callerClass: "runtime", workspaceId: "default", capabilities: ["bi-dashboard:validate"], actor: { actorKind: "agent" } },
      definition: contribution.definition,
      signal: new AbortController().signal,
    })
    expect(output).toMatchObject({ ok: false })
    expect(JSON.stringify(output)).toContain("generated-pane.invalid_root")
  })
})
