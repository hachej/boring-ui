/**
 * Integration tests for createWorkspaceAgentServer — the wrapper that
 * registers the UI bridge surface on top of @boring/agent's createAgentApp.
 *
 * Migrated from packages/agent/src/server/__tests__/createAgentApp.test.ts
 * as part of UI_BRIDGE_OWNERSHIP_REFACTOR. The agent test suite still pins
 * "standalone agent has NO UI bridge surface" — this file pins the inverse:
 * "workspace wrapper EXPOSES the UI bridge surface via shared instance".
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, describe } from "vitest"
import { createWorkspaceAgentServer } from "../../app/server/createWorkspaceAgentServer"
import * as appServerApi from "../../app/server"
import * as serverApi from "../index"

const tempDirs: string[] = []

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

describe("createWorkspaceAgentServer — UI bridge wiring", () => {
  test("is exported from the app entry, not the server entry", () => {
    expect(appServerApi.createWorkspaceAgentServer).toBe(createWorkspaceAgentServer)
    expect("createWorkspaceAgentServer" in serverApi).toBe(false)
  })

  test("registers get_ui_state and exec_ui in the catalog", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-uitools-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
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

  test("PUT /api/v1/ui/state is round-tripped by GET", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-roundtrip-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })
    try {
      const initial = await app.inject({ method: "GET", url: "/api/v1/ui/state" })
      expect(initial.statusCode).toBe(200)
      expect(initial.json()).toEqual({})

      const payload = {
        v: 1,
        workbenchOpen: true,
        drawerOpen: false,
        openTabs: [
          { id: "file:greeter.ts", title: "greeter.ts", params: { path: "greeter.ts" } },
        ],
        activeTab: "file:greeter.ts",
        activeFile: "greeter.ts",
      }
      const put = await app.inject({
        method: "PUT",
        url: "/api/v1/ui/state",
        payload: { state: payload, causedBy: "user" },
      })
      expect(put.statusCode).toBe(204)

      const after = await app.inject({ method: "GET", url: "/api/v1/ui/state" })
      expect(after.statusCode).toBe(200)
      expect(after.json()).toEqual(payload)
    } finally {
      await app.close()
    }
  })

  test("exec_ui-style POST /api/v1/ui/commands enqueues for drain", async () => {
    // The catalog's bridge and the route's bridge MUST be the same instance —
    // if they weren't, the LLM's exec_ui tool would write into one queue
    // and the frontend would drain a different (always-empty) queue. This
    // test proves they share by going through both surfaces.
    const workspaceRoot = await makeTempDir("boring-workspace-cmds-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })
    try {
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/ui/commands",
        payload: { kind: "openFile", params: { path: "greeter.ts" } },
      })
      expect(post.statusCode).toBe(200)
      const postBody = post.json()
      expect(postBody.status).toBe("ok")
      expect(typeof postBody.seq).toBe("number")

      const drain = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      expect(drain.statusCode).toBe(200)
      const drainBody = drain.json()
      expect(Array.isArray(drainBody)).toBe(true)
      expect(drainBody).toHaveLength(1)
      expect(drainBody[0].kind).toBe("openFile")
      expect(drainBody[0].params).toEqual({ path: "greeter.ts" })
      expect(drainBody[0].seq).toBe(postBody.seq)

      const drainAgain = await app.inject({
        method: "GET",
        url: "/api/v1/ui/commands/next?poll=true",
      })
      expect(drainAgain.json()).toEqual([])
    } finally {
      await app.close()
    }
  })
})

describe("createWorkspaceAgentServer — plugin model (j9p7.11)", () => {
  test("plugin agentTools appear in the tool catalog", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-plugins-")
    const domainTool = {
      name: "execute_sql",
      description: "Execute SQL queries against the data warehouse.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "ok" }] }
      },
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "macro", agentTools: [domainTool] }],
    })
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(res.statusCode).toBe(200)
      const names = res.json().tools.map((t: { name: string }) => t.name)
      expect(names).toContain("execute_sql")
      expect(names).toContain("get_ui_state")
      expect(names).toContain("bash")
      expect(names).toContain("read")
    } finally {
      await app.close()
    }
  })

  test("plugin agentTools preserve tool metadata in the catalog", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-plugin-tool-metadata-")
    const domainTool = {
      name: "plugin_ping",
      description: "A plugin-supplied executable tool.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "plugin-ok" }] }
      },
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "plugin-tools", agentTools: [domainTool] }],
    })
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(res.statusCode).toBe(200)
      const tool = res.json().tools.find((t: { name: string }) => t.name === "plugin_ping")
      expect(tool).toBeDefined()
      expect(tool.description).toBe("A plugin-supplied executable tool.")
    } finally {
      await app.close()
    }
  })

  test("excludeDefaults does not remove harness file tools", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-exclude-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      excludeDefaults: ["filesystem"],
    })
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(res.statusCode).toBe(200)
      const names = res.json().tools.map((t: { name: string }) => t.name)
      expect(names).toContain("read")
      expect(names).toContain("write")
      expect(names).toContain("edit")
      expect(names).toContain("bash")
    } finally {
      await app.close()
    }
  })

  test("/api/v1/files/search responds regardless of excludeDefaults", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-search-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      excludeDefaults: ["filesystem"],
    })
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/files/search?q=*.ts",
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe("createWorkspaceAgentServer — extraTools merge", () => {
  // Pins the wrapper's tool-merge contract: host-provided extraTools must
  // appear in the catalog ALONGSIDE the workspace UI tools, neither side
  // overwriting the other (assuming no name collisions). Per the wrapper's
  // implementation, host tools are merged first and workspace UI tools
  // second, so on a name collision the workspace tool wins — that's the
  // intended contract (workspace is the contract, host EXTENDS it).
  test("host extraTools are appended AND workspace UI tools are present", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-extratools-")
    const hostTool = {
      name: "host_canary",
      description: "A host-supplied tool that should appear alongside UI tools.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "host" }] }
      },
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      extraTools: [hostTool],
    })
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(res.statusCode).toBe(200)
      const names = res.json().tools.map((t: { name: string }) => t.name)
      // Both worlds present:
      expect(names).toContain("host_canary")
      expect(names).toContain("get_ui_state")
      expect(names).toContain("exec_ui")
      // Sanity: standard tools also present.
      expect(names).toContain("bash")
      expect(names).toContain("read")
    } finally {
      await app.close()
    }
  })
})
