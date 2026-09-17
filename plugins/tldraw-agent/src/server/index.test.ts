import { describe, expect, it } from "vitest"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCanvasTool } from "./index"

describe("edit_tldraw_canvas", () => {
  it("exposes the regular Boring agent tool contract", () => {
    const tool = createCanvasTool(join(tmpdir(), `boring-tldraw-${Date.now()}.json`))
    expect(tool.name).toBe("edit_tldraw_canvas")
    expect(tool.description).toContain("native .tldraw file")
    expect(tool.parameters).toMatchObject({ required: ["operation", "path"], additionalProperties: false })
  })
})
