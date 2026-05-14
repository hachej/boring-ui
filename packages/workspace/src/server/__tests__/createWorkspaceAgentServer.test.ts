/**
 * Integration tests for createWorkspaceAgentServer — the wrapper that
 * registers the UI bridge surface on top of @hachej/boring-agent's createAgentApp.
 *
 * Migrated from packages/agent/src/server/__tests__/createAgentApp.test.ts
 * as part of UI_BRIDGE_OWNERSHIP_REFACTOR. The agent test suite still pins
 * "standalone agent has NO UI bridge surface" — this file pins the inverse:
 * "workspace wrapper EXPOSES the UI bridge surface via shared instance".
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, describe } from "vitest"
import {
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
} from "../../app/server/createWorkspaceAgentServer"
import { createAskUserPluginBundle } from "../../plugins/askUserPlugin/server"
import * as appServerApi from "../../app/server"
import * as serverApi from "../index"

// Note: vercel-sandbox mode UI bridge tests live in
// createWorkspaceAgentServer.vercel-sandbox.test.ts — they require a
// top-level vi.mock on @hachej/boring-agent/server which would affect all tests here.

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

describe("createWorkspaceAgentServer — ask-user plugin wiring", () => {
  test("registers ask-user routes and tool when installed by the host app", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: tmpdir(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      disableDefaultFileTools: true,
      pluginFactories: [({ bridge }) => createAskUserPluginBundle({ workspaceRoot: tmpdir(), bridge })],
    })
    const badCommand = await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: {} })
    expect(badCommand.statusCode).toBe(400)
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).toContain("ask_user")
    await app.close()
  })

  test("does not register ask-user routes or tool unless installed", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: tmpdir(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      disableDefaultFileTools: true,
    })
    const command = await app.inject({ method: "POST", url: "/api/v1/questions/commands", payload: {} })
    expect(command.statusCode).toBe(404)
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).not.toContain("ask_user")
    await app.close()
  })
})

describe("createWorkspaceAgentServer — UI bridge wiring", () => {
  test("is exported from the app entry, not the server entry", () => {
    expect(appServerApi.createWorkspaceAgentServer).toBe(createWorkspaceAgentServer)
    expect(appServerApi.collectWorkspaceAgentServerPlugins).toBe(collectWorkspaceAgentServerPlugins)
    expect("createWorkspaceAgentServerBindings" in appServerApi).toBe(false)
    expect("createWorkspaceAgentServer" in serverApi).toBe(false)
  })

  test("plugin collector excludes standalone UI bridge tools", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-collector-")
    const domainTool = {
      name: "plugin_ping",
      description: "A plugin tool.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "ok" }] }
      },
    }
    const result = collectWorkspaceAgentServerPlugins({
      workspaceRoot,
      systemPromptAppend: "Host prompt",
      resourceLoaderOptions: {
        additionalSkillPaths: ["custom-skills"],
        piPackages: ["npm:host-pi", { source: "npm:plugin-pi" }],
      },
      plugins: [
        {
          id: "plugin",
          systemPrompt: "Plugin prompt",
          agentTools: [domainTool],
          piPackages: ["npm:plugin-pi"],
        },
      ],
    })

    expect(result.agentOptions.extraTools?.map((tool) => tool.name)).toEqual(["plugin_ping"])
    expect(result.agentOptions.systemPromptAppend).toBe("Host prompt\n\nPlugin prompt")
    expect(result.agentOptions.resourceLoaderOptions?.additionalSkillPaths).toEqual([
      join(workspaceRoot, ".agents", "skills"),
      "custom-skills",
    ])
    expect(result.agentOptions.resourceLoaderOptions?.piPackages).toEqual([
      "npm:plugin-pi",
      "npm:host-pi",
    ])
  })

  test("plugin collector applies server defaults before host plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-defaults-")
    const defaultTool = {
      name: "default_tool",
      description: "A default plugin tool.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "default" }] }
      },
    }
    const hostTool = {
      name: "host_tool",
      description: "A host plugin tool.",
      parameters: { type: "object" as const, properties: {} },
      async execute() {
        return { content: [{ type: "text" as const, text: "host" }] }
      },
    }

    const included = collectWorkspaceAgentServerPlugins({
      workspaceRoot,
      defaults: [{ id: "default", systemPrompt: "Default prompt", agentTools: [defaultTool] }],
      plugins: [{ id: "host", systemPrompt: "Host prompt", agentTools: [hostTool] }],
    })
    expect(included.agentOptions.extraTools?.map((tool) => tool.name)).toEqual([
      "default_tool",
      "host_tool",
    ])
    expect(included.agentOptions.systemPromptAppend).toBe("Default prompt\n\nHost prompt")

    const excluded = collectWorkspaceAgentServerPlugins({
      workspaceRoot,
      defaults: [{ id: "default", agentTools: [defaultTool] }],
      plugins: [{ id: "host", agentTools: [hostTool] }],
      excludeDefaults: ["default"],
    })
    expect(excluded.agentOptions.extraTools?.map((tool) => tool.name)).toEqual([
      "host_tool",
    ])
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

describe("createWorkspaceAgentServer — plugin provisioning", () => {
  test("collects plugin provisioning declarations and asks agent to seed workspace", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-provisioned-")
    const templateRoot = await makeTempDir("boring-workspace-template-")
    await mkdir(join(templateRoot, ".agents", "skills", "plugin-skill"), { recursive: true })
    await writeFile(join(templateRoot, "README.md"), "# provisioned\n", "utf8")
    await writeFile(
      join(templateRoot, ".agents", "skills", "plugin-skill", "SKILL.md"),
      "---\nname: plugin-skill\n---\n# Provisioned skill\n",
      "utf8",
    )

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [
        {
          id: "provisioning-plugin",
          provisioning: {
            templateDirs: [{ id: "template", path: templateRoot }],
          },
        },
      ],
    })

    try {
      await expect(readFile(join(workspaceRoot, "README.md"), "utf8")).resolves.toBe("# provisioned\n")
      await expect(
        readFile(join(workspaceRoot, ".agents", "skills", "plugin-skill", "SKILL.md"), "utf8"),
      ).resolves.toContain("Provisioned skill")
      await expect(
        readFile(join(workspaceRoot, ".boring-agent", "provisioning.json"), "utf8"),
      ).resolves.toContain("sha256:")
    } finally {
      await app.close()
    }
  })

  test("can skip plugin provisioning when the host opts out", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-provision-skip-")
    const templateRoot = await makeTempDir("boring-workspace-template-skip-")
    await writeFile(join(templateRoot, "README.md"), "# provisioned\n", "utf8")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      plugins: [
        {
          id: "provisioning-plugin",
          provisioning: {
            templateDirs: [{ id: "template", path: templateRoot }],
          },
        },
      ],
    })

    try {
      await expect(readFile(join(workspaceRoot, "README.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await app.close()
    }
  })
})

describe("createWorkspaceAgentServer — plugin model (j9p7.11)", () => {
  test("plugin routes are registered by the composer", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-plugin-routes-")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [
        {
          id: "route-plugin",
          routes: async (instance) => {
            instance.get("/plugin/ping", async () => ({ ok: true }))
          },
        },
      ],
    })
    try {
      const res = await app.inject({ method: "GET", url: "/plugin/ping" })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    } finally {
      await app.close()
    }
  })

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

