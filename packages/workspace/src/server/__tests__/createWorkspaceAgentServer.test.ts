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

describe("createWorkspaceAgentServer — plugin wiring", () => {
  test("registers pre-built plugin routes and tools", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: tmpdir(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      disableDefaultFileTools: true,
      plugins: [appServerApi.defineServerPlugin({
        id: "test-plugin",
        agentTools: [{
          name: "test_tool",
          description: "Test tool",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
        }],
        routes: async (instance) => {
          instance.get("/test-plugin/ping", async () => ({ ok: true }))
        },
      })],
    })
    const route = await app.inject({ method: "GET", url: "/test-plugin/ping" })
    expect(route.statusCode).toBe(200)
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).toContain("test_tool")
    await app.close()
  })

  test("does not register plugin routes or tools unless installed", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: tmpdir(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      disableDefaultFileTools: true,
    })
    const route = await app.inject({ method: "GET", url: "/test-plugin/ping" })
    expect(route.statusCode).toBe(404)
    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.json().tools.map((tool: { name: string }) => tool.name)).not.toContain("test_tool")
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
    const hostFactory = () => undefined
    const pluginFactory = () => undefined
    const result = collectWorkspaceAgentServerPlugins({
      workspaceRoot,
      systemPromptAppend: "Host prompt",
      pi: {
        additionalSkillPaths: ["custom-skills"],
        packages: ["npm:host-pi", { source: "npm:plugin-pi" }],
        extensionPaths: ["/host/agent/index.ts"],
        extensionFactories: [hostFactory],
      },
      plugins: [
        {
          id: "plugin",
          systemPrompt: "Plugin prompt",
          agentTools: [domainTool],
          piPackages: ["npm:plugin-pi"],
          extensionPaths: ["/plugin/agent/index.ts"],
          extensionFactories: [pluginFactory],
        },
      ],
    })

    expect(result.agentOptions.extraTools?.map((tool) => tool.name)).toEqual(["plugin_ping"])
    expect(result.agentOptions.systemPromptAppend).toContain("Host prompt")
    expect(result.agentOptions.systemPromptAppend).toContain("Plugin prompt")
    expect(result.agentOptions.pi?.additionalSkillPaths).toEqual([
      join(workspaceRoot, ".agents", "skills"),
      "custom-skills",
    ])
    expect(result.agentOptions.pi?.packages).toEqual([
      "npm:plugin-pi",
      "npm:host-pi",
    ])
    expect(result.agentOptions.pi?.extensionPaths).toEqual([
      "/plugin/agent/index.ts",
      "/host/agent/index.ts",
    ])
    expect(result.agentOptions.pi?.extensionFactories).toEqual([
      pluginFactory,
      hostFactory,
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
    expect(included.agentOptions.systemPromptAppend).toContain("Default prompt")
    expect(included.agentOptions.systemPromptAppend).toContain("Host prompt")

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
  test("materializes @hachej/boring-workspace package docs inside workspace node_modules", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-package-docs-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })

    try {
      const docs = await readFile(
        join(workspaceRoot, "node_modules", "@hachej", "boring-workspace", "dist", "docs", "plugins.md"),
        "utf8",
      )
      expect(docs).toContain("Boring UI Plugin System")
      expect(docs).toContain("BoringFrontFactory")
      const skill = await readFile(
        join(workspaceRoot, "node_modules", "@hachej", "boring-pi", "skills", "boring-plugin-authoring", "SKILL.md"),
        "utf8",
      )
      expect(skill).toContain("name: boring-plugin-authoring")
      expect(skill).toContain("../../references/workspace/plugins.md")
    } finally {
      await app.close()
    }
  })

  /**
   * Simulates the CLI scenario: a globally-installed boring-ui binary runs
   * in a fresh user workspace with no pre-populated node_modules. The chain
   * we exercise is:
   *
   *   require.resolve("@hachej/boring-pi/package.json")  // CLI process
   *     ↓ provisionRuntime copies skills/ into <workspaceRoot>/node_modules/
   *     ↓ createBoringPiPackageSource emits the package source
   *     ↓ createResourceSettingsManager injects it into Pi's project settings
   *     ↓ Pi indexes package.json#pi.skills
   *     ↓ Pi surfaces the skill via /api/v1/agent/skills
   *
   * If any link breaks (package missing on publish, provisioning skips the
   * skills dir, injection drops the package), the skill goes silent for
   * every CLI user. This test fails loudly before any of that ships.
   */
  test("CLI-like boot in fresh workspace auto-discovers boring-plugin-authoring skill via /api/v1/agent/skills", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-skill-discovery-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })

    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/skills" })
      expect(res.statusCode).toBe(200)
      const skillNames: string[] = res.json().skills.map((s: { name: string }) => s.name)
      expect(skillNames).toContain("boring-plugin-authoring")
    } finally {
      await app.close()
    }
  })

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

  test("POST /api/v1/agent/reload reloads boring plugin assets before pi reload", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-agent-reload-assets-")
    const pluginRoot = await makeTempDir("boring-workspace-hot-plugin-")
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "hot-plugin",
      version: "1.0.0",
      boring: { front: "./front/index.tsx" },
    }), "utf8")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "hot", extensionPaths: [join(pluginRoot, "agent", "index.ts")] }],
    })

    try {
      const before = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(before.json()[0].revision).toBe(1)
      await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() { return undefined }\n", "utf8")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(200)
      const after = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(after.json()[0].revision).toBe(2)
    } finally {
      await app.close()
    }
  })

  test("POST /api/v1/agent/reload returns boring plugin compile errors for agent feedback", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-agent-reload-error-")
    const pluginRoot = await makeTempDir("boring-workspace-bad-plugin-")
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "server"), { recursive: true })
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "server", "index.js"), "export const nope = true\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "bad-plugin",
      version: "1.0.0",
      boring: { front: "./front/index.tsx" },
    }), "utf8")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      plugins: [{ id: "bad", extensionPaths: [join(pluginRoot, "agent", "index.ts")] }],
    })

    try {
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(422)
      expect(reload.json().error).toContain("Boring plugin reload failed")
      expect(reload.json().error).toContain("bad-plugin")
      expect(reload.json().error).toContain("default-export")
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

describe("createWorkspaceAgentServer — defaultPluginPackages (standard load process)", () => {
  test("npm-name resolves, server side loads via default export, asset manager discovers boring.front, plugin appears in /api/agent-plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-default-pkg-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      disableDefaultFileTools: true,
      // The real npm package — proves require.resolve + DirPluginEntry
      // + BoringPluginAssetManager scan all wire together correctly.
      defaultPluginPackages: ["@hachej/boring-ask-user"],
    })

    try {
      // Server-side: the package's default-exported (options, ctx) =>
      // WorkspaceServerPlugin adapter ran. Its agentTool "ask_user"
      // appears in the agent catalog.
      const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(catalog.statusCode).toBe(200)
      const toolNames = (catalog.json().tools as Array<{ name: string }>).map((t) => t.name)
      expect(toolNames).toContain("ask_user")

      // Front-side discovery: the package appears in /api/agent-plugins
      // with a frontUrl pointing at its boring.front entry. The
      // front-side SSE subscriber would dynamic-import this URL.
      const plugins = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(plugins.statusCode).toBe(200)
      // Plugin id is derived from package.json#name via @scope/name → scope-name
      const list = plugins.json() as Array<{ id: string; frontUrl?: string }>
      const found = list.find((p) => p.id === "hachej-boring-ask-user")
      expect(found, `hachej-boring-ask-user not in /api/agent-plugins; got: ${JSON.stringify(list)}`).toBeDefined()
      expect(found?.frontUrl).toMatch(/\/@fs\//)
    } finally {
      await app.close()
    }
  })

  test("throws a clear error on unresolved package name", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-default-pkg-bad-")
    await expect(
      createWorkspaceAgentServer({
        workspaceRoot,
        mode: "direct",
        logger: false,
        provisionWorkspace: false,
        defaultPluginPackages: ["@hachej/boring-ask-user-typo-does-not-exist"],
      }),
    ).rejects.toThrow(/cannot resolve.*ask-user-typo-does-not-exist/)
  })

  test("throws on absolute path that has no package.json", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-default-pkg-empty-")
    const emptyDir = await makeTempDir("boring-empty-")
    await expect(
      createWorkspaceAgentServer({
        workspaceRoot,
        mode: "direct",
        logger: false,
        provisionWorkspace: false,
        defaultPluginPackages: [emptyDir],
      }),
    ).rejects.toThrow(/has no package\.json/)
  })
})

