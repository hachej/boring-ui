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

  test("openFile rejects absolute paths", async () => {
    const tool = createExecUiTool(bridge, { workspaceRoot })
    const result = await tool.execute(
      { kind: "openFile", params: { path: "/etc/passwd" } },
      FAKE_CTX,
    )
    expect(result.isError).toBe(true)
    const text = result.content[0]
    if (text?.type === "text") {
      expect(text.text).toMatch(/absolute/)
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
          kind: "data-catalog.open-row",
          target: "orders_daily",
          meta: { catalogId: "data-catalog" },
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
      { kind: "openSurface", params: { kind: "data-catalog.open-row" } },
      FAKE_CTX,
    )
    expect(missingTarget.isError).toBe(true)

    const badMeta = await tool.execute(
      {
        kind: "openSurface",
        params: { kind: "data-catalog.open-row", target: "x", meta: "bad" },
      },
      FAKE_CTX,
    )
    expect(badMeta.isError).toBe(true)
  })

  test("opts omitted: paths pass through without validation (back-compat)", async () => {
    const tool = createExecUiTool(bridge) // no workspaceRoot
    const result = await tool.execute(
      { kind: "openFile", params: { path: "definitely-does-not-exist.md" } },
      FAKE_CTX,
    )
    expect(result.isError).toBeFalsy()
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
