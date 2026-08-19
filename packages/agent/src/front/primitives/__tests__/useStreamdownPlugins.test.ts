import { describe, expect, it } from "vitest"
import { streamdownPluginNamesForSource } from "../useStreamdownPlugins"

describe("streamdownPluginNamesForSource", () => {
  it("keeps plain Latin markdown free of rich renderer chunks", () => {
    expect(streamdownPluginNamesForSource("Plain response with **emphasis**.")).toEqual([])
  })

  it("selects only renderers required by the visible source", () => {
    expect(streamdownPluginNamesForSource("你好")).toEqual(["cjk"])
    expect(streamdownPluginNamesForSource("Use `const value = 1`")).toEqual(["code"])
    expect(streamdownPluginNamesForSource("The result is $x + y$. ")).toEqual(["math"])
    expect(streamdownPluginNamesForSource("```mermaid\ngraph LR\nA-->B\n```")).toEqual(["code", "mermaid"])
  })
})
