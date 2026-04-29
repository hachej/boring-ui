import { describe, it, expect } from "vitest"
import { resolvePanelForPath } from "../SurfaceShell"

function makeRegistry(
  panels: Record<string, string[]>,
): { resolve: (p: string) => { id: string } | undefined; has: (id: string) => boolean } {
  const entries = Object.entries(panels)
  return {
    resolve(path: string) {
      for (const [id, patterns] of entries) {
        for (const pattern of patterns) {
          if (pattern === "*") return { id }
          const ext = pattern.replace("*.", ".")
          if (path.endsWith(ext)) return { id }
        }
      }
      return undefined
    },
    has(id: string) {
      return id in panels
    },
  }
}

describe("resolvePanelForPath", () => {
  it("returns matched panel for registered extension", () => {
    const registry = makeRegistry({
      "code-editor": ["*.ts", "*.tsx", "*.js"],
      "markdown-editor": ["*.md"],
    })
    expect(resolvePanelForPath("src/index.ts", registry)).toBe("code-editor")
  })

  it("returns markdown-editor for .md files", () => {
    const registry = makeRegistry({
      "code-editor": ["*.ts"],
      "markdown-editor": ["*.md"],
    })
    expect(resolvePanelForPath("README.md", registry)).toBe("markdown-editor")
  })

  it("falls back to extension-based id when no pattern matches", () => {
    const registry = makeRegistry({
      "code-editor": [],
    })
    // .ts falls back to 'code-editor' via fallbackComponentForPath
    expect(resolvePanelForPath("foo.ts", registry)).toBe("code-editor")
  })

  it("returns empty-file-panel when no panel is registered for extension", () => {
    const registry = makeRegistry({})
    expect(resolvePanelForPath("foo.ts", registry)).toBe("empty-file-panel")
  })

  it("returns empty-file-panel for unknown extension with no fallback registered", () => {
    const registry = makeRegistry({})
    expect(resolvePanelForPath("data.xyz", registry)).toBe("empty-file-panel")
  })

  it("returns empty-file-panel when filesystem excluded (no code-editor)", () => {
    const registry = makeRegistry({
      "chat": [],
      "session-list": [],
    })
    expect(resolvePanelForPath("foo.ts", registry)).toBe("empty-file-panel")
  })

  it("prefers full path resolution over basename", () => {
    const registry = makeRegistry({
      "code-editor": ["*.ts"],
    })
    expect(resolvePanelForPath("src/lib/utils.ts", registry)).toBe("code-editor")
  })
})
