import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import {
  createAgentHost,
  type AgentFleetCompiler,
  type AgentHostAgentSpec,
  type RuntimeModeAdapter,
} from "@hachej/boring-agent/server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => {
  const createAgentApp = vi.fn(async (_options?: unknown) => ({ register: vi.fn(async () => {}) }))
  let actualCreateAgentHost: ((options: any) => Promise<any>) | undefined
  let actualRegisterAgentRoutes: ((app: any, options: any) => Promise<void>) | undefined
  return {
    createAgentApp,
    createAgentHost: vi.fn(async (options: {
      agents: ReadonlyArray<{ agentTypeId: string; legacyDefault?: boolean; definition?: { label: string } }>
      fleetCompiler: { compile(input: { agents: readonly unknown[] }): Promise<readonly unknown[]> }
    }) => {
      const compiled = await options.fleetCompiler.compile({ agents: options.agents }) as typeof options.agents
      return {
        host: {
          hostId: "workspace-agent-host",
          describe: async () => ({
            hostId: "workspace-agent-host",
            draining: false,
            agents: compiled.map((agent) => ({
              agentTypeId: agent.agentTypeId,
              label: agent.legacyDefault ? "Agent" : agent.definition?.label ?? agent.agentTypeId,
            })),
          }),
          drain: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
        },
        gateway: {},
        registerRoutes: vi.fn(),
      }
    }),
    registerAgentRoutes: vi.fn(async (_app: unknown, options: unknown) => {
      await createAgentApp(options)
    }),
    provisionRuntimeWorkspace: vi.fn(async () => {}),
    provisionWorkspaceRuntime: vi.fn(async () => undefined),
    captureActuals(input: {
      createAgentHost: (options: any) => Promise<any>
      registerAgentRoutes: (app: any, options: any) => Promise<void>
    }) {
      actualCreateAgentHost = input.createAgentHost
      actualRegisterAgentRoutes = input.registerAgentRoutes
    },
    createActualAgentHost(options: any) {
      if (!actualCreateAgentHost) throw new Error("actual createAgentHost was not captured")
      return actualCreateAgentHost(options)
    },
    registerActualAgentRoutes(app: any, options: any) {
      if (!actualRegisterAgentRoutes) throw new Error("actual registerAgentRoutes was not captured")
      return actualRegisterAgentRoutes(app, options)
    },
  }
})

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  agentServerMock.captureActuals({
    createAgentHost: actual.createAgentHost,
    registerAgentRoutes: actual.registerAgentRoutes,
  })
  return {
    ...actual,
    createAgentApp: agentServerMock.createAgentApp,
    createAgentHost: agentServerMock.createAgentHost,
    registerAgentRoutes: agentServerMock.registerAgentRoutes,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

import {
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  projectAgentSpecPluginArtifacts,
  readWorkspacePluginPackagePiSnapshot,
  resolveWorkspaceAgentServerPluginCollection,
} from "../createWorkspaceAgentServer"
import { resolveDefaultWorkspacePluginPackagePaths } from "../defaultPluginPackages"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.createAgentApp.mockClear()
  agentServerMock.createAgentHost.mockClear()
  agentServerMock.registerAgentRoutes.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
})

function mockCreateAgentAppOnce(factory: (opts?: unknown) => Promise<unknown>): void {
  agentServerMock.createAgentApp.mockImplementationOnce(factory as never)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeHotPlugin(root: string, extension: string): Promise<void> {
  const pluginRoot = join(root, ".pi", "extensions", "hot-plugin")
  await mkdir(join(pluginRoot, "front"), { recursive: true })
  await mkdir(join(pluginRoot, "agent", "skills"), { recursive: true })
  await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "hot-plugin" })\n', "utf8")
  await writeFile(join(pluginRoot, "agent", extension), "export default function() {}\n", "utf8")
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
    name: "hot-plugin",
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
    pi: { extensions: [`agent/${extension}`], skills: ["agent/skills"] },
  }), "utf8")
}

describe("Workspace public admission composition", () => {
  test("adapts admitEffect for Gateway mutations while legacy routes admit exactly once", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-public-admission-")
    const events: string[] = []
    const sessions = new Map<string, {
      id: string
      title: string
      createdAt: string
      updatedAt: string
      turnCount: number
    }>()
    let rejectRequestId: string | undefined
    const admitEffect = vi.fn(async ({ workspaceId, requestId }: { workspaceId?: string; requestId: string }) => {
      events.push(`admit:${workspaceId}:${requestId}`)
      if (requestId === rejectRequestId) throw new Error("WORKSPACE_ADMISSION_REJECTED")
    })
    const harnessFactory = async () => ({
      id: "workspace-public-admission-harness",
      placement: "server" as const,
      sessions: {
        async list() { return [...sessions.values()] },
        async create(_ctx: unknown, init?: { title?: string }) {
          events.push("mutate:session.create")
          const id = `session-${sessions.size + 1}`
          const now = new Date().toISOString()
          const session = { id, title: init?.title ?? "Untitled", createdAt: now, updatedAt: now, turnCount: 0 }
          sessions.set(id, session)
          return session
        },
        async load(_ctx: unknown, sessionId: string) {
          const session = sessions.get(sessionId)
          if (!session) throw new Error("session not found")
          return { ...session, messages: [] }
        },
        async delete(_ctx: unknown, sessionId: string) { sessions.delete(sessionId) },
      },
      async reloadSession() { events.push("mutate:reload"); return true },
      async getSlashCommands() { return [{ name: "plan", source: "prompt" as const }] },
      async executeSlashCommand() { events.push("mutate:command") },
      async *sendMessage() {},
    })

    agentServerMock.createAgentHost.mockImplementationOnce((options) => agentServerMock.createActualAgentHost(options))
    agentServerMock.registerAgentRoutes.mockImplementationOnce((app, options) => (
      agentServerMock.registerActualAgentRoutes(app, options)
    ))
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      harnessFactory,
      admitEffect,
    })

    try {
      const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
        effectAdmission?: { admit(input: unknown): Promise<unknown> }
      }]
      const [, routeOptions] = agentServerMock.registerAgentRoutes.mock.calls.at(-1) as unknown as [unknown, {
        admitEffect?: unknown
      }]
      expect(hostOptions.effectAdmission).toBeDefined()
      expect(routeOptions.admitEffect).toBe(admitEffect)

      const gateway = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/sessions",
        payload: { requestId: "gateway-create", title: "Admitted" },
      })
      expect(gateway.statusCode).toBe(201)
      expect(events.slice(0, 2)).toEqual([
        "admit:default:gateway-create",
        "mutate:session.create",
      ])
      expect(admitEffect).toHaveBeenCalledTimes(1)

      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload" })
      expect(reload.statusCode).toBe(200)
      expect(admitEffect).toHaveBeenCalledTimes(2)

      const command = await app.inject({
        method: "POST",
        url: "/api/v1/agent/commands/execute",
        payload: { name: "plan" },
      })
      expect(command.statusCode).toBe(200)
      expect(admitEffect).toHaveBeenCalledTimes(3)
      expect(events).toContain("mutate:command")

      rejectRequestId = "gateway-rejected"
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/sessions",
        payload: { requestId: rejectRequestId, title: "Rejected" },
      })
      expect(rejected.statusCode).toBe(500)
      expect(rejected.json()).toMatchObject({ message: "WORKSPACE_ADMISSION_REJECTED" })
      expect(admitEffect).toHaveBeenCalledTimes(4)
      expect(events.filter((event) => event === "mutate:session.create")).toHaveLength(1)
    } finally {
      await app.close()
    }
  })
})

