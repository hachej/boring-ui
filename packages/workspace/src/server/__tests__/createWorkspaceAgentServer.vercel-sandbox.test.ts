/**
 * Pins that exec_ui / get_ui_state survive mode:"vercel-sandbox".
 *
 * In vercel-sandbox mode createAgentApp skips the pi plugin loader, but the
 * UI tools arrive via extraTools from the workspace wrapper — they must still
 * appear in the catalog and the bridge routes must still be wired.
 *
 * We cannot boot an actual Vercel sandbox in unit tests (requires live Vercel
 * credentials and microVMs). vi.mock redirects mode:"vercel-sandbox" → "direct"
 * inside createAgentApp while passing all other options (extraTools,
 * systemPromptAppend, etc.) through unchanged. This tests the workspace
 * wrapper's bridge wiring contract, not Vercel infrastructure.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test, describe, vi } from "vitest"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"
import type { ExecUiToolOptions } from "../ui-control/tools/uiTools"
import type { UiBridge } from "../../shared/ui-bridge"

// ── spies ─────────────────────────────────────────────────────────────────────
// Captures the workspaceRoot that createAgentApp receives so we can assert bash
// tools are given the same base path as exec_ui.
let capturedAgentWorkspaceRoot: string | undefined
vi.mock("@boring/agent/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@boring/agent/server")>()
  return {
    ...mod,
    createAgentApp: (opts: Parameters<typeof mod.createAgentApp>[0]) => {
      capturedAgentWorkspaceRoot = opts?.workspaceRoot
      return mod.createAgentApp({ ...opts, mode: "direct" })
    },
  }
})

// Captures the workspaceRoot that createWorkspaceUiTools receives so we can
// assert exec_ui is created without host-side path validation in vercel-sandbox.
let capturedUiWorkspaceRoot: string | undefined | "not-called"
vi.mock("../ui-control/tools/uiTools", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../ui-control/tools/uiTools")>()
  return {
    ...mod,
    createWorkspaceUiTools: (bridge: UiBridge, opts?: ExecUiToolOptions) => {
      capturedUiWorkspaceRoot = opts?.workspaceRoot
      return mod.createWorkspaceUiTools(bridge, opts)
    },
  }
})

const tempDirs: string[] = []

beforeEach(() => {
  capturedAgentWorkspaceRoot = undefined
  capturedUiWorkspaceRoot = "not-called"
})

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("createWorkspaceAgentServer — vercel-sandbox mode UI bridge", () => {
  test("get_ui_state and exec_ui are registered in the catalog", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-vs-catalog-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(res.statusCode).toBe(200)
      const names = res.json().tools.map((t: { name: string }) => t.name)
      expect(names).toContain("get_ui_state")
      expect(names).toContain("exec_ui")
    } finally {
      await app.close()
    }
  })

  test("UI state round-trip: PUT state is readable via GET /api/v1/ui/state", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-vs-state-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    try {
      const payload = {
        v: 1,
        workbenchOpen: true,
        drawerOpen: false,
        openTabs: [{ id: "file:index.ts", title: "index.ts", params: { path: "index.ts" } }],
        activeTab: "file:index.ts",
        activeFile: "index.ts",
      }
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/ui/state",
        payload: { state: payload, causedBy: "user" },
      })
      expect(put.statusCode).toBe(204)

      const get = await app.inject({ method: "GET", url: "/api/v1/ui/state" })
      expect(get.statusCode).toBe(200)
      expect(get.json()).toMatchObject({
        workbenchOpen: true,
        activeFile: "index.ts",
        openTabs: expect.arrayContaining([
          expect.objectContaining({ id: "file:index.ts" }),
        ]),
      })
    } finally {
      await app.close()
    }
  })

  test("exec_ui command is dispatched and drained via the bridge route", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-vs-cmd-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    try {
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/ui/commands",
        payload: { kind: "openSurface", params: { kind: "my-plugin.open", target: "item-1" } },
      })
      expect(post.statusCode).toBe(200)
      expect(post.json().status).toBe("ok")

      const drain = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      expect(drain.statusCode).toBe(200)
      const cmds = drain.json()
      expect(cmds).toHaveLength(1)
      expect(cmds[0].kind).toBe("openSurface")
      expect(cmds[0].params).toMatchObject({ kind: "my-plugin.open", target: "item-1" })
    } finally {
      await app.close()
    }
  })

  test("exec_ui and bash tools share the same workspaceRoot base path", async () => {
    // In vercel-sandbox mode the workspace files live inside a Firecracker
    // microVM, not on the host server. exec_ui must NOT stat-check paths against
    // the host FS — that would always fail for VM-produced files. Bash tools DO
    // operate from workspaceRoot (the VM receives it as its workspace root).
    //
    // This test pins that createWorkspaceAgentServer passes workspaceRoot to
    // createAgentApp (bash tools) but NOT to createWorkspaceUiTools (exec_ui),
    // so both tools share the same base path reference without the host
    // incorrectly blocking VM-relative paths.
    const workspaceRoot = await makeTempDir("boring-vs-basepath-")
    await mkdir(join(workspaceRoot, "src"), { recursive: true })
    await writeFile(join(workspaceRoot, "src", "app.ts"), "export const x = 1")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    await app.close()

    // Bash tools receive the workspaceRoot as their cwd inside the VM.
    expect(capturedAgentWorkspaceRoot).toBe(workspaceRoot)

    // exec_ui receives NO workspaceRoot — host-side path validation is disabled
    // so VM-produced files (e.g. "agent-output/chart.svg") are not rejected.
    expect(capturedUiWorkspaceRoot).toBeUndefined()
  })

  test("bridge is shared: POST /api/v1/ui/commands drains the same queue as the exec_ui tool", async () => {
    // If the bridge wired into extraTools and the bridge wired into uiRoutes
    // were different instances, the drain would always return []. This
    // proves they are the same instance in vercel-sandbox mode.
    const workspaceRoot = await makeTempDir("boring-workspace-vs-shared-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "vercel-sandbox",
      logger: false,
    })
    try {
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/ui/commands",
        payload: { kind: "showNotification", params: { msg: "hello", level: "info" } },
      })
      expect(post.json().status).toBe("ok")

      const drain = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      const cmds = drain.json()
      expect(cmds).toHaveLength(1)
      expect(cmds[0].kind).toBe("showNotification")

      // Second drain returns empty — command was consumed
      const empty = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      expect(empty.json()).toEqual([])
    } finally {
      await app.close()
    }
  })
})
