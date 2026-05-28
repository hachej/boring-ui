/**
 * Unit tests for the workspace UI tools — path validation in particular.
 *
 * Why: exec_ui openFile used to be fire-and-forget (returned status:ok as
 * soon as the command was queued, even if the path was bogus). The agent
 * had no signal to recover; the frontend silently no-op'd. Server-side
 * stat-checking now returns an error result the LLM can react to.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, describe } from "vitest"
import { createExecUiTool, createWorkspaceUiTools } from "../ui-control/tools/uiTools"
import { createInMemoryBridge } from "../bridge/createInMemoryBridge"
import type { UiBridge } from "../../shared/ui-bridge"

const FAKE_CTX = {
  abortSignal: new AbortController().signal,
  toolCallId: "ui-tools-test",
}

describe("createExecUiTool — path validation", () => {
  let workspaceRoot: string
  let bridge: UiBridge

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "uitools-pathval-"))
    await mkdir(join(workspaceRoot, "src"), { recursive: true })
    await writeFile(join(workspaceRoot, "src", "README.md"), "# nested\n")
    await writeFile(join(workspaceRoot, "..notes.md"), "# dotdot prefix is not traversal\n")
    await writeFile(join(workspaceRoot, "package.json"), '{"name":"x"}\n')
    bridge = createInMemoryBridge()
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("openFile succeeds when path exists", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "src/README.md" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
  })

  test("openFile on a folder posts expandToFile instead of opening an editor tab", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "src" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
    await expect(bridge.drainCommands!()).resolves.toEqual([
      expect.objectContaining({ kind: "expandToFile", params: { path: "src" } }),
    ])
  })

  test("openFile on a folder uses the runtime path kind resolver without a host workspace root", async () => {
    const tool = createExecUiTool(bridge, {
      resolvePathKind: async (path) => path === "src" ? "dir" : null,
    })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "src" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
    await expect(bridge.drainCommands!()).resolves.toEqual([
      expect.objectContaining({ kind: "expandToFile", params: { path: "src" } }),
    ])
  })

  test("openFile returns error when path does not exist", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "README.md" } },
      FAKE_CTX,
    )
    expect(result.isError).toBe(true)
    const text = result.content[0]
    expect(text?.type).toBe("text")
    if (text?.type === "text") {
      expect(text.text).toMatch(/file not found/i)
      expect(text.text).toContain("Try find or grep")
    }
  })

  test("openFile error message hints at the workspace root", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "missing.ts" } },
      FAKE_CTX,
    )
    const text = result.content[0]
    if (text?.type === "text") {
      expect(text.text).toContain(workspaceRoot)
    }
  })

  test("openFile accepts in-workspace filenames that merely start with dotdot", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "..notes.md" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
  })

  test("openFile rejects absolute paths", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    for (const path of ["/etc/passwd", "C:\\Users\\me\\secret.txt", "\\\\server\\share\\secret.txt"]) {
      const result = await tool.execute(
        { kind: "openFile", params: { path } },
        FAKE_CTX,
      )
      expect(result.isError).toBe(true)
      const text = result.content[0]
      if (text?.type === "text") {
        expect(text.text).toMatch(/absolute/)
      }
    }
  })

  test("openFile rejects paths that escape the workspace root", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "../../etc/passwd" } },
      FAKE_CTX,
    )
    expect(result.isError).toBe(true)
    const text = result.content[0]
    if (text?.type === "text") {
      expect(text.text).toMatch(/escapes/)
    }
  })

  test("navigateToLine validates the `file` param (not `path`)", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const ok = await tool.execute(
      {
        kind: "navigateToLine",
        params: { file: "src/README.md", line: 1 },
      },
      FAKE_CTX,
    )
    expect(ok.isError).toBeFalsy()

    const bad = await tool.execute(
      {
        kind: "navigateToLine",
        params: { file: "missing.ts", line: 1 },
      },
      FAKE_CTX,
    )
    expect(bad.isError).toBe(true)
  })

  test("expandToFile validates the path", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "expandToFile", params: { path: "missing.ts" } },
      FAKE_CTX,
    )
    expect(result.isError).toBe(true)
  })

  test("exec_ui advertises openSurface", () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const parameters = tool.parameters as {
      properties?: { kind?: { enum?: string[] } }
    }
    const kind = parameters.properties?.kind
    expect(kind?.enum).toContain("openSurface")
  })

  test("non-path kinds (openPanel, openSurface, showNotification, closeWorkbenchLeftPane) do not get path-validated", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const openPanelResult = await tool.execute(
      {
        kind: "openPanel",
        params: { id: "p1", component: "chart-canvas" },
      },
      FAKE_CTX,
    )
    expect(openPanelResult.isError).toBeFalsy()

    const openSurfaceResult = await tool.execute(
      {
        kind: "openSurface",
        params: {
          kind: "my-plugin.open-row",
          target: "orders_daily",
          meta: { catalogId: "my-plugin" },
        },
      },
      FAKE_CTX,
    )
    expect(openSurfaceResult.isError).toBeFalsy()

    const showNotifResult = await tool.execute(
      {
        kind: "showNotification",
        params: { msg: "hi", level: "info" },
      },
      FAKE_CTX,
    )
    expect(showNotifResult.isError).toBeFalsy()

    const closeLeftResult = await tool.execute(
      {
        kind: "closeWorkbenchLeftPane",
        params: {},
      },
      FAKE_CTX,
    )
    expect(closeLeftResult.isError).toBeFalsy()
  })

  test("openSurface validates required target params", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const missingTarget = await tool.execute(
      { kind: "openSurface", params: { kind: "my-plugin.open-row" } },
      FAKE_CTX,
    )
    expect(missingTarget.isError).toBe(true)

    const badMeta = await tool.execute(
      {
        kind: "openSurface",
        params: { kind: "my-plugin.open-row", target: "x", meta: "bad" },
      },
      FAKE_CTX,
    )
    expect(badMeta.isError).toBe(true)
  })

  test("opts omitted: relative paths pass through without stat validation", async () => {
    const tool = createExecUiTool(bridge) // no workspaceRoot
    const result = await tool.execute(
      { kind: "openFile", params: { path: "definitely-does-not-exist.md" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
  })

  test("opts omitted: absolute paths are still rejected", async () => {
    const tool = createExecUiTool(bridge) // no workspaceRoot
    for (const path of ["/data/workspaces/ws/deck/labor.md", "C:\\deck\\labor.md"]) {
      const result = await tool.execute(
        { kind: "openFile", params: { path } },
        FAKE_CTX,
      )
      expect(result.isError).toBe(true)
      const text = result.content[0]
      if (text?.type === "text") expect(text.text).toMatch(/absolute/)
    }
  })

  test("createWorkspaceUiTools forwards workspaceRoot to exec_ui", async () => {
    const [, execUi] = createWorkspaceUiTools(bridge, { workspaceRoot })
    const result = await execUi!.execute(
      { kind: "openFile", params: { path: "missing.ts" } },
      FAKE_CTX,
    )
    expect(result.isError).toBe(true)
  })
})

describe("createExecUiTool — auto state verification", () => {
  let workspaceRoot: string
  let bridge: UiBridge

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "uitools-verify-"))
    await writeFile(join(workspaceRoot, "index.ts"), "export {}")
    bridge = createInMemoryBridge()
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  test("openFile response includes uiState snapshot after dispatch", async () => {
    const mockState = {
      v: 1 as const,
      workbenchOpen: true,
      drawerOpen: false,
      openTabs: [{ id: "file:index.ts", title: "index.ts", params: { path: "index.ts" } }],
      activeTab: "file:index.ts",
      activeFile: "index.ts",
    }
    await bridge.setState(mockState)

    const tool = createExecUiTool(bridge, { workspaceRoot, verifyDelayMs: 0 })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "index.ts" } },
      FAKE_CTX,
    )
    // verifyDelayMs:0 — no uiState
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(parsed.uiState).toBeUndefined()
  })

  test("openFile with verifyDelayMs includes uiState from bridge", async () => {
    const mockState = {
      v: 1 as const,
      workbenchOpen: true,
      drawerOpen: false,
      openTabs: [{ id: "file:index.ts", title: "index.ts", params: { path: "index.ts" } }],
      activeTab: "file:index.ts",
      activeFile: "index.ts",
    }
    await bridge.setState(mockState)

    const tool = createExecUiTool(bridge, { workspaceRoot, verifyDelayMs: 1 })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "index.ts" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(parsed.uiState).toBeDefined()
    expect(parsed.uiState.openTabs).toHaveLength(1)
    expect(parsed.uiState.activeFile).toBe("index.ts")
  })

  test("openPanel and openSurface also include uiState", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot, verifyDelayMs: 1 })

    const panelResult = await tool.execute(
      { kind: "openPanel", params: { id: "chart:X", component: "chart-canvas" } },
      FAKE_CTX,
    )
    const panelParsed = JSON.parse((panelResult.content[0] as { type: "text"; text: string }).text)
    expect(panelParsed.uiState).toBeDefined()

    const surfaceResult = await tool.execute(
      { kind: "openSurface", params: { kind: "my-plugin.open", target: "item-1" } },
      FAKE_CTX,
    )
    const surfaceParsed = JSON.parse((surfaceResult.content[0] as { type: "text"; text: string }).text)
    expect(surfaceParsed.uiState).toBeDefined()
  })

  test("non-verifiable kinds do not include uiState", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot, verifyDelayMs: 1 })

    for (const [kind, params] of [
      ["showNotification", { msg: "hi" }],
      ["closeWorkbenchLeftPane", {}],
      ["expandToFile", { path: "index.ts" }],
    ] as const) {
      const result = await tool.execute({ kind, params }, FAKE_CTX)
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
      expect(parsed.uiState).toBeUndefined()
    }
  })

  test("uiState is null when bridge has no state yet", async () => {
    // bridge.getState() returns null before any setState call
    const tool = createExecUiTool(bridge, { workspaceRoot, verifyDelayMs: 1 })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "index.ts" } },
      FAKE_CTX,
    )
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    // uiState key present, value is null (bridge not yet hydrated by frontend)
    expect("uiState" in parsed).toBe(true)
    expect(parsed.uiState).toBeNull()
  })

  test("stops retrying early when openFile tab is found on first read", async () => {
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        return {
          v: 1 as const,
          workbenchOpen: true,
          drawerOpen: false,
          openTabs: [{ id: "file:index.ts", title: "index.ts", params: { path: "index.ts" } }],
          activeTab: "file:index.ts",
          activeFile: "index.ts",
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 5,
      verifyIntervalMs: 1,
    })
    await tool.execute({ kind: "openFile", params: { path: "index.ts" } }, FAKE_CTX)
    // verified on first read — loop should not iterate at all
    expect(callCount).toBe(1)
  })

  test("retries until tab appears, then stops early", async () => {
    // Simulates frontend being slow: tab absent for 2 reads, appears on 3rd.
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        const hasTab = callCount >= 3
        return {
          v: 1 as const,
          workbenchOpen: true,
          drawerOpen: false,
          openTabs: hasTab
            ? [{ id: "file:index.ts", title: "index.ts", params: { path: "index.ts" } }]
            : [],
          activeTab: hasTab ? "file:index.ts" : null,
          activeFile: hasTab ? "index.ts" : null,
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 5,
      verifyIntervalMs: 1,
    })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "index.ts" } },
      FAKE_CTX,
    )
    // read 1 (empty) → retry → read 2 (empty) → retry → read 3 (tab found) → stop
    expect(callCount).toBe(3)
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(parsed.uiState.openTabs).toHaveLength(1)
    expect(parsed.uiState.activeFile).toBe("index.ts")
  })

  test("exhausts retry budget and returns last state when tab never appears", async () => {
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        return {
          v: 1 as const,
          workbenchOpen: true,
          drawerOpen: false,
          openTabs: [],
          activeTab: null,
          activeFile: null,
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 3,
      verifyIntervalMs: 1,
    })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "index.ts" } },
      FAKE_CTX,
    )
    // initial read + 3 retries (never verified, budget exhausted)
    expect(callCount).toBe(4)
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    // still returns the state so agent can see the tab didn't appear
    expect(parsed.uiState.openTabs).toHaveLength(0)
  })

  test("openPanel stops early when panel id appears in openTabs", async () => {
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        const hasTab = callCount >= 2
        return {
          v: 1 as const,
          workbenchOpen: true,
          drawerOpen: false,
          openTabs: hasTab
            ? [{ id: "chart:X", title: "Chart", params: { seriesId: "X" } }]
            : [],
          activeTab: hasTab ? "chart:X" : null,
          activeFile: null,
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 5,
      verifyIntervalMs: 1,
    })
    await tool.execute(
      { kind: "openPanel", params: { id: "chart:X", component: "chart-canvas" } },
      FAKE_CTX,
    )
    // read 1 (empty) → retry → read 2 (tab found) → stop
    expect(callCount).toBe(2)
  })

  test("closePanel verifies when tab disappears from openTabs", async () => {
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        return {
          v: 1 as const,
          workbenchOpen: true,
          drawerOpen: false,
          openTabs: [],
          activeTab: null,
          activeFile: null,
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 5,
      verifyIntervalMs: 1,
    })
    await tool.execute({ kind: "closePanel", params: { id: "chart:X" } }, FAKE_CTX)
    // tab already absent on first read — verified immediately
    expect(callCount).toBe(1)
  })

  test("verifyRetries:0 reads state exactly once without looping", async () => {
    let callCount = 0
    const trackedBridge = {
      ...bridge,
      async getState() {
        callCount++
        return {
          v: 1 as const,
          workbenchOpen: false,
          drawerOpen: false,
          openTabs: [],
          activeTab: null,
          activeFile: null,
        }
      },
    }
    const tool = createExecUiTool(trackedBridge, {
      workspaceRoot,
      verifyDelayMs: 1,
      verifyRetries: 0,
      verifyIntervalMs: 1,
    })
    await tool.execute({ kind: "openFile", params: { path: "index.ts" } }, FAKE_CTX)
    expect(callCount).toBe(1)
  })
})
