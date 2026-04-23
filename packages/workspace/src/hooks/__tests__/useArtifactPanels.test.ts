import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useArtifactPanels } from "../useArtifactPanels"
import type { DockviewShellApi } from "../../dock"

function createMockShellApi(): DockviewShellApi {
  return {
    addPanel: vi.fn(),
    removePanel: vi.fn(),
    activatePanel: vi.fn(),
    movePanel: vi.fn(),
    getActivePanel: vi.fn().mockReturnValue(null),
    toJSON: vi.fn().mockReturnValue({ panels: {} }),
  }
}

describe("useArtifactPanels", () => {
  it("returns empty panels when surfaceApi is null", () => {
    const { result } = renderHook(() => useArtifactPanels(null))
    expect(result.current.panels).toEqual([])
  })

  it("open calls addPanel on surface API", () => {
    const api = createMockShellApi()
    const { result } = renderHook(() => useArtifactPanels(api))

    act(() => {
      result.current.open({
        id: "artifact-test.ts",
        component: "code-editor",
        params: { path: "test.ts" },
      })
    })

    expect(api.addPanel).toHaveBeenCalledWith("artifacts", {
      id: "artifact-test.ts",
      component: "code-editor",
      params: { path: "test.ts" },
    })
  })

  it("close calls removePanel on surface API", () => {
    const api = createMockShellApi()
    const { result } = renderHook(() => useArtifactPanels(api))

    act(() => {
      result.current.close("artifact-test.ts")
    })

    expect(api.removePanel).toHaveBeenCalledWith("artifact-test.ts")
  })

  it("activate calls activatePanel on surface API", () => {
    const api = createMockShellApi()
    const { result } = renderHook(() => useArtifactPanels(api))

    act(() => {
      result.current.activate("artifact-test.ts")
    })

    expect(api.activatePanel).toHaveBeenCalledWith("artifact-test.ts")
  })

  it("isOpen returns false when panel not in snapshot", () => {
    const api = createMockShellApi()
    const { result } = renderHook(() => useArtifactPanels(api))

    expect(result.current.isOpen("nonexistent")).toBe(false)
  })

  it("does not crash when surfaceApi is null and open is called", () => {
    const { result } = renderHook(() => useArtifactPanels(null))

    act(() => {
      result.current.open({
        id: "test",
        component: "code-editor",
      })
    })
  })
})
