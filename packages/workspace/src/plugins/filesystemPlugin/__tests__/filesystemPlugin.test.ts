import { describe, it, expect, vi } from "vitest"
import { createFilesystemPlugin, filesystemPlugin } from "../index"
import { createFilesCatalog } from "../catalog"

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

  it("registers editor panels and a files left-tab output", () => {
    expect(filesystemPlugin.outputs).toHaveLength(1)
    expect(filesystemPlugin.outputs![0]).toEqual(
      expect.objectContaining({
        type: "left-tab",
        id: "files",
        title: "Files",
        source: "builtin",
      }),
    )
    expect(filesystemPlugin.panels).toHaveLength(2)
    const ids = filesystemPlugin.panels!.map((p) => p.id)
    expect(ids).toEqual(["code-editor", "markdown-editor"])
  })

  it("all panels have source 'builtin'", () => {
    for (const panel of filesystemPlugin.panels!) {
      expect(panel.source).toBe("builtin")
    }
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

  it("has no catalogs (catalogs are registered at runtime via bindings)", () => {
    expect(filesystemPlugin.catalogs).toBeUndefined()
  })

  it("ships the files catalog as a plugin binding", () => {
    expect(filesystemPlugin.bindings).toHaveLength(1)
    expect(createFilesystemPlugin().bindings).toHaveLength(1)
  })

  it("creates a case-insensitive files catalog adapter", async () => {
    const client = {
      search: vi.fn(async () => ["src/App.tsx"]),
    }
    const onOpenFile = vi.fn()
    const catalog = createFilesCatalog({ client, onSelect: onOpenFile })

    const result = await catalog.adapter.search({
      query: "app",
      filters: {},
      limit: 10,
      offset: 0,
    })

    expect(result.items).toEqual([
      { id: "src/App.tsx", title: "App.tsx", subtitle: "src/" },
    ])
    expect(client.search).toHaveBeenCalledWith("*[Aa][Pp][Pp]*", 10, undefined)
    catalog.onSelect(result.items[0]!)
    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx", result.items[0])
  })

  it("is a plain const, not a factory", () => {
    expect(typeof filesystemPlugin).toBe("object")
    expect(typeof filesystemPlugin).not.toBe("function")
  })
})
