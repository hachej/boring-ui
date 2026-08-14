import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as agentServer from "@hachej/boring-agent/server"
import type { AuthorizedAgentScope } from "@hachej/boring-agent/shared"
import { assertComposedAgentHostRouteTable } from "@hachej/boring-agent/server/agent-host/testing/compositionRouteProof"
import { PiSessionStore } from "../../../../agent/src/server/harness/pi-coding-agent/sessions.js"
import { createLocalWorkspaceRegistry } from "../localWorkspaces.js"
import { createFolderModeApp, createWorkspacesModeApp } from "../modeApps.js"

const automationFailure = vi.hoisted(() => ({ enabled: false }))
const pluginFrontFailure = vi.hoisted(() => ({ enabled: false, closeCalls: 0 }))
const cliDefaultPluginPackages = vi.hoisted(() => ({ paths: [] as string[] }))
const MODEL_TIERS_YAML = "models:\n  tiers:\n    T3:\n      - provider: anthropic\n        id: claude-sonnet-4-6\n        envVar: ANTHROPIC_API_KEY\n"

vi.mock("../pluginFrontRuntime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pluginFrontRuntime.js")>()
  return {
    ...actual,
    createPluginFrontRuntimeHost: async (...args: Parameters<typeof actual.createPluginFrontRuntimeHost>) => {
      const host = await actual.createPluginFrontRuntimeHost(...args)
      if (!pluginFrontFailure.enabled) return host
      return {
        ...host,
        async registerRoutes() { throw new Error("injected folder runtime route failure") },
        async close() {
          pluginFrontFailure.closeCalls += 1
          await host.close()
        },
      }
    },
  }
})

vi.mock("@hachej/boring-automation/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-automation/server")>()
  return {
    ...actual,
    automationRoutes: async (...args: Parameters<typeof actual.automationRoutes>) => {
      if (automationFailure.enabled) throw new Error("injected post-mount CLI init failure")
      return await actual.automationRoutes(...args)
    },
  }
})

vi.mock("../pluginDiscovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pluginDiscovery.js")>()
  return {
    ...actual,
    resolveCliDefaultPluginPackagePaths: () => [...cliDefaultPluginPackages.paths],
    resolveCliBoringPluginDirs: () => [],
  }
})

