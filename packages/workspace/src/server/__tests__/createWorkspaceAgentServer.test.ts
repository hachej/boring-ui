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
import { join, resolve } from "node:path"
import { afterEach, beforeEach, expect, test, describe } from "vitest"
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
const originalUseLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES

beforeEach(() => {
  process.env.BORING_USE_LOCAL_PACKAGES = "1"
})

afterEach(async () => {
  if (originalUseLocalPackages === undefined) delete process.env.BORING_USE_LOCAL_PACKAGES
  else process.env.BORING_USE_LOCAL_PACKAGES = originalUseLocalPackages

  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeRuntimePlugin(root: string, id: string, prompt: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await mkdir(join(root, "server"), { recursive: true })
  await writeFile(join(root, "front", "index.tsx"), `export default definePlugin({ id: ${JSON.stringify(id)} })\n`, "utf8")
  await writeFile(join(root, "server", "index.js"), `export default { id: ${JSON.stringify(id)}, systemPrompt: ${JSON.stringify(prompt)} }\n`, "utf8")
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: id,
    version: "1.0.0",
    boring: { front: "front/index.tsx", server: "server/index.js" },
  }), "utf8")
}

function getProvisionedNodePackage(collection: ReturnType<typeof collectWorkspaceAgentServerPlugins>, id: string) {
  return collection.runtimePlugins
    .flatMap((plugin) => plugin.provisioning?.nodePackages ?? [])
    .find((pkg) => pkg.id === id)
}

describe("createWorkspaceAgentServer — runtime provisioning packages", () => {
  test("uses published boring-ui CLI by default to avoid local-folder symlink installs", () => {
    const previous = process.env.BORING_USE_LOCAL_PACKAGES
    delete process.env.BORING_USE_LOCAL_PACKAGES
    try {
      const cli = getProvisionedNodePackage(collectWorkspaceAgentServerPlugins(), "boring-ui-plugin-cli")
      expect(cli).toMatchObject({
        id: "boring-ui-plugin-cli",
        packageName: "@hachej/boring-ui-plugin-cli",
        expectedBins: ["boring-ui-plugin"],
      })
      // In a monorepo layout the CLI package root resolves locally,
      // so published provisioning omits the version (npm picks latest).
      // Outside a monorepo, the published version is pinned.
      if (cli?.version !== undefined) {
        expect(cli.version).toMatch(/^\d+\.\d+\.\d+/)
      }
      expect(cli).not.toHaveProperty("packageRoot")
    } finally {
      if (previous === undefined) delete process.env.BORING_USE_LOCAL_PACKAGES
      else process.env.BORING_USE_LOCAL_PACKAGES = previous
    }
  })

  test("keeps local CLI package provisioning behind BORING_USE_LOCAL_PACKAGES when a built package exists", () => {
    const previous = process.env.BORING_USE_LOCAL_PACKAGES
    process.env.BORING_USE_LOCAL_PACKAGES = "1"
    try {
      const cli = getProvisionedNodePackage(collectWorkspaceAgentServerPlugins(), "boring-ui-plugin-cli")
      expect(cli).toMatchObject({
        id: "boring-ui-plugin-cli",
        packageName: "@hachej/boring-ui-plugin-cli",
      })
      // Local source installs require built dist/bin.js. Fresh CI checkouts may
      // run workspace tests before plugin-cli is built, so provisioning falls
      // back to the published package instead of installing a broken source dir.
      if (cli?.packageRoot) {
        expect(cli).not.toHaveProperty("version")
      } else {
        expect(cli?.version).toMatch(/^\d+\.\d+\.\d+/)
      }
    } finally {
      if (previous === undefined) delete process.env.BORING_USE_LOCAL_PACKAGES
      else process.env.BORING_USE_LOCAL_PACKAGES = previous
    }
  })
})

describe("createWorkspaceAgentServer — runtime provisioning reload", () => {
  test("/reload recopies plugin skills into .boring-agent/skills", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-runtime-reload-")
    const skillDir = join(workspaceRoot, "plugin-source", "skills", "macro-transform")
    await mkdir(skillDir, { recursive: true })
    const skillFile = join(skillDir, "SKILL.md")
    await writeFile(skillFile, "# Version 1\n")
    const harnessFactory = async () => ({
      id: "test-harness",
      placement: "server" as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: "default", title: "Default", createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: "default", title: "Default", createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      reloadSession: async () => true,
      async *sendMessage() {},
    })

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      harnessFactory,
      plugins: [serverApi.defineServerPlugin({
        id: "boring-macro",
        skills: [{ name: "macro-transform", source: skillDir }],
      })],
    })
    try {
      const mirrored = join(workspaceRoot, ".boring-agent", "skills", "boring-macro", "macro-transform", "SKILL.md")
      await expect(readFile(mirrored, "utf8")).resolves.toBe("# Version 1\n")
      await writeFile(skillFile, "# Version 2\n")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "default" } })
      expect(reload.statusCode).toBe(200)
      await expect(readFile(mirrored, "utf8")).resolves.toBe("# Version 2\n")
    } finally {
      await app.close()
    }
  }, 15_000)
})