describe("workspace app-server plugin package helpers", () => {
  test("resolve defaults from app package manifest and read static Pi package resources", async () => {
    const appRoot = await makeTempDir("boring-app-helper-default-package-")
    const manifestPluginRoot = join(appRoot, "plugins", "manifest-plugin")
    const explicitPluginRoot = join(appRoot, "plugins", "explicit-plugin")
    await mkdir(join(manifestPluginRoot, "skills"), { recursive: true })
    await mkdir(join(explicitPluginRoot, "agent"), { recursive: true })
    await writeFile(join(manifestPluginRoot, "package.json"), JSON.stringify({
      name: "manifest-plugin",
      pi: { skills: ["skills"], packages: ["npm:manifest-pi"] },
    }), "utf8")
    await writeFile(join(explicitPluginRoot, "package.json"), JSON.stringify({
      name: "explicit-plugin",
      pi: { extensions: ["agent/index.ts"] },
    }), "utf8")
    await writeFile(join(explicitPluginRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    const paths = resolveDefaultWorkspacePluginPackagePaths({
      workspaceRoot: appRoot,
      defaultPluginPackages: [manifestPluginRoot, explicitPluginRoot],
    })
    expect(paths).toEqual([manifestPluginRoot, explicitPluginRoot])

    const snapshot = readWorkspacePluginPackagePiSnapshot(paths)
    expect(snapshot.additionalSkillPaths).toContain(join(manifestPluginRoot, "skills"))
    expect(snapshot.packages).toContain("npm:manifest-pi")
    expect(snapshot.extensionPaths).toContain(join(explicitPluginRoot, "agent", "index.ts"))
  })

  test("Pi snapshot converts single-skill package paths into loader roots", async () => {
    const appRoot = await makeTempDir("boring-app-helper-single-skill-package-")
    const pluginRoot = join(appRoot, "plugins", "deck")
    await mkdir(join(pluginRoot, "skills", "deck-authoring"), { recursive: true })
    await writeFile(join(pluginRoot, "skills", "deck-authoring", "SKILL.md"), "# deck-authoring\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "deck",
      pi: { skills: ["skills/deck-authoring"] },
    }), "utf8")

    const snapshot = readWorkspacePluginPackagePiSnapshot([pluginRoot])

    expect(snapshot.additionalSkillPaths).toContain(join(pluginRoot, "skills"))
    expect(snapshot.additionalSkillPaths).not.toContain(join(pluginRoot, "skills", "deck-authoring"))
  })

  test("Pi snapshot keeps valid plugin resources when another plugin has preflight errors", async () => {
    const workspaceRoot = await makeTempDir("boring-pi-snapshot-partial-")
    const validRoot = join(workspaceRoot, "valid")
    const invalidRoot = join(workspaceRoot, "invalid")
    await mkdir(join(validRoot, "skills"), { recursive: true })
    await mkdir(join(validRoot, "agent"), { recursive: true })
    await writeFile(join(validRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(validRoot, "package.json"), JSON.stringify({
      name: "valid-snapshot-plugin",
      pi: {
        systemPrompt: "VALID_SNAPSHOT_PROMPT",
        skills: ["skills"],
        extensions: ["agent/index.ts"],
        packages: ["npm:valid-snapshot-pi"],
      },
    }), "utf8")
    await mkdir(invalidRoot, { recursive: true })
    await writeFile(join(invalidRoot, "package.json"), JSON.stringify({
      name: "invalid-snapshot-plugin",
      boring: { front: "front/missing.tsx" },
    }), "utf8")

    const snapshot = readWorkspacePluginPackagePiSnapshot([validRoot, invalidRoot])
    expect(snapshot.additionalSkillPaths).toContain(join(validRoot, "skills"))
    expect(snapshot.extensionPaths).toContain(join(validRoot, "agent", "index.ts"))
    expect(snapshot.packages).toContain("npm:valid-snapshot-pi")
    expect(snapshot.systemPromptAppend).toContain("VALID_SNAPSHOT_PROMPT")
  })
})

describe("default boring-ui CLI provisioning", () => {
  function findBoringUiCliContribution(contributions: Array<{ id: string; provisioning?: { nodePackages?: unknown[] } }>) {
    return contributions.find((entry) => entry.id === "boring-ui-plugin-cli-package")
  }

  test("collector exposes the CLI package through default/exclude mechanisms", async () => {
    const included = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-"),
      installPluginAuthoring: true,
    })
    const cli = findBoringUiCliContribution(included.provisioningContributions)
    expect(cli?.provisioning?.nodePackages).toContainEqual(expect.objectContaining({
      id: "boring-ui-plugin-cli",
      packageName: "@hachej/boring-ui-plugin-cli",
      expectedBins: ["boring-ui-plugin"],
    }))

    const excluded = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-excluded-"),
      excludeDefaults: ["boring-ui-plugin-cli-package"],
      installPluginAuthoring: true,
    })
    expect(findBoringUiCliContribution(excluded.provisioningContributions)).toBeUndefined()

    const disabled = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-disabled-"),
      installPluginAuthoring: false,
    })
    expect(findBoringUiCliContribution(disabled.provisioningContributions)).toBeUndefined()
  })

  test.each([
    { mode: "direct" as const, installPluginAuthoring: undefined, shouldProvisionCli: false, shouldPrompt: true },
    { mode: "local" as const, installPluginAuthoring: undefined, shouldProvisionCli: true, shouldPrompt: true },
    { mode: "local" as const, installPluginAuthoring: false, shouldProvisionCli: false, shouldPrompt: false },
  ])(
    "mode $mode handles default plugin CLI provisioning and prompt commands",
    async ({ mode, installPluginAuthoring, shouldProvisionCli, shouldPrompt }) => {
      const workspaceRoot = await makeTempDir(`boring-cli-${mode}-`)
      let capturedPrompt: string | undefined
      mockCreateAgentAppOnce(async (opts: unknown) => {
        const agentOpts = opts as {
          workspaceRoot: string
          systemPromptAppend?: string
          runtimeProvisioner?: (ctx: unknown) => Promise<void>
        }
        capturedPrompt = agentOpts.systemPromptAppend
        await agentOpts.runtimeProvisioner?.({
          workspaceRoot: agentOpts.workspaceRoot,
          runtimeMode: mode,
          runtimeBundle: {
            storageRoot: agentOpts.workspaceRoot,
            runtimeContext: { runtimeCwd: mode === "direct" ? agentOpts.workspaceRoot : "/workspace" },
            workspace: {},
            sandbox: {},
          },
        })
        return { register: vi.fn(async () => {}) } as never
      })

      await createWorkspaceAgentServer({
        workspaceRoot,
        mode,
        logger: false,
        ...(installPluginAuthoring === undefined ? {} : { installPluginAuthoring }),
      })

      expect(agentServerMock.provisionWorkspaceRuntime).toHaveBeenCalledTimes(1)
      const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
        { plugins: Array<{ id: string; provisioning?: { nodePackages?: unknown[] } }> },
      ]
      const cli = findBoringUiCliContribution(provisionOpts.plugins)
      if (shouldProvisionCli) {
        expect(cli?.provisioning?.nodePackages).toContainEqual(expect.objectContaining({
          id: "boring-ui-plugin-cli",
          packageName: "@hachej/boring-ui-plugin-cli",
          expectedBins: ["boring-ui-plugin"],
        }))
      } else {
        expect(cli).toBeUndefined()
      }
      if (shouldPrompt) {
        expect(capturedPrompt).toContain("boring-ui-plugin scaffold")
        expect(capturedPrompt).toContain("boring-ui-plugin verify")
      } else {
        expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
        expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
      }
    },
  )

  test("externalPlugins=false removes plugin CLI provisioning and prompt commands", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-external-disabled-")
    let capturedPrompt: string | undefined
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const agentOpts = opts as { externalPlugins?: boolean; systemPromptAppend?: string }
      expect(agentOpts.externalPlugins).toBe(false)
      capturedPrompt = agentOpts.systemPromptAppend
      return { register: vi.fn(async () => {}) } as never
    })

    await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "local",
      logger: false,
      externalPlugins: false,
    })

    const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
      { plugins: Array<{ id: string }> },
    ]
    expect(findBoringUiCliContribution(provisionOpts.plugins)).toBeUndefined()
    expect(capturedPrompt ?? "").toContain("does not expose Boring plugin creation or installation")
    expect(capturedPrompt ?? "").not.toContain("Generated plugin skills")
    expect(capturedPrompt ?? "").not.toContain("external plugin authoring")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
    expect(capturedPrompt ?? "").not.toContain("boring-plugin-authoring")
  })

  test("excludeDefaults removes built-in plugin CLI provisioning and prompt commands", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-exclude-runtime-")
    let capturedPrompt: string | undefined
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const agentOpts = opts as { systemPromptAppend?: string }
      capturedPrompt = agentOpts.systemPromptAppend
      return { register: vi.fn(async () => {}) } as never
    })

    await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      excludeDefaults: ["boring-ui-plugin-cli-package"],
    })

    const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
      { plugins: Array<{ id: string }> },
    ]
    expect(findBoringUiCliContribution(provisionOpts.plugins)).toBeUndefined()
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
  })
})