const roots: string[] = []
const originalHome = process.env.HOME
const originalSessionRoot = process.env.BORING_AGENT_SESSION_ROOT

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function restoreEnv(name: "HOME" | "BORING_AGENT_SESSION_ROOT", value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(async () => {
  automationFailure.enabled = false
  pluginFrontFailure.enabled = false
  pluginFrontFailure.closeCalls = 0
  cliDefaultPluginPackages.paths = []
  restoreEnv("HOME", originalHome)
  restoreEnv("BORING_AGENT_SESSION_ROOT", originalSessionRoot)
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureApp(useConfiguredSessionRoot: boolean) {
  const home = await temporaryRoot("boring-cli-agent-host-home-")
  const workspaceRoot = await temporaryRoot("boring-cli-agent-host-workspace-")
  const registryRoot = await temporaryRoot("boring-cli-agent-host-registry-")
  const configuredSessionRoot = useConfiguredSessionRoot
    ? await temporaryRoot("boring-cli-agent-host-sessions-")
    : undefined
  process.env.HOME = home
  restoreEnv("BORING_AGENT_SESSION_ROOT", configuredSessionRoot)

  const registryPath = join(registryRoot, "workspaces.yaml")
  const workspace = await createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)
  const skillPath = join(workspaceRoot, ".agents", "skills", "reload-fixture", "SKILL.md")
  await mkdir(join(workspaceRoot, ".agents", "skills", "reload-fixture"), { recursive: true })
  await writeFile(skillPath, "# Reload fixture\n\nBefore reload.\n", "utf8")
  const rollbackReader = new PiSessionStore(resolve(workspaceRoot))
  const created = await rollbackReader.create(
    { workspaceId: workspace.id, userId: "local" },
    { title: "pre-MIG-CLI fixture" },
  )
  const sessionId = created.id
  const transcriptName = (await readdir(rollbackReader.getSessionDir()))
    .find((name) => name === `${sessionId}.jsonl` || name.endsWith(`_${sessionId}.jsonl`))
  if (!transcriptName) throw new Error(`missing transcript for ${sessionId}`)
  const transcriptPath = join(rollbackReader.getSessionDir(), transcriptName)
  await appendFile(transcriptPath, `${JSON.stringify({
    type: "message", id: "created-user", parentId: null, timestamp: "2026-07-20T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
  })}\n`)
  const transcript = await readFile(transcriptPath, "utf8")
  const legacySessions = [
    { id: "native-unscoped", context: undefined },
    { id: "workspace-only", context: { workspaceId: workspace.id } },
    { id: "other-workspace", context: { workspaceId: "other", userId: "local" } },
    { id: "other-user", context: { workspaceId: workspace.id, userId: "other" } },
  ] as const
  await Promise.all(legacySessions.map(async ({ id, context }) => {
    await writeFile(
      join(rollbackReader.getSessionDir(), `${id}.jsonl`),
      `${JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-07-30T00:00:00.000Z",
        cwd: workspaceRoot,
        ...(context ? { boringSessionCtx: context } : {}),
      })}\n${JSON.stringify({
        type: "message", id: `message-${id}`, parentId: null, timestamp: "2026-07-20T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
      })}\n`,
      "utf8",
    )
  }))
  const compatibleSessionIds = [sessionId, "native-unscoped", "workspace-only"].sort()

  const createAgentHost = vi.spyOn(agentServer, "createAgentHost")
  const app = await createWorkspacesModeApp({
    mode: "direct",
    registryPath,
    provisionWorkspace: false,
  })
  return { app, workspace, sessionId, compatibleSessionIds, transcript, transcriptPath, skillPath, createAgentHost, rollbackReader }
}

describe.sequential("CLI Agent Host composition", () => {
  it("folder-mode fleet seats receive workspace plugin agent tools", async () => {
    const fleetRoot = await temporaryRoot("boring-cli-seat-tools-fleet-")
    const workspaceRoot = await temporaryRoot("boring-cli-seat-tools-workspace-")
    const pluginRoot = await temporaryRoot("boring-cli-seat-tools-plugin-")
    const personaRoot = join(fleetRoot, ".agents", "personas", "worker")
    await mkdir(personaRoot, { recursive: true })
    await mkdir(join(fleetRoot, ".agents", "factory"), { recursive: true })
    await writeFile(join(personaRoot, "instructions.md"), "You are the fixture worker.\n", "utf8")
    await writeFile(join(personaRoot, "package.json"), JSON.stringify({
      name: "@fixture/boring-worker",
      version: "1.0.0",
      private: true,
      boring: {
        agent: {
          definitionId: "boring-worker",
          version: "1.0.0",
          label: "Boring Worker",
          instructionsRef: "instructions.md",
        },
      },
    }), "utf8")
    await writeFile(
      join(fleetRoot, ".agents", "factory", "fleet.yaml"),
      `${MODEL_TIERS_YAML}seats:\n  - seat: worker\n    agentTypeId: boring-worker\n    skills: []\n`,
      "utf8",
    )
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "@fixture/workspace-seat-tools",
      version: "1.0.0",
      type: "module",
      private: true,
      boring: { id: "workspace-seat-tools", server: "server.mjs" },
    }), "utf8")
    await writeFile(join(pluginRoot, "server.mjs"), `
      export default {
        id: "workspace-seat-tools",
        agentTools: [{
          name: "workspace_seat_tool",
          description: "Fixture workspace plugin tool.",
          parameters: { type: "object", properties: {} },
          async execute() { return { content: [] } },
        }],
      }
    `, "utf8")

    cliDefaultPluginPackages.paths = [pluginRoot]
    const previousCwd = process.cwd()
    const previousFlag = process.env.BORING_AGENT_FLEET
    process.chdir(fleetRoot)
    process.env.BORING_AGENT_FLEET = "1"
    let app: FastifyInstance | undefined
    try {
      app = await createFolderModeApp({
        workspaceRoot,
        mode: "direct",
        provisionWorkspace: false,
      })
      const defaultTools = await app.inject({ method: "GET", url: "/api/v1/agents/default/tools" })
      const workerTools = await app.inject({ method: "GET", url: "/api/v1/agents/boring-worker/tools" })
      expect(defaultTools.statusCode, defaultTools.body).toBe(200)
      expect(workerTools.statusCode, workerTools.body).toBe(200)
      expect(defaultTools.json().tools.map((tool: { name: string }) => tool.name)).toContain("workspace_seat_tool")
      expect(workerTools.json().tools.map((tool: { name: string }) => tool.name)).toContain("workspace_seat_tool")
    } finally {
      if (app) await app.close()
      process.chdir(previousCwd)
      if (previousFlag === undefined) delete process.env.BORING_AGENT_FLEET
      else process.env.BORING_AGENT_FLEET = previousFlag
    }
  }, 30_000)

  it("workspaces hub excludes workspace-local packages from its global fleet", async () => {
    const fleetRoot = await temporaryRoot("boring-cli-local-agent-fleet-")
    const workspaceARoot = await temporaryRoot("boring-cli-local-agent-workspace-a-")
    const workspaceBRoot = await temporaryRoot("boring-cli-local-agent-workspace-b-")
    const registryRoot = await temporaryRoot("boring-cli-local-agent-registry-")
    const localPackageRoot = join(workspaceARoot, "agents", "local-worker")
    const duplicatePackageRoot = join(workspaceARoot, "agents", "duplicate-repository-worker")
    const repositoryPackageRoot = join(fleetRoot, ".agents", "personas", "repository-worker")
    const registryPath = join(registryRoot, "workspaces.yaml")
    const registry = createLocalWorkspaceRegistry(registryPath)
    await registry.add(workspaceARoot)
    const workspaceB = await registry.add(workspaceBRoot)
    await mkdir(localPackageRoot, { recursive: true })
    await mkdir(join(duplicatePackageRoot, "knowledge"), { recursive: true })
    await mkdir(join(repositoryPackageRoot, "knowledge"), { recursive: true })
    await mkdir(join(workspaceARoot, ".pi"), { recursive: true })
    await mkdir(join(fleetRoot, ".agents", "factory"), { recursive: true })
    await writeFile(join(localPackageRoot, "instructions.md"), "CLI local worker.\n", "utf8")
    await writeFile(join(localPackageRoot, "package.json"), JSON.stringify({
      name: "@fixture/cli-local-worker",
      version: "1.0.0",
      boring: {
        agent: {
          definitionId: "fixture-cli-local-worker",
          version: "1.0.0",
          label: "CLI Local Worker",
          instructionsRef: "instructions.md",
        },
      },
      pi: { skills: [] },
    }), "utf8")
    await writeFile(join(duplicatePackageRoot, "instructions.md"), "Workspace A duplicate worker.\n", "utf8")
    await writeFile(join(duplicatePackageRoot, "knowledge", "scope.md"), "Workspace A only.\n", "utf8")
    await writeFile(join(duplicatePackageRoot, "package.json"), JSON.stringify({
      name: "@fixture/cli-duplicate-repository-worker",
      version: "1.0.0",
      boring: {
        agent: {
          definitionId: "fixture-cli-repository-worker",
          version: "1.0.0",
          label: "Workspace A Duplicate Worker",
          instructionsRef: "instructions.md",
        },
      },
      pi: { skills: [] },
    }), "utf8")
    await writeFile(join(repositoryPackageRoot, "instructions.md"), "CLI repository worker.\n", "utf8")
    await writeFile(join(repositoryPackageRoot, "knowledge", "scope.md"), "Repository owned.\n", "utf8")
    await writeFile(join(repositoryPackageRoot, "package.json"), JSON.stringify({
      name: "@fixture/cli-repository-worker",
      version: "1.0.0",
      boring: {
        agent: {
          definitionId: "fixture-cli-repository-worker",
          version: "1.0.0",
          label: "CLI Repository Worker",
          instructionsRef: "instructions.md",
        },
      },
      pi: { skills: [] },
    }), "utf8")
    await writeFile(
      join(workspaceARoot, ".pi", "settings.json"),
      JSON.stringify({ packages: ["../agents/local-worker", "../agents/duplicate-repository-worker"] }),
      "utf8",
    )
    await writeFile(
      join(fleetRoot, ".agents", "factory", "fleet.yaml"),
      MODEL_TIERS_YAML + [
        "seats:",
        "  - seat: repository-worker",
        "    agentTypeId: fixture-cli-repository-worker",
        "    skills: []",
        "  - seat: local-worker",
        "    agentTypeId: fixture-cli-local-worker",
        "    skills: []",
        "",
      ].join("\n"),
      "utf8",
    )

    const previousCwd = process.cwd()
    const previousFlag = process.env.BORING_AGENT_FLEET
    process.chdir(fleetRoot)
    process.env.BORING_AGENT_FLEET = "1"
    const createAgentHost = vi.spyOn(agentServer, "createAgentHost")
    let app: FastifyInstance | undefined
    try {
      app = await createWorkspacesModeApp({
        mode: "direct",
        registryPath,
        provisionWorkspace: false,
      })
      expect(createAgentHost).toHaveBeenCalledWith(expect.objectContaining({
        agents: expect.arrayContaining([
          expect.objectContaining({ agentTypeId: "default" }),
          expect.objectContaining({ agentTypeId: "fixture-cli-repository-worker" }),
        ]),
      }))
      const agents = createAgentHost.mock.calls[0]?.[0].agents ?? []
      expect(agents).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ agentTypeId: "fixture-cli-local-worker" }),
      ]))
      expect(agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          agentTypeId: "fixture-cli-repository-worker",
          definition: expect.objectContaining({
            instructions: "CLI repository worker.\n",
            digest: expect.stringMatching(/^sha256:/),
          }),
          knowledge: { rootDir: join(repositoryPackageRoot, "knowledge") },
        }),
      ]))

      const workspaceBAgents = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-workspace-id": workspaceB.id },
      })
      expect(workspaceBAgents.statusCode, workspaceBAgents.body).toBe(200)
      expect(workspaceBAgents.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentTypeId: "default" }),
        expect.objectContaining({
          agentTypeId: "fixture-cli-repository-worker",
          label: "CLI Repository Worker",
        }),
      ]))
      expect(workspaceBAgents.json()).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ agentTypeId: "fixture-cli-local-worker" }),
      ]))
    } finally {
      if (app) await app.close()
      process.chdir(previousCwd)
      if (previousFlag === undefined) delete process.env.BORING_AGENT_FLEET
      else process.env.BORING_AGENT_FLEET = previousFlag
    }
  }, 30_000)

  it("closes folder-mode Host and front runtime when post-mount runtime route init fails", async () => {
    const workspaceRoot = await temporaryRoot("boring-cli-folder-post-mount-cleanup-")
    pluginFrontFailure.enabled = true
    await expect(createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      provisionWorkspace: false,
    })).rejects.toThrow("injected folder runtime route failure")
    expect(pluginFrontFailure.closeCalls).toBe(1)
  })

  it("closes the CLI Host exactly once when awaited post-mount initialization fails", async () => {
    const registryRoot = await temporaryRoot("boring-cli-post-mount-cleanup-")
    const hostClose = vi.fn(async () => {})
    vi.spyOn(agentServer, "createAgentHost").mockResolvedValue({
      host: {
        hostId: "cli-cleanup-test",
        describe: async () => ({ hostId: "cli-cleanup-test", agents: [], draining: false }),
        drain: vi.fn(async () => {}),
        close: hostClose,
      },
      gateway: {} as never,
      acquireEnvironment: vi.fn(async () => { throw new Error("unused") }),
      runWithWorkspaceAgent: vi.fn(async () => { throw new Error("unused") }),
      registerDirectRoutes: vi.fn(() => async (app: FastifyInstance) => {
        app.addHook("onClose", hostClose)
      }),
    })
    automationFailure.enabled = true
    await expect(createWorkspacesModeApp({
      mode: "direct",
      registryPath: join(registryRoot, "workspaces.yaml"),
      provisionWorkspace: false,
    })).rejects.toThrow("injected post-mount CLI init failure")
    expect(hostClose).toHaveBeenCalledOnce()
  })

  it("Final composed route/auth proof: CLI folder mode inherits Workspace's direct Host projection", async () => {
    const workspaceRoot = await temporaryRoot("boring-cli-folder-agent-host-")
    const sessionRoot = await temporaryRoot("boring-cli-folder-agent-sessions-")
    restoreEnv("BORING_AGENT_SESSION_ROOT", sessionRoot)
    const createAgentHost = vi.spyOn(agentServer, "createAgentHost")
    const app = await createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      provisionWorkspace: false,
    })
    try {
      assertComposedAgentHostRouteTable(app)
      expect(createAgentHost).toHaveBeenCalledOnce()
      expect(createAgentHost).toHaveBeenCalledWith(expect.objectContaining({
        resolveAuthorizedEnvironmentScope: expect.any(Function),
        resolveAuthorizedAgentRuntimeScope: expect.any(Function),
      }))
      expect(app.hasRoute({ method: "GET", url: "/api/v1/agents" })).toBe(true)
      expect(app.hasRoute({
        method: "GET",
        url: "/api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index",
      })).toBe(true)
      expect((await app.inject({ method: "GET", url: "/api/v1/agents" })).statusCode).toBe(200)
      expect((await app.inject({ method: "GET", url: "/api/v1/files/search?q=proof" })).statusCode).toBe(200)
      expect((await app.inject({
        method: "GET",
        url: "/api/v1/files/raw?path=missing.txt&workspaceId=foreign",
      })).statusCode).toBe(403)
    } finally {
      await app.close()
    }
  }, 30_000)

  it.each([
    ["unset", false],
    ["set", true],
  ] as const)(
    "Final composed route/auth proof: CLI workspaces mode uses one Host and preserves transcript bytes with root %s",
    async (_label, useConfiguredSessionRoot) => {
      const fixture = await fixtureApp(useConfiguredSessionRoot)
      const headers = { "x-boring-workspace-id": fixture.workspace.id }
      try {
        expect(fixture.createAgentHost).toHaveBeenCalledTimes(1)
        assertComposedAgentHostRouteTable(fixture.app)
        expect(fixture.createAgentHost).toHaveBeenCalledWith(expect.objectContaining({
          agents: [{ agentTypeId: "default", legacyDefault: true }],
          hostId: "cli-trusted-local",
        }))
        const hostOptions = fixture.createAgentHost.mock.calls[0]?.[0]
        expect(hostOptions).toBeDefined()
        await expect(hostOptions!.scopeVerifier.verify(Object.freeze({
          workspaceScopeId: fixture.workspace.id,
          authSubjectId: "local",
        }) as AuthorizedAgentScope)).rejects.toThrow("not issued by this process")

        const addressed = await fixture.app.inject({ method: "GET", url: "/api/v1/agents", headers })
        expect(addressed.statusCode, addressed.body).toBe(200)
        expect(addressed.json()).toEqual([{ agentTypeId: "default", label: "Agent" }])
        expect((await fixture.app.inject({
          method: "GET",
          url: "/api/v1/files/search?q=proof",
          headers,
        })).statusCode).toBe(200)
        expect(fixture.app.hasRoute({
          method: "POST",
          url: "/api/v1/agents/:agentTypeId/reload",
        })).toBe(true)

        const addressedSessions = await fixture.app.inject({
          method: "GET",
          url: "/api/v1/agents/default/sessions",
          headers,
        })
        expect(addressedSessions.statusCode, addressedSessions.body).toBe(200)
        expect(addressedSessions.json().sessions
          .map((session: { ref: { sessionId: string } }) => session.ref.sessionId)
          .sort()).toEqual(fixture.compatibleSessionIds)

        const state = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/agents/default/sessions/${fixture.sessionId}/state`,
          headers,
        })
        expect(state.statusCode).toBe(200)
        expect(state.json()).toMatchObject({
          ref: { agentTypeId: "default", sessionId: fixture.sessionId },
          state: { sessionId: fixture.sessionId, status: "idle" },
        })
        expect(await readFile(fixture.transcriptPath, "utf8")).toBe(fixture.transcript)

        const reloadRequest = {
          method: "POST" as const,
          url: "/api/v1/agents/default/reload",
          headers,
          payload: { requestId: "cli-resource-reload", sessionId: fixture.sessionId },
        }
        expect((await fixture.app.inject(reloadRequest)).statusCode).toBe(200)
        expect((await fixture.app.inject(reloadRequest)).statusCode).toBe(200)
        await writeFile(fixture.skillPath, "# Reload fixture\n\nAfter reload.\n", "utf8")
        const changedResourceReplay = await fixture.app.inject(reloadRequest)
        expect(changedResourceReplay.statusCode).toBe(409)
        expect(changedResourceReplay.json()).toMatchObject({
          error: { code: "AGENT_REQUEST_CONFLICT" },
        })

        const unknownWorkspace = await fixture.app.inject({
          method: "GET",
          url: "/api/v1/agents",
          headers: { "x-boring-workspace-id": "not-registered" },
        })
        expect(unknownWorkspace.statusCode).toBe(404)
      } finally {
        await fixture.app.close()
      }

      // The old reader after rollback sees the exact original path and bytes;
      // no migration, copy, repair, journal, or second writer was introduced.
      expect(await readFile(fixture.transcriptPath, "utf8")).toBe(fixture.transcript)
      expect((await fixture.rollbackReader.list({ workspaceId: fixture.workspace.id, userId: "local" })).map((row) => row.id))
        .toContain(fixture.sessionId)
      expect(fixture.createAgentHost).toHaveBeenCalledTimes(1)
    },
    30_000,
  )
})
