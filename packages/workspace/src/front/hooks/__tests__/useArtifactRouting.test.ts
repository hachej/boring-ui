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
  it("resolvePanel has no filesystem defaults", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() => useArtifactRouting(panels))

    expect(result.current.resolvePanel("write")).toBeUndefined()
    expect(result.current.resolvePanel("edit")).toBeUndefined()
    expect(result.current.resolvePanel("read")).toBeUndefined()
    expect(result.current.resolvePanel("markdown")).toBeUndefined()
    expect(result.current.resolvePanel("csv")).toBeUndefined()
    expect(result.current.resolvePanel("data")).toBeUndefined()
  })

  it("resolvePanel returns undefined for unknown tool", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { write: "code-editor" } }),
    )

    expect(result.current.resolvePanel("unknown_tool")).toBeUndefined()
  })

  it("openForTool opens artifact panel with correct component", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { write: "code-editor" } }),
    )

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
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { write: "code-editor" } }),
    )

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

  it("custom toolPanelMap resolves explicit mappings only", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { custom_tool: "my-viewer" } }),
    )

    expect(result.current.resolvePanel("custom_tool")).toBe("my-viewer")
    expect(result.current.resolvePanel("write")).toBeUndefined()
  })

  it("custom toolPanelMap can provide filesystem mappings", () => {
    const panels = createMockPanels()
    const { result } = renderHook(() =>
      useArtifactRouting(panels, { toolPanelMap: { write: "custom-editor" } }),
    )

    expect(result.current.resolvePanel("write")).toBe("custom-editor")
  })
})