describe("createWorkspaceAgentServer plugin runtime options", () => {
  test("getHotReloadableResources reflects current package.json#pi entries", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-package-pi-reload-")
    await writeHotPlugin(workspaceRoot, "one.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        beforeReload?: () => Promise<void>
        pi?: {
          extensionPaths?: string[]
          additionalSkillPaths?: string[]
          getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] }
        }
      },
    ]
    // Static fields hold only host/workspace contributions, not package.json discoveries.
    expect(agentOptions.pi?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    // Dynamic getter holds the package.json-discovered values; Pi merges them.
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )

    await writeHotPlugin(workspaceRoot, "two.ts")
    await agentOptions.beforeReload?.()

    const refreshed = agentOptions.pi?.getHotReloadableResources?.()
    expect(refreshed?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    expect(refreshed?.extensionPaths).toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "two.ts"))
  })

  test("externalPlugins=true keeps workspace .pi plugins hot-reloadable", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-external-enabled-")
    await writeHotPlugin(workspaceRoot, "visible.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: true,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        externalPlugins?: boolean
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
    expect(agentOptions.externalPlugins).toBe(true)
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "visible.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )
  })

  test("externalPlugins=false excludes workspace .pi plugins from hot-reloadable resources", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-external-disabled-")
    await writeHotPlugin(workspaceRoot, "hidden.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        externalPlugins?: boolean
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
    expect(agentOptions.externalPlugins).toBe(false)
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths ?? []).not.toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "hidden.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths ?? []).not.toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )
  })

  test("does not crash while collecting Pi entries from invalid package.json plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-invalid-package-pi-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "invalid-plugin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), "{ not json", "utf8")

    await expect(createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })).resolves.toBeTruthy()

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { extensionPaths?: string[]; additionalSkillPaths?: string[]; packages?: unknown[] } },
    ]
    expect(agentOptions.pi?.extensionPaths).not.toContain(join(pluginRoot, "agent", "index.ts"))
    expect(agentOptions.pi?.additionalSkillPaths).not.toContain(join(pluginRoot, "agent", "skills"))
    expect(agentOptions.pi?.packages).toContainEqual(expect.objectContaining({
      skills: ["skills/boring-plugin-authoring"],
    }))
  })

  test("normalizes package.json Pi packages relative to the plugin root", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-package-pi-root-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "package-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "package-plugin" })\n', "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "package-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: {
        packages: [
          "file:.",
          { source: "./agent", extensions: ["index.ts"] },
          "npm:remote-plugin",
        ],
      },
    }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { packages?: unknown[]; getHotReloadableResources?: () => { packages?: unknown[] } } },
    ]
    // pi.packages is the STATIC set: bundled @hachej/boring-pi skill +
    // host-supplied + factory-plugin entries. The bundled skill is added
    // when @hachej/boring-pi is resolvable from the workspace.
    expect(agentOptions.pi?.packages ?? []).toContainEqual(
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    )
    // The package.json#pi.packages discovered for the test plugin live in
    // getHotReloadableResources() so hot reload can re-read them.
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual([
      join(pluginRoot),
      { source: join(pluginRoot, "agent"), extensions: ["index.ts"] },
      "npm:remote-plugin",
    ])
  })

  test("forwards plugin Pi packages to the agent runtime", async () => {
    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/workspace-pi-forwarding",
      logger: false,
      provisionWorkspace: false,
      pi: {
        packages: [
          "npm:host-pi",
          {
            source: "npm:plugin-pi",
            extensions: ["./b.ts", "./a.ts"],
          },
        ],
      },
      plugins: [
        {
          id: "plugin-pi",
          contentDigest: "plugin-pi-content-v1",
          piPackages: [
            {
              source: "npm:plugin-pi",
              extensions: ["./a.ts", "./b.ts"],
            },
          ],
        },
      ],
    })

    expect(agentServerMock.createAgentApp).toHaveBeenCalledTimes(1)
    const [agentOptions] = agentServerMock.createAgentApp.mock
      .calls[0] as unknown as [
      { pi?: { packages?: unknown[] } },
    ]
    // Static set: bundled @hachej/boring-pi skill (when resolvable) +
    // factory-plugin contributions + host-supplied entries.
    expect(agentOptions.pi?.packages).toContainEqual(
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    )
    expect(agentOptions.pi?.packages).toContainEqual({
      source: "npm:plugin-pi",
      extensions: ["./a.ts", "./b.ts"],
    })
    expect(agentOptions.pi?.packages).toContain("npm:host-pi")
  })

  test("getHotReloadableResources reflects package.json#pi changes between calls", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-pi-dynamic-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "dyn-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "dyn-plugin" })\n', "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "dyn-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { packages: ["npm:initial"] },
    }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { getHotReloadableResources?: () => { packages?: unknown[] } } },
    ]
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual(["npm:initial"])

    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "dyn-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { packages: ["npm:updated"] },
    }), "utf8")
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual(["npm:updated"])
  })

  test("plugins[] accepts pre-built objects", async () => {
    const builtPlugin = { id: "built", contentDigest: "built-content-v1", systemPrompt: "BUILT" }

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase0-mixed-entries",
      logger: false,
      provisionWorkspace: false,
      plugins: [builtPlugin],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("BUILT")
  })

  test("fails closed when a prebuilt Agent-contributing plugin has no content digest", async () => {
    await expect(createWorkspaceAgentServer({
      workspaceRoot: "/tmp/prebuilt-missing-identity",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ id: "missing-digest", systemPrompt: "opaque prebuilt contribution" }],
    })).rejects.toMatchObject({ code: "BORING_AGENT_RUNTIME_IDENTITY_INCOMPLETE" })
  })

  test("defaultPluginPackages discovers front/Pi-only packages without server import", async () => {
    const appRoot = await makeTempDir("boring-app-default-package-")
    const pluginRoot = join(appRoot, "plugins", "foo")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "skills"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "foo" })\n', "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "foo",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { systemPrompt: "FOO_PLUGIN_PROMPT", skills: ["skills"] },
    }), "utf8")
    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      defaultPluginPackages: [pluginRoot],
      logger: false,
      provisionWorkspace: false,
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "foo",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          pi: expect.objectContaining({ systemPrompt: "FOO_PLUGIN_PROMPT" }),
        }),
      ])

      const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
          systemPromptAppend?: string
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "skills"))
      expect(agentOptions.systemPromptDynamic?.()).toContain("FOO_PLUGIN_PROMPT")
      expect(agentOptions.systemPromptAppend).not.toContain("FOO_PLUGIN_PROMPT")
    } finally {
      await app.close()
    }
  })

  test("workspace and configured agent-spec activation share one canonical artifact and load lifecycle", async () => {
    const workspaceRoot = await makeTempDir("boring-one-machinery-workspace-")
    const pluginRoot = join(workspaceRoot, "plugins", "one-machinery")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "server"), { recursive: true })
    await writeFile(
      join(pluginRoot, "front", "index.tsx"),
      'import { definePlugin } from "@hachej/boring-workspace/plugin"\nexport default definePlugin({ id: "one-machinery" })\n',
      "utf8",
    )
    await writeFile(
      join(pluginRoot, "server", "index.mjs"),
      `globalThis.__boringOneMachineryLoads = (globalThis.__boringOneMachineryLoads ?? 0) + 1\nconst routes = async () => {}\nexport default { id: "one-machinery", routes, preservedUiStateKeys: ["workspace-state"], systemPrompt: "ONE_MACHINERY_AGENT" }\n`,
      "utf8",
    )
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "legacy-package-name",
      version: "1.0.0",
      boring: { id: "one-machinery", front: "front/index.tsx", server: "server/index.mjs" },
    }), "utf8")

    ;(globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads = 0
    const collection = await resolveWorkspaceAgentServerPluginCollection({
      workspaceRoot,
      bridge: {} as never,
      installPluginAuthoring: false,
      defaultPluginPackages: [pluginRoot],
      // The duplicate declaration is intentionally deduped before the sole
      // resolver entry module imports the package.
      plugins: [{ dir: pluginRoot, hotReload: true }],
    })
    const configuredAgent = {
      agentTypeId: "macro",
      definition: { label: "Macro", instructions: "Run the macro." },
      plugins: [{ name: "one-machinery", config: { mode: "review" } }],
    } as const satisfies AgentHostAgentSpec
    let compiledProjection: ReturnType<typeof projectAgentSpecPluginArtifacts> | undefined
    const fleetCompiler: AgentFleetCompiler = {
      compile: vi.fn(async ({ agents }) => agents.map((agent: AgentHostAgentSpec) => {
        const projection = projectAgentSpecPluginArtifacts(agent, collection.resolvedPluginArtifacts)
        compiledProjection = projection
        return {
          ...agent,
          resolvedPolicy: { pluginIds: projection.artifacts.map((artifact) => artifact.id) },
        }
      })),
    }
    const modeAdapter = {
      id: "direct",
      workspaceFsCapability: "strong",
      async create() { throw new Error("runtime must stay lazy in this proof") },
    } as RuntimeModeAdapter
    const host = await createAgentHost({
      agents: [configuredAgent],
      fleetCompiler,
      hostId: "one-machinery-host",
      scopeVerifier: { async verify() { return { workspaceScopeId: "workspace", authSubjectId: "subject" } } },
      runtimeModeAdapter: modeAdapter,
      sessionRoot: join(workspaceRoot, "sessions"),
      async resolveRuntimeScope() { throw new Error("runtime must stay lazy in this proof") },
    })

    try {
      expect(fleetCompiler.compile).toHaveBeenCalledOnce()
      expect(collection.resolvedPluginArtifacts).toHaveLength(1)
      expect(collection.resolvedPluginArtifacts[0]).toMatchObject({ id: "one-machinery" })
      expect(collection.resolvedPluginArtifacts[0].entry).toMatchObject({ dir: pluginRoot })
      expect((globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads).toBe(1)

      // Workspace activation takes only Workspace-site contributions from the
      // same imported plugin object retained by the artifact record.
      expect(collection.routeContributions).toEqual([
        expect.objectContaining({
          id: "one-machinery",
          routes: collection.resolvedPluginArtifacts[0].plugin.routes,
        }),
      ])
      expect(collection.preservedUiStateKeys).toEqual(["workspace-state"])

      // Fleet compilation selects the canonical ID and projects only Agent-site
      // contributions without resolving or loading the package again.
      expect(compiledProjection?.artifacts).toEqual([collection.resolvedPluginArtifacts[0]])
      expect(compiledProjection?.agentOptions.systemPromptAppend).toBe("ONE_MACHINERY_AGENT")
      expect(compiledProjection).not.toHaveProperty("routeContributions")
      expect((await host.host.describe()).agents).toEqual([{ agentTypeId: "macro", label: "Macro" }])
      expect((globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads).toBe(1)
    } finally {
      await host.host.close()
      delete (globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads
    }
  })

  test("normalizes selected Agent plugin contributions without cross-Agent bleed", async () => {
    const workspaceRoot = await makeTempDir("boring-agent-plugin-scope-")
    const alphaTool = {
      name: "alpha_tool",
      description: "alpha only",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [] } },
    }
    const betaTool = {
      name: "beta_tool",
      description: "beta only",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [] } },
    }
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      plugins: [
        {
          id: "alpha-plugin",
          contentDigest: "alpha-plugin-content-v1",
          agentTools: [alphaTool],
          systemPrompt: "ALPHA_PLUGIN_PROMPT",
          piPackages: ["npm:alpha-pi"],
          extensionPaths: ["/plugins/alpha.ts"],
        },
        {
          id: "beta-plugin",
          contentDigest: "beta-plugin-content-v1",
          agentTools: [betaTool],
          systemPrompt: "BETA_PLUGIN_PROMPT",
          piPackages: ["npm:beta-pi"],
          extensionPaths: ["/plugins/beta.ts"],
        },
      ],
      agents: [
        {
          agentTypeId: "alpha",
          definition: { label: "Alpha", instructions: "alpha" },
          plugins: [{ name: "alpha-plugin", config: { mode: "alpha" } }],
        },
        {
          agentTypeId: "beta",
          definition: { label: "Beta", instructions: "beta" },
          plugins: [{ name: "beta-plugin", config: { mode: "beta" } }],
        },
        { agentTypeId: "default", legacyDefault: true },
      ],
      fleetCompiler: { async compile({ agents }) { return agents } },
      defaultAgentTypeId: "alpha",
    })

    try {
      const [routeOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
        agentHost: { issueScope(input: { claim: object; runtimeScope: object }): object }
        extraTools?: Array<{ name: string }>
        systemPromptAppend?: string
        pi?: { packages?: unknown[]; extensionPaths?: string[] }
      }]
      expect(routeOptions.extraTools?.map((tool) => tool.name)).not.toContain("alpha_tool")
      expect(routeOptions.extraTools?.map((tool) => tool.name)).not.toContain("beta_tool")
      expect(routeOptions.systemPromptAppend).not.toContain("ALPHA_PLUGIN_PROMPT")
      expect(routeOptions.systemPromptAppend).not.toContain("BETA_PLUGIN_PROMPT")
      expect(routeOptions.pi?.packages).not.toContain("npm:alpha-pi")
      expect(routeOptions.pi?.packages).not.toContain("npm:beta-pi")

      const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
        resolveRuntimeScope(input: { agentTypeId: string; scope: object }): Promise<{
          identity: string
          extraTools?: Array<{ name: string }>
          systemPromptAppend?: string
          pi?: { packages?: unknown[]; extensionPaths?: string[] }
        }>
      }]
      const runtimeScope = {
        identity: "base-runtime",
        environment: {
          placementIdentity: "base-placement",
          workspaceRoot,
          provisioningFingerprint: "base-provisioning",
        },
        sessionNamespace: "",
        pi: routeOptions.pi,
        extraTools: routeOptions.extraTools,
        systemPromptAppend: routeOptions.systemPromptAppend,
      }
      const scope = routeOptions.agentHost.issueScope({
        claim: { workspaceScopeId: "default", authSubjectId: "subject" },
        runtimeScope,
      })
      const [alpha, beta, legacy] = await Promise.all([
        hostOptions.resolveRuntimeScope({ agentTypeId: "alpha", scope }),
        hostOptions.resolveRuntimeScope({ agentTypeId: "beta", scope }),
        hostOptions.resolveRuntimeScope({ agentTypeId: "default", scope }),
      ])

      expect(alpha.extraTools?.map((tool) => tool.name)).toContain("alpha_tool")
      expect(alpha.extraTools?.map((tool) => tool.name)).not.toContain("beta_tool")
      expect(alpha.systemPromptAppend).toContain("ALPHA_PLUGIN_PROMPT")
      expect(alpha.systemPromptAppend).not.toContain("BETA_PLUGIN_PROMPT")
      expect(alpha.pi?.packages).toContain("npm:alpha-pi")
      expect(alpha.pi?.packages).not.toContain("npm:beta-pi")
      expect(alpha.pi?.extensionPaths).toEqual(expect.arrayContaining(["/plugins/alpha.ts"]))
      expect(alpha.pi?.extensionPaths).not.toContain("/plugins/beta.ts")
      expect(alpha.identity).toMatch(/^[a-f0-9]{64}$/)

      expect(beta.extraTools?.map((tool) => tool.name)).toContain("beta_tool")
      expect(beta.extraTools?.map((tool) => tool.name)).not.toContain("alpha_tool")
      expect(beta.systemPromptAppend).toContain("BETA_PLUGIN_PROMPT")
      expect(beta.systemPromptAppend).not.toContain("ALPHA_PLUGIN_PROMPT")
      expect(beta.pi?.packages).toContain("npm:beta-pi")
      expect(beta.pi?.packages).not.toContain("npm:alpha-pi")
      expect(beta.identity).toMatch(/^[a-f0-9]{64}$/)
      expect(beta.identity).not.toBe(alpha.identity)

      expect(legacy.extraTools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["alpha_tool", "beta_tool"]))
      expect(legacy.systemPromptAppend).toContain("ALPHA_PLUGIN_PROMPT")
      expect(legacy.systemPromptAppend).toContain("BETA_PLUGIN_PROMPT")
      expect(legacy.pi?.packages).toEqual(expect.arrayContaining(["npm:alpha-pi", "npm:beta-pi"]))
    } finally {
      await app.close()
    }
  })

  test("runtime contribution identity is stable and covers compiler policy plus selected contribution contracts", async () => {
    async function resolveIdentity(input: {
      policyRevision: string
      prompt: string
      toolDescription: string
      piPackage?: string
      artifactDigest?: string
      placementIdentity?: string
      provisioningGeneration?: string
      includePolicyDigest?: boolean
    }): Promise<string> {
      const workspaceRoot = await makeTempDir("boring-agent-runtime-identity-")
      const app = await createWorkspaceAgentServer({
        workspaceRoot,
        logger: false,
        provisionWorkspace: false,
        externalPlugins: false,
        plugins: [{
          id: "identity-plugin",
          contentDigest: input.artifactDigest ?? JSON.stringify({
            prompt: input.prompt,
            toolDescription: input.toolDescription,
            piPackage: input.piPackage ?? "npm:identity-pi",
          }),
          systemPrompt: input.prompt,
          piPackages: [input.piPackage ?? "npm:identity-pi"],
          extensionPaths: ["/plugins/identity.ts"],
          skills: [{ name: "identity-skill", source: "/plugins/identity-skill" }],
          agentTools: [{
            name: "identity_tool",
            description: input.toolDescription,
            parameters: { type: "object", properties: { value: { type: "string" } } },
            async execute() { return { content: [] } },
          }],
        }],
        agents: [{
          agentTypeId: "identity-agent",
          definition: { label: "Identity", instructions: "identity" },
          plugins: [{ name: "identity-plugin", config: { mode: "fixed" } }],
        }],
        defaultAgentTypeId: "identity-agent",
        fleetCompiler: {
          async compile({ agents }) {
            return agents.map((agent) => ({
              ...agent,
              resolvedPolicy: { executableHandle: () => input.policyRevision },
              ...(input.includePolicyDigest === false ? {} : { resolvedPolicyDigest: input.policyRevision }),
            }))
          },
        },
      })
      try {
        const [routeOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [{
          agentHost: { issueScope(input: { claim: object; runtimeScope: object }): object }
          pi?: object
          extraTools?: unknown[]
          systemPromptAppend?: string
        }]
        const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
          resolveRuntimeScope(input: { agentTypeId: string; scope: object }): Promise<{ identity: string }>
        }]
        const scope = routeOptions.agentHost.issueScope({
          claim: { workspaceScopeId: "default", authSubjectId: "subject" },
          runtimeScope: {
            identity: "fixed-base-placement-and-provisioning",
            environment: {
              placementIdentity: input.placementIdentity ?? "fixed-placement",
              workspaceRoot,
              provisioningFingerprint: input.provisioningGeneration ?? "fixed-provisioning",
            },
            sessionNamespace: "",
            pi: routeOptions.pi,
            extraTools: routeOptions.extraTools,
            systemPromptAppend: routeOptions.systemPromptAppend,
          },
        })
        return (await hostOptions.resolveRuntimeScope({ agentTypeId: "identity-agent", scope })).identity
      } finally {
        await app.close()
      }
    }

    const fixed = {
      policyRevision: "policy-a",
      prompt: "IDENTITY_PROMPT_A",
      toolDescription: "identity tool a",
      piPackage: "npm:identity-a",
    }
    const stableOne = await resolveIdentity(fixed)
    const stableTwo = await resolveIdentity(fixed)
    const policyChanged = await resolveIdentity({ ...fixed, policyRevision: "policy-b" })
    const promptChanged = await resolveIdentity({ ...fixed, prompt: "IDENTITY_PROMPT_B" })
    const toolChanged = await resolveIdentity({ ...fixed, toolDescription: "identity tool b" })
    const piChanged = await resolveIdentity({ ...fixed, piPackage: "npm:identity-b" })
    const artifactBytesChanged = await resolveIdentity({ ...fixed, artifactDigest: "artifact-bytes-b" })
    const placementChanged = await resolveIdentity({ ...fixed, placementIdentity: "sandbox-placement" })
    const provisioningChanged = await resolveIdentity({ ...fixed, provisioningGeneration: "generation-b" })
    await expect(resolveIdentity({ ...fixed, includePolicyDigest: false })).rejects.toMatchObject({
      code: "BORING_AGENT_RUNTIME_IDENTITY_INCOMPLETE",
    })

    expect(stableOne).toBe(stableTwo)
    expect(policyChanged).not.toBe(stableOne)
    expect(promptChanged).not.toBe(stableOne)
    expect(toolChanged).not.toBe(stableOne)
    expect(piChanged).not.toBe(stableOne)
    expect(artifactBytesChanged).not.toBe(stableOne)
    expect(placementChanged).not.toBe(stableOne)
    expect(provisioningChanged).not.toBe(stableOne)
    expect(stableOne).toMatch(/^[a-f0-9]{64}$/)
  })

  test("derives stable directory artifact identity from relative paths and admitted bytes", async () => {
    const workspaceRoot = await makeTempDir("boring-directory-artifact-identity-")
    const firstRoot = join(workspaceRoot, "first")
    const secondRoot = join(workspaceRoot, "second")
    for (const [root, prompt] of [[firstRoot, "PROMPT_A"], [secondRoot, "PROMPT_B"]] as const) {
      await mkdir(join(root, "server"), { recursive: true })
      await writeFile(join(root, "package.json"), JSON.stringify({
        name: "directory-identity",
        boring: { server: "server/index.mjs" },
      }), "utf8")
      await writeFile(join(root, "server", "index.mjs"), `export default { id: "directory-identity", systemPrompt: ${JSON.stringify(prompt)} }\n`, "utf8")
    }
    const resolveDigest = async (dir: string) => (
      await resolveWorkspaceAgentServerPluginCollection({
        workspaceRoot,
        bridge: {} as never,
        plugins: [{ dir, hotReload: true }],
        installPluginAuthoring: false,
      })
    ).resolvedPluginArtifacts[0]?.contentDigest

    const signatureCachePath = join(firstRoot, ".boring-signature.json")
    const nestedSameNamePath = join(firstRoot, "server", ".boring-signature.json")
    await writeFile(signatureCachePath, JSON.stringify({ version: 1, serverSignature: "fixed", loadedAt: 1_000 }), "utf8")
    await writeFile(nestedSameNamePath, "admitted-a", "utf8")
    const first = await resolveDigest(firstRoot)
    await writeFile(signatureCachePath, JSON.stringify({ version: 1, serverSignature: "fixed", loadedAt: 2_000 }), "utf8")
    expect(await resolveDigest(firstRoot)).toBe(first)
    await writeFile(nestedSameNamePath, "admitted-b", "utf8")
    expect(await resolveDigest(firstRoot)).not.toBe(first)
    expect(await resolveDigest(secondRoot)).not.toBe(first)
  })

  test("trusted host capabilities are passed only to internal directory plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-trusted-plugin-context-")
    const internalRoot = join(workspaceRoot, "internal")
    const externalRoot = join(workspaceRoot, "external")
    for (const [root, id] of [[internalRoot, "internal-plugin"], [externalRoot, "external-plugin"]] as const) {
      await mkdir(join(root, "server"), { recursive: true })
      await writeFile(
        join(root, "server", "index.mjs"),
        `export default (_options, ctx) => ({ id: ${JSON.stringify(id)}, systemPrompt: ctx?.trusted ? ${JSON.stringify(`${id}:trusted`)} : ${JSON.stringify(`${id}:untrusted`)} })\n`,
        "utf8",
      )
      await writeFile(join(root, "package.json"), JSON.stringify({ name: id, boring: { server: "server/index.mjs" } }), "utf8")
    }

    const collection = await resolveWorkspaceAgentServerPluginCollection({
      workspaceRoot,
      bridge: {} as never,
      defaultPluginPackages: [internalRoot],
      plugins: [{ dir: externalRoot, hotReload: true }],
      trustedPluginContext: {
        workspaceAgentDispatcherResolver: { resolve: vi.fn() } as never,
        actorResolver: vi.fn(async () => ({ workspaceId: "default", userId: "local" })),
      },
    })

    expect(collection.agentOptions.systemPromptAppend).toContain("internal-plugin:trusted")
    expect(collection.agentOptions.systemPromptAppend).toContain("external-plugin:untrusted")
  })

  test("additionalBoringPluginDirs discovers front/Pi-only plugins from an extra global root", async () => {
    const workspaceRoot = await makeTempDir("boring-extra-plugin-root-workspace-")
    const globalRoot = await makeTempDir("boring-extra-plugin-root-global-")
    const pluginRoot = join(globalRoot, "global-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "agent", "skills"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "global-plugin" })\n', "utf8")
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function extension() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "global-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { systemPrompt: "GLOBAL_PLUGIN_PROMPT", skills: ["agent/skills"], extensions: ["agent/index.ts"] },
    }), "utf8")

    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      additionalBoringPluginDirs: [globalRoot],
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "global-plugin",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          pi: expect.objectContaining({ systemPrompt: "GLOBAL_PLUGIN_PROMPT" }),
        }),
      ])

      const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[]; extensionPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "agent", "skills"))
      expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(join(pluginRoot, "agent", "index.ts"))
      expect(agentOptions.systemPromptDynamic?.()).toContain("GLOBAL_PLUGIN_PROMPT")
    } finally {
      await app.close()
    }
  })

  test("boringPluginFrontTargetResolver customizes plugin list payloads without changing discovery", async () => {
    const workspaceRoot = await makeTempDir("boring-front-target-resolver-workspace-")
    await writeHotPlugin(workspaceRoot, "index.ts")

    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      boringPluginFrontTargetResolver(plugin, { revision, frontEntrySubpath }) {
        return {
          kind: "native",
          entryUrl: `/runtime/${plugin.id}/${revision}/${frontEntrySubpath}`,
          revision,
          trust: "local-trusted-native",
        }
      },
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "hot-plugin",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          frontTarget: {
            kind: "native",
            entryUrl: "/runtime/hot-plugin/1/front/index.tsx",
            revision: 1,
            trust: "local-trusted-native",
          },
        }),
      ])
    } finally {
      await app.close()
    }
  })

  test("defaultPluginPackages throws when declared server entry is missing", async () => {
    const appRoot = await makeTempDir("boring-app-default-package-missing-server-")
    const pluginRoot = join(appRoot, "plugins", "bad")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Bad() { return null }\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "bad",
      version: "1.0.0",
      boring: { front: "front/index.tsx", server: "server/missing.ts" },
    }), "utf8")
    await expect(createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      defaultPluginPackages: [pluginRoot],
      logger: false,
      provisionWorkspace: false,
    })).rejects.toThrow(/declared but not found/)
  })

})

