import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceBridge } from "../../front/bridge/types"
import { useFileContent, useFileList } from "../../front/data/hooks"
import * as testingApi from "../index"
import { createMockBridge } from "../createMockBridge"
import { createMockRegistry } from "../createMockRegistry"
import { renderPane } from "../renderPane"

function FixtureProbe({ bridge }: { bridge?: WorkspaceBridge }) {
  const { data: file } = useFileContent("src/main.ts")
  const { data: tree = [] } = useFileList(".")

  return (
    <div>
      <div data-testid="fixture-content">{file?.content ?? "loading"}</div>
      <div data-testid="fixture-tree">{tree.map((entry) => entry.path).join(",")}</div>
      <button type="button" onClick={() => bridge?.openFile("src/main.ts")}>
        open fixture
      </button>
    </div>
  )
}

describe("@boring/workspace/testing", () => {
  it("exports the testing harness surface", () => {
    expect(testingApi.TestWorkspaceProvider).toBeDefined()
    expect(testingApi.createMockBridge).toBeDefined()
    expect(testingApi.createMockRegistry).toBeDefined()
    expect(testingApi.renderPane).toBeDefined()
  })

  it("createMockRegistry returns a usable PanelRegistry", () => {
    const registry = createMockRegistry()
    expect(registry.has("workspace-testing-default-panel")).toBe(true)
  })

  it("createMockBridge exposes inspectable stubs and bridge.emit", async () => {
    const bridge = createMockBridge({
      fn: vi.fn,
      state: { activeFile: "/seed.ts", dirtyFiles: ["/seed.ts"] },
    })

    expect(bridge.getActiveFile()).toBe("/seed.ts")
    expect(bridge.getDirtyFiles()).toEqual(["/seed.ts"])
    expect(bridge.getActiveFile).toHaveBeenCalledTimes(1)
    expect(bridge.getDirtyFiles).toHaveBeenCalledTimes(1)

    const opened = vi.fn()
    const unsubscribe = bridge.subscribe("file:opened", opened)
    bridge.emit("file:opened", { path: "/next.ts", mode: "edit" })
    expect(opened).toHaveBeenCalledWith({ path: "/next.ts", mode: "edit" })
    unsubscribe()
    bridge.emit("file:opened", { path: "/last.ts", mode: "edit" })
    expect(opened).toHaveBeenCalledTimes(1)

    const selected = vi.fn()
    const stop = bridge.select((state) => state.activeFile, selected)
    bridge.setState({ activeFile: "/selected.ts" })
    expect(selected).toHaveBeenCalledWith("/selected.ts")
    stop()

    await bridge.openFile("/mode.ts", { mode: "view" })
    const modePanel = bridge.getOpenPanels().find((panel) => panel.id === "file:/mode.ts")
    expect(modePanel?.params?.mode).toBe("view")
  })

  it("renderPane wires provider tree + fixture-backed data without a real server", async () => {
    const bridge = createMockBridge({ fn: vi.fn })
    renderPane(<FixtureProbe />, {
      bridge,
      fixtures: {
        files: [
          { path: "src/main.ts", content: "fixture body" },
          { path: "src/extra.md", content: "# extra" },
        ],
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId("fixture-content").textContent).toContain("fixture body")
    })

    await waitFor(() => {
      expect(screen.getByTestId("fixture-tree").textContent).toContain("src")
    })

    fireEvent.click(screen.getByRole("button", { name: "open fixture" }))
    expect(bridge.openFile).toHaveBeenCalledWith("src/main.ts")
  })
})
