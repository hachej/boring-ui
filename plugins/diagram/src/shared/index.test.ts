import { describe, expect, test } from "vitest"
import { isDiagramPath, renderTargetFor, saveTargetFor, titleForPath } from "./index"

describe("Diagram shared helpers", () => {
  test("recognizes supported diagram workspace files", () => {
    expect(isDiagramPath("diagram.excalidraw")).toBe(true)
    expect(isDiagramPath("diagram.EXCALIDRAW.PNG")).toBe(true)
    expect(isDiagramPath("diagram.png")).toBe(false)
    expect(isDiagramPath("notes.md")).toBe(false)
  })

  test("uses an editable JSON save target for embedded PNG files", () => {
    expect(saveTargetFor("research/flow.excalidraw.png")).toBe("research/flow.excalidraw")
    expect(saveTargetFor("research/flow.excalidraw")).toBe("research/flow.excalidraw")
  })

  test("formats panel titles from paths", () => {
    expect(titleForPath("research/flow.excalidraw")).toBe("flow.excalidraw")
    expect(titleForPath()).toBe("Diagram")
  })

  test("derives render output paths from the editable diagram source", () => {
    expect(renderTargetFor("diagram.excalidraw")).toBe("diagram.render.png")
    expect(renderTargetFor("folder/diagram.excalidraw.png")).toBe("folder/diagram.render.png")
    expect(renderTargetFor("")).toBe("untitled.render.png")
  })
})