describe("directory-source plugin entries", () => {
  async function writeDirPlugin(opts: {
    dir: string
    serverEntry?: string  // path inside dir
    factory?: boolean     // export factory vs object
    optionsKey?: string
  }): Promise<void> {
    await mkdir(opts.dir, { recursive: true })
    const serverRel = opts.serverEntry ?? "src/server/index.ts"
    await mkdir(join(opts.dir, serverRel.split("/").slice(0, -1).join("/")), { recursive: true })
    const body = opts.factory
      ? `export default function (options, ctx) {
           return { id: "dir-factory", systemPrompt: "OPTS=" + JSON.stringify(options ?? {}) + " ROOT=" + ctx.workspaceRoot }
         }`
      : `export default { id: "dir-object", systemPrompt: "OBJECT_PROMPT" }`
    await writeFile(join(opts.dir, serverRel), body, "utf8")
    const pkg: Record<string, unknown> = { name: "test-plugin", boring: { id: opts.factory ? "dir-factory" : "dir-object", server: serverRel } }
    await writeFile(join(opts.dir, "package.json"), JSON.stringify(pkg), "utf8")
  }

  test("dir entry with factory export receives options and ctx", async () => {
    const dir = await makeTempDir("phase1-dir-factory-")
    await writeDirPlugin({ dir, factory: true })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, options: { adapter: "abc" }, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain('OPTS={"adapter":"abc"}')
    expect(agentOptions.systemPromptAppend).toContain("ROOT=/tmp/phase1-host")
  })

  test("dir entry with object export passes through", async () => {
    const dir = await makeTempDir("phase1-dir-object-")
    await writeDirPlugin({ dir, factory: false })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-obj-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("OBJECT_PROMPT")
  })

  test("dir entry with async factory export is awaited and validated", async () => {
    const dir = await makeTempDir("phase1-dir-async-factory-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      `export default async function (options, ctx) {
         await Promise.resolve()
         return { id: "dir-async-factory", systemPrompt: "ASYNC ROOT=" + ctx.workspaceRoot }
       }`,
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "async-plugin", boring: { id: "dir-async-factory", server: "src/server/index.ts" } }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-async-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("ASYNC ROOT=/tmp/phase1-async-host")
  })

  test("dir entry honors explicit boring.server manifest field", async () => {
    const dir = await makeTempDir("phase1-explicit-")
    await writeDirPlugin({ dir, serverEntry: "src/custom/srv.ts", factory: true })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-explicit-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("OPTS={}")
  })

  test("dir entry: declared-but-missing manifest field throws loudly", async () => {
    const dir = await makeTempDir("phase1-missing-")
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "missing", boring: { server: "src/server/missing.ts" } }),
      "utf8",
    )

    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: "/tmp/phase1-missing-host",
        logger: false,
        provisionWorkspace: false,
        plugins: [{ dir, hotReload: true }],
      }),
    ).rejects.toThrow(/declared but not found/)
  })

})

describe("beforeReload triggers directory-source re-resolve", () => {
  test("editing a dir-source plugin's server entry re-resolves without diagnostics after /reload", async () => {
    const dir = await makeTempDir("phase5-reload-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'p5', systemPrompt: 'V1' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p5", boring: { server: "src/server/index.ts" } }), "utf8")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    // Edit the plugin's server module
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'p5', systemPrompt: 'V2_AFTER_RELOAD' }",
      "utf8",
    )

    // Simulate /reload firing via the beforeReload hook captured by createAgentApp.
    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()

    // The exposed rebuild closure is diagnostic-only; a successful
    // re-resolve reports no diagnostics but does not return/install a graph.
    const rebuilt = await (app as unknown as { __boringRebuildPlugins: () => Promise<{ ok: boolean; diagnostics: unknown[] }> }).__boringRebuildPlugins()
    expect(rebuilt).toEqual({ ok: true, diagnostics: [] })
  })

  test("beforeReload returns rebuild diagnostics merged with caller restart warnings", async () => {
    const dir = await makeTempDir("phase5-diagnostics-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'diagnostic-plugin', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "diagnostic-plugin", boring: { server: "src/server/index.ts" } }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-diagnostics-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
      beforeReload: async () => ({
        restart_warnings: [
          { id: "caller-plugin", surfaces: ["routes"], message: "caller restart warning" },
        ],
      }),
    })

    await writeFile(join(dir, "src", "server", "index.ts"), "this is not valid typescript {{", "utf8")

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<{ restart_warnings?: unknown[]; diagnostics?: unknown[] } | undefined> },
    ]
    const result = await agentOptions.beforeReload?.()
    expect(result?.restart_warnings).toEqual([
      expect.objectContaining({ id: "caller-plugin", surfaces: ["routes"] }),
    ])
    expect(result?.diagnostics?.length).toBeGreaterThan(0)
  })

  test("dir-source plugin re-resolve failure is tolerated; beforeReload does NOT throw (PLUGIN_SYSTEM.md §4.5 partial-failure tolerance)", async () => {
    const dir = await makeTempDir("phase5-bad-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'good', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p", boring: { id: "good", server: "src/server/index.ts" } }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-bad-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    // Replace the server entry with a syntax error so the next jiti import throws.
    await writeFile(join(dir, "src", "server", "index.ts"), "this is not valid typescript {{", "utf8")

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    // Per-plugin rebuild failures must NOT abort the reload — diagnostics
    // surface via SSE error events + .error files, not by aborting beforeReload.
    await expect(agentOptions.beforeReload?.()).resolves.not.toThrow()
  })
})
