import { describe, expect, it } from "vitest"
import { parseGeneratedPaneSpec } from "./index"

describe("parseGeneratedPaneSpec", () => {
  it("accepts a minimal generated pane", () => {
    const result = parseGeneratedPaneSpec({
      kind: "boring.generated-pane",
      version: 1,
      root: "main",
      elements: {
        main: { type: "Card", props: { title: "Hello" }, children: ["body"] },
        body: { type: "Text", props: { text: "World" } },
      },
    })

    expect(result.errors).toEqual([])
    expect(result.spec?.root).toBe("main")
  })

  it("rejects cycles and missing elements", () => {
    const result = parseGeneratedPaneSpec({
      kind: "boring.generated-pane",
      version: 1,
      root: "main",
      elements: {
        main: { type: "Card", children: ["main", "missing"] },
      },
    })

    expect(result.spec).toBeNull()
    expect(result.errors.join("\n")).toContain("generated pane element cycle")
    expect(result.errors.join("\n")).toContain("element missing is referenced but not defined")
  })
})
