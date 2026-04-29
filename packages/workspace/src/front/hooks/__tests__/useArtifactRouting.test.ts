import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useArtifactRouting } from "../useArtifactRouting"
import type { UseArtifactPanelsReturn } from "../useArtifactPanels"

function createMockPanels(): UseArtifactPanelsReturn {
  return {
    panels: [],
    open: vi.fn(),
    close: vi.fn(),
    activate: vi.fn(),
    isOpen: vi.fn().mockReturnValue(false),
  }
}

describe("useArtifactRouting", () => {
  it("resolvePanel maps known tool names to panel types", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() => useArtifactRouting(panels))

    expect(result.current.resolvePanel("write")).toBe("code-editor")
    expect(result.current.resolvePanel("edit")).toBe("code-editor")
    expect(result.current.resolvePanel("read")).toBe("code-editor")
    expect(result.current.resolvePanel("markdown")).toBe("markdown-editor")
    expect(result.current.resolvePanel("csv")).toBe("csv-viewer")
    expect(result.current.resolvePanel("data")).toBe("csv-viewer")
  })

  it("resolvePanel returns undefined for unknown tool", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() => useArtifactRouting(panels))

    expect(result.current.resolvePanel("unknown_tool")).toBeUndefined()
  })

  it("openForTool opens artifact panel with correct component", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() => useArtifactRouting(panels))

    act(() => {
      result.current.openForTool("write", { path: "src/index.ts" })
    })

    expect(panels.open).toHaveBeenCalledWith({
      id: "artifact-src/index.ts",
      component: "code-editor",
      params: { path: "src/index.ts" },
    })
  })

  it("openForTool activates existing panel instead of opening new one", () => {
    const panels = createMockPanels()
    ;(panels.isOpen as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const { result } = renderHook(() => useArtifactRouting(panels))

    act(() => {
      result.current.openForTool("write", { path: "src/index.ts" })
    })

    expect(panels.activate).toHaveBeenCalledWith("artifact-src/index.ts")
    expect(panels.open).not.toHaveBeenCalled()
  })

  it("openForTool does nothing for unknown tool", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() => useArtifactRouting(panels))

    act(() => {
      result.current.openForTool("unknown", { path: "test.ts" })
    })

    expect(panels.open).not.toHaveBeenCalled()
    expect(panels.activate).not.toHaveBeenCalled()
  })

  it("custom toolPanelMap overrides defaults", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { custom_tool: "my-viewer" } }),
    )

    expect(result.current.resolvePanel("custom_tool")).toBe("my-viewer")
    expect(result.current.resolvePanel("write")).toBe("code-editor")
  })

  it("custom toolPanelMap can override built-in mappings", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { write: "custom-editor" } }),
    )

    expect(result.current.resolvePanel("write")).toBe("custom-editor")
  })
})
