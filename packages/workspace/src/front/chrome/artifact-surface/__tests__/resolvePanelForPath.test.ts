import { describe, it, expect } from "vitest"
import { normalizeSurfaceOpenRequest, resolvePanelForPath } from "../SurfaceShell"
import { SurfaceResolverRegistry } from "../../../../shared/plugins/SurfaceResolverRegistry"

function makeRegistry(matches: Record<string, string>) {
  const registry = new SurfaceResolverRegistry()
  for (const [suffix, component] of Object.entries(matches)) {
    registry.register(component, {
      resolve: (request) =>
        request.kind === "workspace.open.path" && request.target.endsWith(suffix)
          ? { component, params: { path: request.target } }
          : undefined,
    })
  }
  return registry
}

describe("normalizeSurfaceOpenRequest", () => {
  it("normalizes workspace path surface targets like openFile", () => {
    expect(normalizeSurfaceOpenRequest({
      kind: "workspace.open.path",
      target: "./src//index.ts",
      meta: { source: "test" },
    })).toEqual({
      kind: "workspace.open.path",
      target: "src/index.ts",
      meta: { source: "test" },
    })
  })

  it("rejects path traversal for workspace path surface targets", () => {
    expect(() => normalizeSurfaceOpenRequest({
      kind: "workspace.open.path",
      target: "../secret.txt",
    })).toThrow("path traversal")
  })

  it("does not alter non-path surface targets", () => {
    const request = { kind: "data-catalog.open-row", target: "../series" }
    expect(normalizeSurfaceOpenRequest(request)).toBe(request)
  })
})

describe("resolvePanelForPath", () => {
  it("returns matched panel resolution for registered target", () => {
    const registry = makeRegistry({ ".ts": "code-editor", ".md": "markdown-editor" })
    expect(resolvePanelForPath("src/index.ts", registry)).toEqual(
      expect.objectContaining({ component: "code-editor", params: { path: "src/index.ts" } }),
    )
  })

  it("returns markdown-editor for .md files", () => {
    const registry = makeRegistry({ ".ts": "code-editor", ".md": "markdown-editor" })
    expect(resolvePanelForPath("README.md", registry)).toEqual(
      expect.objectContaining({ component: "markdown-editor" }),
    )
  })

  it("does not use core extension fallbacks when no resolver matches", () => {
    const registry = makeRegistry({})
    expect(resolvePanelForPath("foo.ts", registry)).toBeUndefined()
  })

  it("uses plugin-provided fallback resolver", () => {
    const registry = makeRegistry({})
    registry.register("fallback", {
      resolve: (request) =>
        request.kind === "workspace.open.path"
          ? { component: "empty-file-panel", params: { path: request.target }, score: -1 }
          : undefined,
    })
    expect(resolvePanelForPath("foo.ts", registry)).toEqual(
      expect.objectContaining({ component: "empty-file-panel" }),
    )
  })

  it("returns undefined for unknown extension with no resolver", () => {
    const registry = makeRegistry({})
    expect(resolvePanelForPath("data.xyz", registry)).toBeUndefined()
  })

  it("returns undefined when filesystem excluded and no resolver is registered", () => {
    const registry = makeRegistry({})
    expect(resolvePanelForPath("foo.ts", registry)).toBeUndefined()
  })

  it("passes the full path to resolvers", () => {
    const registry = new SurfaceResolverRegistry()
    registry.register("scoped", {
      resolve: (request) =>
        request.target === "src/front/lib/utils.ts"
          ? { component: "code-editor", params: { path: request.target } }
          : undefined,
    })
    expect(resolvePanelForPath("src/front/lib/utils.ts", registry)).toEqual(
      expect.objectContaining({ component: "code-editor" }),
    )
  })
})
