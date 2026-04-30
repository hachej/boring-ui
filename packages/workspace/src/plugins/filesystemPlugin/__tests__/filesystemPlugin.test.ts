import { describe, it, expect, vi } from "vitest"
import { createFilesystemPlugin, filesystemPlugin } from "../index"

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

  it("adds the files catalog when a file search client is supplied", async () => {
    const client = {
      search: vi.fn(async () => ["src/App.tsx"]),
    }
    const onOpenFile = vi.fn()
    const plugin = createFilesystemPlugin({ filesClient: client, onOpenFile })
    expect(plugin.catalogs).toHaveLength(1)
    expect(plugin.catalogs![0].id).toBe("files")

    const result = await plugin.catalogs![0].adapter.search({
      query: "app",
      filters: {},
      limit: 10,
      offset: 0,
    })

    expect(result.items).toEqual([
      { id: "src/App.tsx", title: "App.tsx", subtitle: "src/" },
    ])
    expect(client.search).toHaveBeenCalledWith("*app*", 10, undefined)
    plugin.catalogs![0].onSelect(result.items[0]!)
    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx", result.items[0])
  })

  it("is a plain const, not a factory", () => {
    expect(typeof filesystemPlugin).toBe("object")
    expect(typeof filesystemPlugin).not.toBe("function")
  })
})
