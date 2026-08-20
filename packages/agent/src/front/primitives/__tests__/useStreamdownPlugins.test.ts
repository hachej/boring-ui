import { describe, expect, it } from "vitest"
import { streamdownPluginNamesForSource } from "../useStreamdownPlugins"

describe("streamdownPluginNamesForSource", () => {
  it("keeps plain Latin markdown free of rich renderer chunks", () => {
    expect(streamdownPluginNamesForSource("Plain response with **emphasis**.")).toEqual([])
  })

  it("selects only renderers required by complete visible syntax", () => {
    expect(streamdownPluginNamesForSource("你好")).toEqual(["cjk"])
    expect(streamdownPluginNamesForSource("Use `const value = 1`")).toEqual(["code"])
    expect(streamdownPluginNamesForSource("The result is $x + y$. ")).toEqual(["math"])
    expect(streamdownPluginNamesForSource("```mermaid\ngraph LR\nA-->B\n```")).toEqual(["code", "mermaid"])
  })

  it("does not mistake currency, punctuation, other scripts, or unmatched delimiters for rich syntax", () => {
    expect(streamdownPluginNamesForSource("It costs $20 — don’t overpay…")).toEqual([])
    expect(streamdownPluginNamesForSource("Compare $20 vs $30 today")).toEqual([])
    expect(streamdownPluginNamesForSource("Привет κόσμε مرحبا")).toEqual([])
    expect(streamdownPluginNamesForSource("Streaming `unfinished and $x + y")).toEqual([])
  })

  it("lets message rendering keep ownership of code highlighting", () => {
    expect(streamdownPluginNamesForSource("```ts\nconst value = 1\n```", { code: false })).toEqual([])
    expect(streamdownPluginNamesForSource("```mermaid\ngraph LR\nA-->B\n```", { code: false })).toEqual(["mermaid"])
    expect(streamdownPluginNamesForSource("~~~~mermaid\ngraph LR\nA-->B\n~~~~", { code: false })).toEqual(["mermaid"])
  })

  it("re-evaluates complete syntax as streamed source changes", () => {
    expect(streamdownPluginNamesForSource("The result is $x + y")).toEqual([])
    expect(streamdownPluginNamesForSource("The result is $x + y$")).toEqual(["math"])
  })
})
