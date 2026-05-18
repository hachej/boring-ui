import { describe, expect, it } from "vitest"
import { defineFrontPlugin, PluginError } from "../defineFrontPlugin"

const DummyPanel = () => null

describe("defineFrontPlugin", () => {
  it("accepts a plugin with no outputs", () => {
    const plugin = defineFrontPlugin({ id: "empty", outputs: [] })
    expect(plugin).toEqual({ id: "empty", outputs: [] })
  })

  it("accepts a plugin with valid outputs and preserves label", () => {
    const plugin = defineFrontPlugin({
      id: "panels",
      label: "Panels",
      outputs: [
        { type: "panel", panel: { id: "p1", title: "Panel 1", component: DummyPanel } },
        { type: "command", command: { id: "c1", title: "Cmd", run: () => {} } },
      ],
    })
    expect(plugin.id).toBe("panels")
    expect(plugin.label).toBe("Panels")
    expect(plugin.outputs).toHaveLength(2)
  })

  it("throws when id is empty or non-string", () => {
    expect(() => defineFrontPlugin({ id: "", outputs: [] })).toThrow(PluginError)
    expect(() =>
      defineFrontPlugin({ id: 42 as unknown as string, outputs: [] }),
    ).toThrow(PluginError)
  })

  it("throws when an output has an unknown type", () => {
    expect(() =>
      defineFrontPlugin({
        id: "bad",
        outputs: [{ type: "not-a-type" } as never],
      }),
    ).toThrow(/outputs\[0\]/)
  })
})
