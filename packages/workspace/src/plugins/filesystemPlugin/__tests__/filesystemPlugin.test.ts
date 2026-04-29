import { describe, it, expect } from "vitest"
import { filesystemPlugin } from "../index"

describe("filesystemPlugin", () => {
  it("has id 'filesystem'", () => {
    expect(filesystemPlugin.id).toBe("filesystem")
  })

  it("has label 'Filesystem'", () => {
    expect(filesystemPlugin.label).toBe("Filesystem")
  })

  it("has no agentTools (UI-only plugin)", () => {
    expect(filesystemPlugin.agentTools).toBeUndefined()
  })

  it("registers 3 panels: files, code-editor, markdown-editor", () => {
    expect(filesystemPlugin.panels).toHaveLength(3)
    const ids = filesystemPlugin.panels!.map((p) => p.id)
    expect(ids).toEqual(["files", "code-editor", "markdown-editor"])
  })

  it("all panels have source 'builtin'", () => {
    for (const panel of filesystemPlugin.panels!) {
      expect(panel.source).toBe("builtin")
    }
  })

  it("files panel has placement 'left-tab'", () => {
    const files = filesystemPlugin.panels!.find((p) => p.id === "files")!
    expect(files.placement).toBe("left-tab")
  })

  it("code-editor panel covers common file extensions", () => {
    const editor = filesystemPlugin.panels!.find((p) => p.id === "code-editor")!
    expect(editor.filePatterns).toContain("**/*.ts")
    expect(editor.filePatterns).toContain("**/*.tsx")
    expect(editor.filePatterns).toContain("**/*.py")
    expect(editor.filePatterns).toContain("**/*.json")
  })

  it("markdown-editor panel covers .md and .mdx", () => {
    const md = filesystemPlugin.panels!.find((p) => p.id === "markdown-editor")!
    expect(md.filePatterns).toEqual(["**/*.md", "**/*.mdx"])
  })

  it("registers 1 catalog with id 'files'", () => {
    expect(filesystemPlugin.catalogs).toHaveLength(1)
    expect(filesystemPlugin.catalogs![0].id).toBe("files")
  })

  it("is a plain const, not a factory", () => {
    expect(typeof filesystemPlugin).toBe("object")
    expect(typeof filesystemPlugin).not.toBe("function")
  })
})
