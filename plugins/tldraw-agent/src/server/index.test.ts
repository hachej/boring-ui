import { describe, expect, it } from "vitest"
import type { Workspace } from "@hachej/boring-agent/shared"
import { canonicalPath, createCanvasTool, validateActions } from "./index"

const workspace = {
  root: "/workspace",
  runtimeContext: {},
  readFile: async () => "",
  writeFile: async () => {},
  unlink: async () => {},
  readdir: async () => [],
  stat: async () => ({ type: "file", size: 0, mtimeMs: 1 }),
  mkdir: async () => {},
  rename: async () => {},
} as unknown as Workspace

describe("edit_tldraw_canvas", () => {
  it("exposes the regular Boring agent tool contract", () => {
    const tool = createCanvasTool(workspace)
    expect(tool.name).toBe("edit_tldraw_canvas")
    expect(tool.description).toContain("native .tldraw file")
    expect(tool.parameters).toMatchObject({ required: ["operation", "path"], additionalProperties: false })
  })

  it("canonicalizes contained paths and rejects traversal", () => {
    expect(canonicalPath("./diagrams/flow.tldraw")).toBe("diagrams/flow.tldraw")
    expect(() => canonicalPath("diagrams/../escape.tldraw")).toThrow("contained relative")
    expect(() => canonicalPath("/absolute.tldraw")).toThrow("contained relative")
  })

  it("rejects incomplete action variants instead of silently succeeding", () => {
    expect(() => validateActions([{ type: "create" }])).toThrow("create requires shape")
    expect(() => validateActions([{ type: "delete", ids: [] }])).toThrow("delete requires non-empty ids")
    expect(() => validateActions([{ type: "align", ids: ["a", "b"] }])).toThrow("align requires axis")
  })
})
