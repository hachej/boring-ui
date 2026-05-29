import { describe, it, expect, vi } from "vitest"
import { captureFrontPlugin } from "../../../../shared/plugins/frontFactory"
import filesystemFront, { filesystemPlugin } from "../index"
import { createFilesCatalog } from "../catalogs"

const capturedPlugin = captureFrontPlugin(filesystemPlugin)
const registrations = capturedPlugin.registrations
const resolver = registrations.surfaceResolvers.find((entry) => entry.id === "filesystem-path")!

describe("filesystemPlugin", () => {
  it("has id 'filesystem'", () => {
    expect(filesystemPlugin.pluginId).toBe("filesystem")
  })

  it("has label 'Filesystem'", () => {
    expect(filesystemPlugin.pluginLabel).toBe("Filesystem")
  })

  it("registers provider, preload binding, files left tab, surface resolver, and editor/viewer panels", () => {
    expect(registrations.providers.map((provider) => provider.id)).toEqual(["filesystem-data"])
    expect(registrations.bindings.map((binding) => binding.id)).toEqual([
      "filesystem-tree-preload",
      "filesystem-catalog",
      "filesystem-file-panel",
      "filesystem-agent-file-bridge",
    ])
    expect(registrations.leftTabs[0]).toEqual(
      expect.objectContaining({
        id: "files",
        title: "Files",
        source: "builtin",
      }),
    )
    expect(resolver).toEqual(expect.objectContaining({ id: "filesystem-path" }))
    expect(registrations.panels.map((panel) => panel.id)).toEqual([
      "empty-file-panel",
      "code-editor",
      "csv-viewer",
      "markdown-editor",
      "image-viewer",
      "pdf-viewer",
      "html-viewer",
    ])
  })

  it("all panels have source 'builtin'", () => {
    for (const panel of registrations.panels) expect(panel.source).toBe("builtin")
  })

  it("surface resolver routes common code extensions", () => {
    expect(resolver.resolve({ kind: "workspace.open.path", target: "src/App.tsx" })).toEqual(
      expect.objectContaining({ component: "code-editor", params: { path: "src/App.tsx" } }),
    )
    expect(resolver.resolve({ kind: "workspace.open.path", target: "py/main.py" })).toEqual(
      expect.objectContaining({ component: "code-editor" }),
    )
  })

  it("surface resolver routes markdown paths", () => {
    expect(resolver.resolve({ kind: "workspace.open.path", target: "README.md" })).toEqual(
      expect.objectContaining({ component: "markdown-editor" }),
    )
  })

  it("surface resolver routes tabular file artifacts", () => {
    expect(resolver.resolve({ kind: "workspace.open.path", target: "data/status.csv" })).toEqual(
      expect.objectContaining({ component: "csv-viewer" }),
    )
  })

  it("surface resolver routes image, PDF, and HTML previews", () => {
    expect(resolver.resolve({ kind: "workspace.open.path", target: "assets/chart.png" })).toEqual(
      expect.objectContaining({ component: "image-viewer" }),
    )
    expect(resolver.resolve({ kind: "workspace.open.path", target: "docs/report.pdf" })).toEqual(
      expect.objectContaining({ component: "pdf-viewer" }),
    )
    expect(resolver.resolve({ kind: "workspace.open.path", target: "public/index.html" })).toEqual(
      expect.objectContaining({ component: "html-viewer" }),
    )
  })

  it("surface resolver falls back to the code editor for unsupported paths", () => {
    expect(resolver.resolve({ kind: "workspace.open.path", target: "blob.bin" })).toEqual(
      expect.objectContaining({ component: "code-editor" }),
    )
  })

  it("ships runtime bindings as factory registrations", () => {
    expect(registrations.bindings.map((binding) => binding.id)).toEqual([
      "filesystem-tree-preload",
      "filesystem-catalog",
      "filesystem-file-panel",
      "filesystem-agent-file-bridge",
    ])
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

  it("exports a branded front factory", () => {
    expect(typeof filesystemPlugin).toBe("function")
    expect(filesystemPlugin.pluginId).toBe("filesystem")
  })
})
