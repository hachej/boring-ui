import { describe, expect, it } from "vitest"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import objectivesPlugin from "../index"

const captured = captureFrontPlugin(objectivesPlugin)

function surfaceResolver() {
  const resolver = captured.registrations.surfaceResolvers[0]
  if (!resolver) throw new Error("objectives plugin has no surfaceResolvers")
  return resolver
}

describe("objectives plugin surface resolver", () => {
  it("registers a panel and a surface resolver for kind 'objective'", () => {
    expect(captured.id).toBe("objectives")
    expect(captured.registrations.panels.map((panel) => panel.id)).toEqual(["objectives.panel"])
    expect(surfaceResolver().kind).toBe("objective")
  })

  it("resolves an objective.v1 target into the Objective panel with objectiveId param", () => {
    const resolution = surfaceResolver().resolve({ kind: "objective", target: "obj_123" })
    expect(resolution).toMatchObject({
      component: "objectives.panel",
      title: "Objective",
      params: { objectiveId: "obj_123" },
    })
  })

  it("declines to resolve requests for other surface kinds", () => {
    expect(surfaceResolver().resolve({ kind: "workspace.open.path", target: "obj_123" })).toBeUndefined()
  })

  it("declines to resolve a request with an empty target", () => {
    expect(surfaceResolver().resolve({ kind: "objective", target: "" })).toBeUndefined()
  })
})
