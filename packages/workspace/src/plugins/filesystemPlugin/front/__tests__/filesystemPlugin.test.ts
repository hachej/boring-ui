import { describe, it, expect, vi } from "vitest"
import filesystemFront, { createFilesystemPlugin, filesystemPlugin } from "../index"
import { createFilesCatalog } from "../catalogs"

describe("filesystemPlugin", () => {
  it("has id 'filesystem'", () => {
    expect(filesystemPlugin.id).toBe("filesystem")
  })

  it("has label 'Filesystem'", () => {
    expect(filesystemPlugin.label).toBe("Filesystem")
  })

  it("registers provider, preload binding, files left-tab output, surface resolver, and editor/viewer panels", () => {
    expect(filesystemPlugin.outputs).toHaveLength(14)
    expect(filesystemPlugin.outputs![0]).toEqual(
      expect.objectContaining({
        type: "provider",
        id: "filesystem-data",
      }),
    )
    expect(filesystemPlugin.outputs![1]).toEqual(
      expect.objectContaining({
        type: "binding",
        id: "filesystem-tree-preload",
      }),
    )
    expect(filesystemPlugin.outputs![2]).toEqual(
      expect.objectContaining({
        type: "left-tab",
        id: "files",
        title: "Files",
        source: "builtin",
      }),
    )
    expect(filesystemPlugin.outputs![10]).toEqual(
      expect.objectContaining({
        type: "surface-resolver",
        resolver: expect.objectContaining({ id: "filesystem-path" }),
      }),
    )
    expect(filesystemPlugin.panels).toBeUndefined()
    const ids = filesystemPlugin.outputs!
      .filter((output) => output.type === "panel")
      .map((output) => output.panel.id)
    expect(ids).toEqual(["empty-file-panel", "code-editor", "csv-viewer", "markdown-editor", "image-viewer", "pdf-viewer", "html-viewer"])
  })

  it("all panels have source 'builtin'", () => {
    for (const output of filesystemPlugin.outputs!) {
      if (output.type === "panel") expect(output.panel.source).toBe("builtin")
    }
  })

  it("surface resolver routes common code extensions", () => {
    const resolver = filesystemPlugin.outputs!.find((output) => output.type === "surface-resolver")!
    expect(resolver.type).toBe("surface-resolver")
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "src/App.tsx" })).toEqual(
      expect.objectContaining({ component: "code-editor", params: { path: "src/App.tsx" } }),
    )
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "py/main.py" })).toEqual(
      expect.objectContaining({ component: "code-editor" }),
    )
  })

  it("surface resolver routes markdown paths", () => {
    const resolver = filesystemPlugin.outputs!.find((output) => output.type === "surface-resolver")!
    expect(resolver.type).toBe("surface-resolver")
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "README.md" })).toEqual(
      expect.objectContaining({ component: "markdown-editor" }),
    )
  })

  it("surface resolver routes tabular file artifacts", () => {
    const resolver = filesystemPlugin.outputs!.find((output) => output.type === "surface-resolver")!
    expect(resolver.type).toBe("surface-resolver")
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "data/status.csv" })).toEqual(
      expect.objectContaining({ component: "csv-viewer" }),
    )
  })

  it("surface resolver routes image, PDF, and HTML previews", () => {
    const resolver = filesystemPlugin.outputs!.find((output) => output.type === "surface-resolver")!
    expect(resolver.type).toBe("surface-resolver")
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "assets/chart.png" })).toEqual(
      expect.objectContaining({ component: "image-viewer" }),
    )
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "docs/report.pdf" })).toEqual(
      expect.objectContaining({ component: "pdf-viewer" }),
    )
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "public/index.html" })).toEqual(
      expect.objectContaining({ component: "html-viewer" }),
    )
  })

  it("surface resolver falls back for unsupported paths", () => {
    const resolver = filesystemPlugin.outputs!.find((output) => output.type === "surface-resolver")!
    expect(resolver.type).toBe("surface-resolver")
    expect(resolver.resolver.resolve({ kind: "workspace.open.path", target: "blob.bin" })).toEqual(
      expect.objectContaining({ component: "empty-file-panel" }),
    )
  })

  it("has no catalogs (catalogs are registered at runtime via bindings)", () => {
    expect(filesystemPlugin.catalogs).toBeUndefined()
  })

  it("ships runtime bindings as factory outputs", () => {
    const bindingIds = filesystemPlugin.outputs!
      .filter((output) => output.type === "binding")
      .map((output) => output.id)
    expect(bindingIds).toEqual([
      "filesystem-tree-preload",
      "filesystem-catalog",
      "filesystem-file-panel",
      "filesystem-agent-file-bridge",
    ])
    expect(createFilesystemPlugin().bindings).toBeUndefined()
  })

  it("default-exports a BoringFrontFactory for shape parity", () => {
    expect(typeof filesystemFront).toBe("function")
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