describe("createWorkspaceAgentServer — plugin wiring", () => {
  test("registers pre-built plugin routes and tools", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: tmpdir(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      disableDefaultFileTools: true,
      plugins: [serverApi.defineServerPlugin({
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
    expect("createWorkspaceAgentServerBindings" in serverApi).toBe(false)
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
    // Host-level extensionFactories flow through unchanged; plugin-level
    // declaration has been dropped (known limitation: no plugin-level extensionFactories field — hosts thread their own through `pi.extensionFactories`).
    expect(result.agentOptions.pi?.extensionFactories).toEqual([hostFactory])
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
  test("exposes boring-plugin-authoring skill without provisioning boring-pi into node_modules", async () => {
    // The agent should see the built-in plugin-authoring skill via static Pi
    // package resources. Direct-mode runtime provisioning stays slim and does
    // not install built-in authoring packages into .boring-agent/node.
    const workspaceRoot = await makeTempDir("boring-workspace-skill-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })

    try {
      await expect(readFile(
        join(workspaceRoot, ".boring-agent", "node", "node_modules", "@hachej", "boring-pi", "skills", "boring-plugin-authoring", "SKILL.md"),
        "utf8",
      )).rejects.toThrow()

      const res = await app.inject({ method: "GET", url: "/api/v1/agent/skills" })
      expect(res.statusCode).toBe(200)
      const skillNames: string[] = res.json().skills.map((s: { name: string }) => s.name)
      expect(skillNames).toContain("boring-plugin-authoring")
    } finally {
      await app.close()
    }
  }, 15_000)

  test("direct mode skips workspace-local boring-ui plugin CLI provisioning", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-shim-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })

    try {
      const provisionedCli = join(workspaceRoot, ".boring-agent", "node", "node_modules", "@hachej", "boring-ui-plugin-cli")
      await expect(readFile(join(provisionedCli, "package.json"), "utf8")).rejects.toThrow()
      await expect(readFile(join(workspaceRoot, ".boring-agent", "node", "node_modules", ".bin", "boring-ui-plugin"), "utf8")).rejects.toThrow()
    } finally {
      await app.close()
    }
  }, 15_000)

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
  }, 15_000)

  // Issue #200: a workspace-local `.agents/skills/<name>` skill must appear in
  // the slash-command list (the unified /api/v1/agent/commands endpoint), not
  // only in the /skills API — alongside the existing package/global skills.
  test("local .agents/skills skill appears in the slash-command list (#200)", async () => {
    const workspaceRoot = await makeTempDir("boring-local-skill-slash-")
    await mkdir(join(workspaceRoot, ".agents", "skills", "local-test-skill"), { recursive: true })
    await writeFile(
      join(workspaceRoot, ".agents", "skills", "local-test-skill", "SKILL.md"),
      "---\nname: local-test-skill\ndescription: A workspace-local skill for the slash list.\n---\n# Local test skill\n",
      "utf8",
    )

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
    })

    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/agent/commands?sessionId=default" })
      expect(res.statusCode).toBe(200)
      const commands = res.json().commands as Array<{ name: string; source: string }>
      const skillCommands = commands.filter((c) => c.source === "skill").map((c) => c.name)
      // Pi prefixes skill commands with `skill:`. The local skill must be listed
      // and existing package skills must still be present.
      expect(skillCommands).toContain("skill:local-test-skill")
      expect(skillCommands).toContain("skill:boring-plugin-authoring")
    } finally {
      await app.close()
    }
  }, 15_000)

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
        readFile(join(workspaceRoot, ".boring-agent", ".gitignore"), "utf8"),
      ).resolves.toBe("*\n")
    } finally {
      await app.close()
    }
  }, 15_000)

  test("POST /api/v1/agent/reload reloads boring plugin assets before pi reload", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-agent-reload-assets-")
    const pluginRoot = await makeTempDir("boring-workspace-hot-plugin-")
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "hot-plugin" })\n', "utf8")
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
      const before = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(before.json()[0].revision).toBe(1)
      await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "hot-plugin", label: "reloaded" })\n', "utf8")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(200)
      const after = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(after.json()[0].revision).toBe(2)
    } finally {
      await app.close()
    }
  }, 15_000)

  test("POST /api/v1/agent/reload tolerates per-plugin failures (PLUGIN_SYSTEM.md §4.5)", async () => {
    // beforeReload no longer throws on per-plugin scan/rebuild errors.
    // POST /api/v1/agent/reload returns 200 even when an underlying plugin
    // misbehaves; diagnostics flow through SSE + /api/v1/agent-plugins/:id/error.
    const workspaceRoot = await makeTempDir("boring-workspace-agent-reload-tolerate-")
    const pluginRoot = await makeTempDir("boring-workspace-bad-plugin-")
    await mkdir(join(pluginRoot, ".pi", "extensions", "broken"), { recursive: true })
    // Manifest with an unsafe path triggers a preflight error in the asset
    // manager during reload — the agent reload route must still return 200.
    await writeFile(
      join(pluginRoot, ".pi", "extensions", "broken", "package.json"),
      JSON.stringify({ name: "broken", version: "1.0.0", boring: { front: "../escape.tsx" } }),
      "utf8",
    )

    const app = await createWorkspaceAgentServer({
      workspaceRoot: pluginRoot,
      mode: "direct",
      logger: false,
    })

    try {
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  }, 15_000)

  test("POST /api/v1/agent/reload returns diagnostics for malformed plugin rebuilds", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-reload-diagnostics-")
    const pluginRoot = await makeTempDir("boring-workspace-reload-diagnostic-plugin-")
    await writeRuntimePlugin(pluginRoot, "reload-diagnostic-plugin", "OK")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      defaultPluginPackages: [pluginRoot],
    })

    try {
      await writeFile(join(pluginRoot, "package.json"), "{ not json", "utf8")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(200)
      const body = reload.json() as {
        ok: boolean
        diagnostics?: Array<{ source: string; message: string; pluginId?: string }>
      }
      expect(body.ok).toBe(true)
      expect(body.diagnostics?.length).toBeGreaterThan(0)
      expect(body.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: expect.stringContaining("boring plugin asset scan"),
          message: expect.stringMatching(/JSON|package\.json|Unexpected/),
        }),
        expect.objectContaining({
          source: expect.stringContaining(`directory (${pluginRoot})`),
          message: expect.stringContaining("package.json"),
        }),
      ]))
    } finally {
      await app.close()
    }
  }, 15_000)

  test("POST /api/v1/agent/reload returns restart_warnings when a server entry changes", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-reload-warning-")
    const pluginRoot = await makeTempDir("boring-workspace-reload-warning-plugin-")
    await writeRuntimePlugin(pluginRoot, "reload-warning-plugin", "V1")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      defaultPluginPackages: [pluginRoot],
    })

    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(
        join(pluginRoot, "server", "index.js"),
        "export default { id: 'reload-warning-plugin', systemPrompt: 'V2' }\n",
        "utf8",
      )
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", payload: { sessionId: "missing" } })
      expect(reload.statusCode).toBe(200)
      const body = reload.json() as {
        ok: boolean
        restart_warnings?: Array<{ id: string; surfaces: string[]; message: string }>
        diagnostics?: unknown[]
      }
      expect(body.ok).toBe(true)
      // Session "missing" has no live agent session, so the only diagnostic is
      // the "nothing reloaded yet" note.
      expect(body.diagnostics).toEqual([
        { source: "reload", message: "No live agent session to reload yet — changes apply to the next session." },
      ])
      expect(body.restart_warnings).toEqual([
        expect.objectContaining({
          id: "reload-warning-plugin",
          surfaces: ["routes", "agentTools"],
          message: expect.stringContaining("restart"),
        }),
      ])
    } finally {
      await app.close()
    }
  }, 15_000)

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
  }, 15_000)

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
  }, 15_000)

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
  }, 15_000)

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
  test("npm-name resolves, server side loads via default export, asset manager discovers boring.front, plugin appears in /api/v1/agent-plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-default-pkg-")

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      disableDefaultFileTools: true,
      // The fixture package is a dep of @hachej/boring-workspace itself —
      // anchor npm-name resolution there, like a host app passing its root.
      appRoot: resolve(__dirname, "..", "..", ".."),
      // Workspace-local fixture package — proves require.resolve + DirPluginEntry
      // + BoringPluginAssetManager scan all wire together correctly without
      // coupling this workspace test to a real plugin package like ask-user.
      defaultPluginPackages: ["@boring-fixtures/default-plugin"],
    })

    try {
      // Server-side: the package's default-exported WorkspaceServerPlugin
      // ran. Its agentTool "fixture_ping" appears in the agent catalog.
      const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
      expect(catalog.statusCode).toBe(200)
      const toolNames = (catalog.json().tools as Array<{ name: string }>).map((t) => t.name)
      expect(toolNames).toContain("fixture_ping")

      // Front-side discovery: the package appears in /api/v1/agent-plugins
      // with a module-url frontTarget pointing at its boring.front entry.
      // The front-side SSE subscriber would dynamic-import this URL.
      const plugins = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(plugins.statusCode).toBe(200)
      // Plugin id is derived from package.json#name via @scope/name → scope-name
      const list = plugins.json() as Array<{ id: string; frontTarget?: { kind: string; entryUrl: string } }>
      const found = list.find((p) => p.id === "boring-fixtures-default-plugin")
      expect(found, `boring-fixtures-default-plugin not in /api/v1/agent-plugins; got: ${JSON.stringify(list)}`).toBeDefined()
      expect(found?.frontTarget?.kind).toBe("module-url")
      expect(found?.frontTarget?.entryUrl).toMatch(/\/@fs\//)
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
        defaultPluginPackages: ["@boring-fixtures/default-plugin-typo-does-not-exist"],
      }),
    ).rejects.toThrow(/cannot resolve.*default-plugin-typo-does-not-exist/)
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

