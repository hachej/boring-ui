// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { assertComposedAgentHostRouteTable } from "@hachej/boring-agent/server/agent-host/testing/compositionRouteProof"
import {
  createAgentHost,
  type AgentFleetCompiler,
  type AgentHostAgentSpec,
  type RuntimeModeAdapter,
} from "@hachej/boring-agent/server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => {
  const captureResolvedRuntimeScope = vi.fn(async (_resolved?: unknown) => undefined)
  const hostClose = vi.fn(async () => {})
  const acquireEnvironment = vi.fn<() => Promise<any>>(async () => { throw new Error("test Environment lease was not configured") })
  const directProjections: Array<{ authorizeAgentRequest(request: any): Promise<any> }> = []
  let actualCreateAgentHost: ((options: any) => Promise<any>) | undefined
  return {
    captureResolvedRuntimeScope,
    createAgentHost: vi.fn(async (options: any) => {
      const compiled = await options.fleetCompiler.compile({ agents: options.agents }) as typeof options.agents
      const created = {
        host: {
          hostId: "workspace-agent-host",
          describe: async () => ({
            hostId: "workspace-agent-host",
            draining: false,
            agents: compiled.map((agent: any) => ({
              agentTypeId: agent.agentTypeId,
              label: agent.legacyDefault ? "Agent" : agent.definition?.label ?? agent.agentTypeId,
            })),
          }),
          drain: vi.fn(async () => {}),
          close: hostClose,
        },
        gateway: {},
        registerDirectRoutes: vi.fn((projection: { authorizeAgentRequest(request: any): Promise<any> }) => async (app: any) => {
          app.addHook("onClose", hostClose)
          directProjections.push(projection)
          const request = { id: "workspace-test-composition", url: "/api/v1/agents/default/sessions", headers: {}, query: {} }
          const scope = await projection.authorizeAgentRequest(request)
          const claim = await options.scopeVerifier.verify(scope)
          const environment = await options.resolveAuthorizedEnvironmentScope({
            authorizedScope: scope,
            verifiedClaim: claim,
            intent: { kind: "agent-binding", requestId: request.id },
          })
          const resolveDirectRuntimeScope = async ({ agentTypeId, scope: issuedScope }: { agentTypeId: string; scope: any }) => {
            const verifiedClaim = await options.scopeVerifier.verify(issuedScope)
            const resolvedEnvironment = await options.resolveAuthorizedEnvironmentScope({
              authorizedScope: issuedScope,
              verifiedClaim,
              intent: { kind: "agent-binding", requestId: request.id },
            })
            const runtime = await options.resolveAuthorizedAgentRuntimeScope({
              authorizedScope: issuedScope,
              verifiedClaim,
              agentTypeId,
              intent: { kind: "agent-binding", operation: "new-binding", requestId: request.id },
              environment: resolvedEnvironment,
            })
            return { ...runtime, environment: resolvedEnvironment }
          }
          ;(options as any).resolveDirectRuntimeScopeForTest = resolveDirectRuntimeScope
          const runtime = await resolveDirectRuntimeScope({ agentTypeId: options.agents[0].agentTypeId, scope })
          const reloadCandidate = await options.resolveAuthorizedAgentRuntimeScope({
            authorizedScope: scope,
            verifiedClaim: claim,
            agentTypeId: options.agents[0].agentTypeId,
            intent: { kind: "agent-binding", operation: "reload", requestId: "workspace-test-reload" },
            environment,
          })
          await captureResolvedRuntimeScope({
            ...runtime,
            environment,
            authorizedScope: scope,
            applyReload: reloadCandidate.applyReload,
          })
        }),
        acquireEnvironment,
        runWithWorkspaceAgent: vi.fn(async () => {}),
      }
      return created
    }),
    hostClose,
    acquireEnvironment,
    directProjections,
    provisionRuntimeWorkspace: vi.fn(async () => {}),
    provisionWorkspaceRuntime: vi.fn(async () => undefined),
    captureActuals(input: {
      createAgentHost: (options: any) => Promise<any>
    }) {
      actualCreateAgentHost = input.createAgentHost
    },
    createActualAgentHost(options: any) {
      if (!actualCreateAgentHost) throw new Error("actual createAgentHost was not captured")
      return actualCreateAgentHost(options)
    },
  }
})

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  agentServerMock.captureActuals({
    createAgentHost: actual.createAgentHost,
  })
  return {
    ...actual,
    createAgentHost: agentServerMock.createAgentHost,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

import {
  AgentRuntimeIdentityError,
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  digestWorkspacePiResourceInputs,
  projectAgentSpecPluginArtifacts,
  readWorkspacePluginPackagePiSnapshot,
  resolveWorkspaceAgentServerPluginCollection,
} from "../createWorkspaceAgentServer"
import { resolveDefaultWorkspacePluginPackagePaths } from "../defaultPluginPackages"
import { RuntimeBackendRegistry } from "../../../server/runtimeBackend"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.captureResolvedRuntimeScope.mockClear()
  agentServerMock.createAgentHost.mockClear()
  agentServerMock.hostClose.mockClear()
  agentServerMock.acquireEnvironment.mockReset()
  agentServerMock.acquireEnvironment.mockRejectedValue(new Error("test Environment lease was not configured"))
  agentServerMock.directProjections.splice(0)
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
})

function mockResolvedRuntimeScopeOnce(factory: (resolved?: unknown) => Promise<unknown>): void {
  agentServerMock.captureResolvedRuntimeScope.mockImplementationOnce(factory as never)
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
  await mkdir(join(pluginRoot, "agent", "skills", "hot"), { recursive: true })
  await writeFile(join(pluginRoot, "front", "index.tsx"), 'export default definePlugin({ id: "hot-plugin" })\n', "utf8")
  await writeFile(join(pluginRoot, "agent", extension), "export default function() {}\n", "utf8")
  await writeFile(join(pluginRoot, "agent", "skills", "hot", "SKILL.md"), "# Hot skill\n\nBefore reload.\n", "utf8")
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
    name: "hot-plugin",
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
    pi: { extensions: [`agent/${extension}`], skills: ["agent/skills"] },
  }), "utf8")
}

describe("createWorkspaceAgentServer local Pi session principal", () => {
  test("closes post-mount Host and Workspace resources exactly once when late route init fails", async () => {
    const backendClose = vi.spyOn(RuntimeBackendRegistry.prototype, "close")
    await expect(createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-post-mount-cleanup-"),
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      plugins: [{
        id: "late-init-failure",
        routes: async () => { throw new Error("injected late route init failure") },
      }],
    })).rejects.toThrow("injected late route init failure")
    expect(agentServerMock.hostClose).toHaveBeenCalledOnce()
    expect(backendClose).toHaveBeenCalledOnce()
  })

  test("injects local for unauthenticated requests while preserving authenticated user ids", async () => {
    const resolvePiSessionRequestContext = vi.fn(async (request: any, context: any) => ({
      ...context,
      authSubject: request.user?.id ?? "local",
    }))
    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-local-pi-principal-"),
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      resolvePiSessionRequestContext,
    })

    const projection = agentServerMock.directProjections[0]
    const local = await projection.authorizeAgentRequest({
      id: "request-local", url: "/api/v1/agents/default/sessions", headers: {}, query: {},
    })
    const user = await projection.authorizeAgentRequest({
      id: "request-user", url: "/api/v1/agents/default/sessions", headers: {}, query: {}, user: { id: "user-a" },
    })
    expect(local.authSubjectId).toBe("local")
    expect(user.authSubjectId).toBe("user-a")
    expect(resolvePiSessionRequestContext).toHaveBeenCalledTimes(3)
  })
})

describe("Workspace direct Environment projection", () => {
  test("projects host filesystem bindings into Environment routes and Agent tools", async () => {
    const getFilesystemBindings = vi.fn(async () => [])
    mockResolvedRuntimeScopeOnce(async (resolved) => {
      const scope = resolved as {
        environment: {
          resolveFilesystemBindings(input: {
            verifiedClaim: { workspaceScopeId: string; authSubjectId: string }
            requestId: string
          }): Promise<unknown>
        }
        getFilesystemBindings(input: {
          scope: { workspaceScopeId: string; authSubjectId: string }
          sessionId?: string
          requestId: string
        }): Promise<unknown>
      }
      const claim = { workspaceScopeId: "default", authSubjectId: "local" }
      await scope.environment.resolveFilesystemBindings({ verifiedClaim: claim, requestId: "route-request" })
      await scope.getFilesystemBindings({ scope: claim, sessionId: "session-a", requestId: "tool-request" })
    })

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-workspace-filesystem-bindings-"),
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      getFilesystemBindings,
    })
    try {
      expect(getFilesystemBindings).toHaveBeenNthCalledWith(1, {
        workspaceId: "default",
        workspaceRoot: expect.any(String),
        userId: "local",
        requestId: "route-request",
      })
      expect(getFilesystemBindings).toHaveBeenNthCalledWith(2, {
        workspaceId: "default",
        workspaceRoot: expect.any(String),
        sessionId: "session-a",
        userId: "local",
        requestId: "tool-request",
      })
    } finally {
      await app.close()
    }
  })

  test("ignores lazy Agent chat state when the Host-owned Environment is ready and releases its lease", async () => {
    const release = vi.fn()
    agentServerMock.acquireEnvironment.mockResolvedValueOnce({
      readiness: {
        chat: { state: "not-started" },
        workspace: { state: "ready" },
        runtimeDependencies: { state: "ready" },
      },
      signal: new AbortController().signal,
      release,
    })
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-direct-readiness-"),
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      authToken: "agent-secret",
    })
    try {
      const ready = await app.inject({ method: "GET", url: "/ready" })
      expect(ready.statusCode).toBe(200)
      expect(ready.json()).toEqual({ status: "ready" })
      expect(agentServerMock.acquireEnvironment).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()
    } finally {
      await app.close()
    }
  })

  test("releases finite app-route leases and denies hostile raw workspace selectors before acquisition", async () => {
    const release = vi.fn()
    const workspace = {
      root: "/workspace",
      fsCapability: "strong",
      async readFile() { return "lease-owned" },
      async stat() { return { kind: "file", mtimeMs: 1, size: 11 } },
    }
    agentServerMock.acquireEnvironment.mockResolvedValueOnce({
      workspace,
      gitWorkspace: workspace,
      fileSearch: { async search() { return [] } },
      readiness: {},
      signal: new AbortController().signal,
      release,
    })
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-direct-environment-"),
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
    })
    try {
      const file = await app.inject({ method: "GET", url: "/api/v1/files?path=note.md" })
      expect(file.statusCode).toBe(200)
      expect(file.json()).toMatchObject({ content: "lease-owned", access: "readwrite" })
      expect(agentServerMock.acquireEnvironment).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()

      const hostile = await app.inject({
        method: "GET",
        url: "/api/v1/files/raw?path=note.md&workspaceId=foreign",
      })
      expect(hostile.statusCode).toBe(403)
      expect(agentServerMock.acquireEnvironment).toHaveBeenCalledOnce()
    } finally {
      await app.close()
    }
  })
})

describe("Workspace public admission composition", () => {
  test("Final composed route/auth proof: Workspace mounts the canonical direct Host projection once", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-public-admission-")
    await writeHotPlugin(workspaceRoot, "index.ts")
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
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: true,
      harnessFactory,
      admitEffect,
      beforeReload: async () => { events.push("mutate:resource-refresh") },
      metering: { isEnabled: () => true } as never,
    })

    try {
      expect(agentServerMock.createAgentHost).toHaveBeenCalledOnce()
      assertComposedAgentHostRouteTable(app)
      expect(app.hasRoute({ method: "GET", url: "/api/v1/agents" })).toBe(true)
      expect(app.hasRoute({
        method: "GET",
        url: "/api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index",
      })).toBe(true)
      expect((await app.inject({ method: "GET", url: "/api/v1/files/search?q=proof" })).statusCode).toBe(200)
      expect((await app.inject({
        method: "GET",
        url: "/api/v1/files/raw?path=missing.txt&workspaceId=foreign",
      })).statusCode).toBe(403)
      const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
        effectAdmission?: { admit(input: unknown): Promise<unknown> }
      }]
      expect(hostOptions.effectAdmission).toBeDefined()

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

      const sessionId = gateway.json().sessionId as string
      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/reload",
        payload: { requestId: "gateway-reload", sessionId },
      })
      expect(reload.statusCode).toBe(200)
      expect(admitEffect).toHaveBeenCalledTimes(2)
      expect(events.filter((event) => event === "mutate:resource-refresh")).toHaveLength(1)

      const replayedReload = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/reload",
        payload: { requestId: "gateway-reload", sessionId },
      })
      expect(replayedReload.statusCode).toBe(200)
      expect(admitEffect).toHaveBeenCalledTimes(2)
      expect(events.filter((event) => event === "mutate:resource-refresh")).toHaveLength(1)

      await writeFile(
        join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills", "hot", "SKILL.md"),
        "# Hot skill\n\nAfter reload.\n",
        "utf8",
      )
      const changedResourceReplay = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/reload",
        payload: { requestId: "gateway-reload", sessionId },
      })
      expect(changedResourceReplay.statusCode).toBe(409)
      expect(changedResourceReplay.json()).toMatchObject({ error: { code: "AGENT_REQUEST_CONFLICT" } })
      expect(events.filter((event) => event === "mutate:resource-refresh")).toHaveLength(1)

      const conflictingReload = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/reload",
        payload: { requestId: "gateway-reload" },
      })
      expect(conflictingReload.statusCode).toBe(409)
      expect(conflictingReload.json()).toMatchObject({ error: { code: "AGENT_REQUEST_CONFLICT" } })
      expect(events.filter((event) => event === "mutate:resource-refresh")).toHaveLength(1)

      rejectRequestId = "gateway-reload-rejected"
      const rejectedReload = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/reload",
        payload: { requestId: rejectRequestId, sessionId },
      })
      expect(rejectedReload.statusCode).toBe(500)
      expect(rejectedReload.json()).toMatchObject({ message: "WORKSPACE_ADMISSION_REJECTED" })
      expect(events.filter((event) => event === "mutate:resource-refresh")).toHaveLength(1)
      rejectRequestId = undefined

      const command = await app.inject({
        method: "POST",
        url: "/api/v1/agents/default/commands/execute",
        payload: { requestId: "gateway-command", sessionId, name: "plan", args: "" },
      })
      expect(command.statusCode).toBe(409)
      expect(command.json()).toMatchObject({ error: { code: "METERING_UNSUPPORTED_COMMAND" } })
      expect(admitEffect).toHaveBeenCalledTimes(3)
      expect(events).not.toContain("mutate:command")

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
  }, 10_000)
})

describe("workspace app-server plugin package helpers", () => {
  test("resource input digest follows prompt, skill, package, and extension bytes without loading them", async () => {
    const root = await makeTempDir("boring-resource-digest-")
    const skillRoot = join(root, "skill")
    const packageRoot = join(root, ".pi", "package")
    const extensionPath = join(root, "extension.ts")
    await mkdir(skillRoot, { recursive: true })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(skillRoot, "SKILL.md"), "before skill\n", "utf8")
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture","version":"1"}\n', "utf8")
    await writeFile(extensionPath, "export default 'before'\n", "utf8")
    const digest = (prompt: string) => digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      promptParts: [prompt],
      additionalSkillPaths: ["skill"],
      packages: ["package"],
      extensionPaths: ["extension.ts"],
      authorizedRoots: ["."],
    })

    expect(root).not.toBe(process.cwd())
    const initial = await digest("before prompt")
    expect(await digest("after prompt")).not.toBe(initial)
    await writeFile(join(skillRoot, "SKILL.md"), "after skill\n", "utf8")
    const afterSkill = await digest("before prompt")
    expect(afterSkill).not.toBe(initial)
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture","version":"2"}\n', "utf8")
    const afterPackage = await digest("before prompt")
    expect(afterPackage).not.toBe(afterSkill)
    await writeFile(extensionPath, "export default 'after'\n", "utf8")
    expect(await digest("before prompt")).not.toBe(afterPackage)
  })

  test("resource digest matches Pi cwd, project .pi, and user-agent settings bases", async () => {
    const workspaceRoot = await makeTempDir("boring-resource-pi-cwd-")
    const piAgentDir = await makeTempDir("boring-resource-pi-agent-")
    const explicitSkill = join(workspaceRoot, "explicit-skill")
    const injectedPackage = join(workspaceRoot, ".pi", "injected-package")
    const projectPackage = join(workspaceRoot, ".pi", "project-package")
    const userPackage = join(piAgentDir, "user-package")
    const decoyPackage = join(workspaceRoot, "injected-package")
    await mkdir(explicitSkill, { recursive: true })
    for (const directory of [injectedPackage, projectPackage, userPackage, decoyPackage]) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, "package.json"), JSON.stringify({
        name: directory.split("/").at(-1),
        pi: { extensions: ["index.ts"] },
      }), "utf8")
      await writeFile(join(directory, "index.ts"), "export default 'before'\n", "utf8")
    }
    await writeFile(join(explicitSkill, "SKILL.md"), "explicit before\n", "utf8")
    await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
      packages: ["project-package"],
    }), "utf8")
    await writeFile(join(piAgentDir, "settings.json"), JSON.stringify({
      packages: ["user-package"],
    }), "utf8")

    const input = {
      piCwd: workspaceRoot,
      piAgentDir,
      piUserHome: join(workspaceRoot, "user-home"),
      noSkills: true,
      additionalSkillPaths: ["explicit-skill"],
      packages: ["injected-package"],
      authorizedRoots: [workspaceRoot, piAgentDir],
    }
    expect(workspaceRoot).not.toBe(process.cwd())
    const initial = await digestWorkspacePiResourceInputs(input)

    await writeFile(join(decoyPackage, "index.ts"), "export default 'decoy after'\n", "utf8")
    expect(await digestWorkspacePiResourceInputs(input)).toBe(initial)

    await writeFile(join(injectedPackage, "index.ts"), "export default 'injected after'\n", "utf8")
    const afterInjected = await digestWorkspacePiResourceInputs(input)
    expect(afterInjected).not.toBe(initial)
    await writeFile(join(projectPackage, "index.ts"), "export default 'project after'\n", "utf8")
    const afterProject = await digestWorkspacePiResourceInputs(input)
    expect(afterProject).not.toBe(afterInjected)
    await writeFile(join(userPackage, "index.ts"), "export default 'user after'\n", "utf8")
    expect(await digestWorkspacePiResourceInputs(input)).not.toBe(afterProject)
  })

  test("resource digest is framed, bounded, symlink-safe, and includes extension siblings", async () => {
    const root = await makeTempDir("boring-resource-digest-safety-")
    const extensionRoot = join(root, "extension")
    await mkdir(join(extensionRoot, "agent"), { recursive: true })
    await writeFile(join(extensionRoot, "package.json"), '{"name":"extension-fixture"}\n', "utf8")
    await writeFile(join(extensionRoot, "agent", "index.ts"), "import '../sibling.js'\n", "utf8")
    await writeFile(join(extensionRoot, "sibling.js"), "export default 'before'\n", "utf8")
    const input = {
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      extensionPaths: [join(extensionRoot, "agent", "index.ts")],
      authorizedRoots: [root],
    }
    const initial = await digestWorkspacePiResourceInputs(input)
    await writeFile(join(extensionRoot, "sibling.js"), "export default 'after'\n", "utf8")
    const afterSibling = await digestWorkspacePiResourceInputs(input)
    expect(afterSibling).not.toBe(initial)
    await mkdir(join(extensionRoot, "node_modules", "ignored"), { recursive: true })
    await mkdir(join(extensionRoot, ".git"), { recursive: true })
    await writeFile(join(extensionRoot, "node_modules", "ignored", "index.js"), "ignored\n", "utf8")
    await writeFile(join(extensionRoot, ".git", "HEAD"), "ignored\n", "utf8")
    expect(await digestWorkspacePiResourceInputs(input)).toBe(afterSibling)

    await expect(digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      additionalSkillPaths: [extensionRoot],
      authorizedRoots: [root],
      limits: { maxFiles: 1 },
    })).rejects.toMatchObject({ code: "MCP_AGENT_ARTIFACT_TOO_LARGE", statusCode: 413 })

    const limitRoot = join(root, "limits")
    await mkdir(join(limitRoot, "nested", "deeper"), { recursive: true })
    await writeFile(join(limitRoot, "one"), "12", "utf8")
    await writeFile(join(limitRoot, "two"), "34", "utf8")
    await writeFile(join(limitRoot, "nested", "deeper", "value"), "x", "utf8")
    await expect(digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      additionalSkillPaths: [limitRoot], authorizedRoots: [root], limits: { maxFileBytes: 1 },
    })).rejects.toMatchObject({ code: "MCP_AGENT_ARTIFACT_TOO_LARGE" })
    await expect(digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      additionalSkillPaths: [limitRoot], authorizedRoots: [root], limits: { maxTotalBytes: 3 },
    })).rejects.toMatchObject({ code: "MCP_AGENT_ARTIFACT_TOO_LARGE" })
    await expect(digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      additionalSkillPaths: [limitRoot], authorizedRoots: [root], limits: { maxDepth: 1 },
    })).rejects.toMatchObject({ code: "MCP_AGENT_ARTIFACT_TOO_LARGE" })

    const outside = await makeTempDir("boring-resource-digest-outside-")
    await expect(digestWorkspacePiResourceInputs({
      piCwd: root,
      piAgentDir: join(root, "agent-home"),
      piUserHome: join(root, "user-home"),
      noSkills: true,
      extensionPaths: [join(outside, "missing.ts")],
      authorizedRoots: [root],
    })).rejects.toMatchObject({ code: "PATH_ESCAPE", statusCode: 403 })
    await writeFile(join(outside, "secret"), "not authorized\n", "utf8")
    await symlink(join(outside, "secret"), join(extensionRoot, "escape"))
    await expect(digestWorkspacePiResourceInputs(input)).rejects.toMatchObject({
      code: "PATH_SYMLINK_ESCAPE",
      statusCode: 403,
    })

    const collisionRoot = await makeTempDir("boring-resource-digest-framing-")
    const directoryShape = join(collisionRoot, "a")
    const delimiterShape = join(collisionRoot, "a\nentry:b")
    await mkdir(directoryShape)
    await writeFile(join(directoryShape, "b"), "", "utf8")
    await writeFile(delimiterShape, "", "utf8")
    const directoryDigest = await digestWorkspacePiResourceInputs({
      piCwd: collisionRoot,
      piAgentDir: join(collisionRoot, "agent-home"),
      piUserHome: join(collisionRoot, "user-home"),
      noSkills: true,
      additionalSkillPaths: [directoryShape],
      authorizedRoots: [collisionRoot],
    })
    const delimiterDigest = await digestWorkspacePiResourceInputs({
      piCwd: collisionRoot,
      piAgentDir: join(collisionRoot, "agent-home"),
      piUserHome: join(collisionRoot, "user-home"),
      noSkills: true,
      additionalSkillPaths: [delimiterShape],
      authorizedRoots: [collisionRoot],
    })
    expect(directoryDigest).not.toBe(delimiterDigest)
  })

  test("resolve defaults from app package manifest and read static Pi package resources", async () => {
    const appRoot = await makeTempDir("boring-app-helper-default-package-")
    const manifestPluginRoot = join(appRoot, "plugins", "manifest-plugin")
    const explicitPluginRoot = join(appRoot, "plugins", "explicit-plugin")
    await mkdir(join(manifestPluginRoot, "skills"), { recursive: true })
    await mkdir(join(explicitPluginRoot, "agent"), { recursive: true })
    await writeFile(join(manifestPluginRoot, "package.json"), JSON.stringify({
      name: "manifest-plugin",
      pi: { skills: ["./skills"], packages: ["npm:manifest-pi"] },
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
        skills: ["./skills"],
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
      mockResolvedRuntimeScopeOnce(async (opts: unknown) => {
        const agentOpts = opts as {
          systemPromptAppend?: string
          environment: {
            workspaceRoot: string
            provisionRuntime?: (ctx: { runtimeBundle: unknown; signal: AbortSignal }) => Promise<void>
          }
        }
        capturedPrompt = agentOpts.systemPromptAppend
        await agentOpts.environment.provisionRuntime?.({
          runtimeBundle: {
            storageRoot: agentOpts.environment.workspaceRoot,
            provisioningAdapter: {},
            runtimeContext: { runtimeCwd: mode === "direct" ? agentOpts.environment.workspaceRoot : "/workspace" },
            workspace: {},
            sandbox: {},
          },
          signal: new AbortController().signal,
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
    mockResolvedRuntimeScopeOnce(async (opts: unknown) => {
      const agentOpts = opts as { systemPromptAppend?: string; environment: { provisionRuntime?: (ctx: { runtimeBundle: unknown; signal: AbortSignal }) => Promise<void> } }
      capturedPrompt = agentOpts.systemPromptAppend
      await agentOpts.environment.provisionRuntime?.({
        runtimeBundle: { provisioningAdapter: {}, workspace: {}, sandbox: {} },
        signal: new AbortController().signal,
      })
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
    mockResolvedRuntimeScopeOnce(async (opts: unknown) => {
      const agentOpts = opts as { systemPromptAppend?: string; environment: { provisionRuntime?: (ctx: { runtimeBundle: unknown; signal: AbortSignal }) => Promise<void> } }
      capturedPrompt = agentOpts.systemPromptAppend
      await agentOpts.environment.provisionRuntime?.({
        runtimeBundle: { provisioningAdapter: {}, workspace: {}, sandbox: {} },
        signal: new AbortController().signal,
      })
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        applyReload?: () => Promise<void>
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
    await agentOptions.applyReload?.()

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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      {
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    expect(agentServerMock.captureResolvedRuntimeScope).toHaveBeenCalledTimes(1)
    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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
      pi: { systemPrompt: "FOO_PLUGIN_PROMPT", skills: ["./skills"] },
    }), "utf8")
    agentServerMock.captureResolvedRuntimeScope.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
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

      const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
          systemPromptAppend?: string
          loadSystemPromptAppend?: () => Promise<string | undefined>
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "skills"))
      expect(await agentOptions.loadSystemPromptAppend?.()).toContain("FOO_PLUGIN_PROMPT")
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
      async resolveAuthorizedEnvironmentScope() {
        return { placementIdentity: "direct", workspaceRoot, provisioningFingerprint: "direct" }
      },
      async resolveAuthorizedAgentRuntimeScope({ agentTypeId }) {
        return {
          identity: agentTypeId,
          physicalBindingIdentity: agentTypeId,
          resourceInputDigest: agentTypeId,
          sessionNamespace: "direct",
        }
      },
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
    const makePackageResource = async (name: string, prompt: string) => {
      const packageRoot = await makeTempDir(`boring-agent-${name}-resource-`)
      await mkdir(join(packageRoot, "skills", name), { recursive: true })
      await writeFile(join(packageRoot, "skills", name, "SKILL.md"), `---\nname: ${name}-skill\ndescription: ${name}.\n---\n`)
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: `@example/${name}`,
        pi: { skills: [`skills/${name}`], systemPrompt: prompt },
      }))
      return packageRoot
    }
    const alphaPackageRoot = await makePackageResource("alpha", "ALPHA_MANIFEST_PROMPT")
    const betaPackageRoot = await makePackageResource("beta", "BETA_MANIFEST_PROMPT")
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      piResourceAuthorizedRoots: ["/plugins"],
      plugins: [
        {
          id: "alpha-plugin",
          contentDigest: "alpha-plugin-content-v1",
          agentConfigContract: { keys: ["mode"] },
          agentTools: [alphaTool],
          systemPrompt: "ALPHA_PLUGIN_PROMPT",
          piPackages: ["npm:alpha-pi"],
          extensionPaths: ["/plugins/alpha.ts"],
          packageResources: [{ packageName: "@example/alpha", packageRoot: alphaPackageRoot }],
        },
        {
          id: "beta-plugin",
          contentDigest: "beta-plugin-content-v1",
          agentConfigContract: { keys: ["mode"] },
          agentTools: [betaTool],
          systemPrompt: "BETA_PLUGIN_PROMPT",
          piPackages: ["npm:beta-pi"],
          extensionPaths: ["/plugins/beta.ts"],
          packageResources: [{ packageName: "@example/beta", packageRoot: betaPackageRoot }],
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
      const [routeOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls.at(-1) as unknown as [{
        authorizedScope: object
        extraTools?: Array<{ name: string }>
        systemPromptAppend?: string
        pi?: { packages?: unknown[]; extensionPaths?: string[] }
      }]
      const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
        resolveDirectRuntimeScopeForTest(input: { agentTypeId: string; scope: object }): Promise<{
          identity: string
          extraTools?: Array<{ name: string }>
          systemPromptAppend?: string
          loadSystemPromptAppend?: () => Promise<string | undefined>
          pi?: {
            packages?: unknown[]
            extensionPaths?: string[]
            getHotReloadableResources?: () => { additionalSkillPaths?: string[] }
          }
        }>
      }]
      const scope = routeOptions.authorizedScope
      const [alpha, beta, legacy] = await Promise.all([
        hostOptions.resolveDirectRuntimeScopeForTest({ agentTypeId: "alpha", scope }),
        hostOptions.resolveDirectRuntimeScopeForTest({ agentTypeId: "beta", scope }),
        hostOptions.resolveDirectRuntimeScopeForTest({ agentTypeId: "default", scope }),
      ])

      expect(alpha.extraTools?.map((tool) => tool.name)).toContain("alpha_tool")
      expect(alpha.extraTools?.map((tool) => tool.name)).not.toContain("beta_tool")
      expect(alpha.systemPromptAppend).toContain("ALPHA_PLUGIN_PROMPT")
      expect(alpha.systemPromptAppend).not.toContain("BETA_PLUGIN_PROMPT")
      expect(alpha.pi?.packages).toContain("npm:alpha-pi")
      expect(alpha.pi?.packages).not.toContain("npm:beta-pi")
      expect(alpha.pi?.extensionPaths).toEqual(expect.arrayContaining(["/plugins/alpha.ts"]))
      expect(alpha.pi?.extensionPaths).not.toContain("/plugins/beta.ts")
      expect(alpha.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(alphaPackageRoot, "skills", "alpha"))
      expect(alpha.pi?.getHotReloadableResources?.().additionalSkillPaths).not.toContain(join(betaPackageRoot, "skills", "beta"))
      expect(await alpha.loadSystemPromptAppend?.()).toContain("ALPHA_MANIFEST_PROMPT")
      expect(await alpha.loadSystemPromptAppend?.()).not.toContain("BETA_MANIFEST_PROMPT")
      expect(alpha.identity).toMatch(/^[a-f0-9]{64}$/)

      expect(beta.extraTools?.map((tool) => tool.name)).toContain("beta_tool")
      expect(beta.extraTools?.map((tool) => tool.name)).not.toContain("alpha_tool")
      expect(beta.systemPromptAppend).toContain("BETA_PLUGIN_PROMPT")
      expect(beta.systemPromptAppend).not.toContain("ALPHA_PLUGIN_PROMPT")
      expect(beta.pi?.packages).toContain("npm:beta-pi")
      expect(beta.pi?.packages).not.toContain("npm:alpha-pi")
      expect(beta.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(betaPackageRoot, "skills", "beta"))
      expect(beta.pi?.getHotReloadableResources?.().additionalSkillPaths).not.toContain(join(alphaPackageRoot, "skills", "alpha"))
      expect(await beta.loadSystemPromptAppend?.()).toContain("BETA_MANIFEST_PROMPT")
      expect(await beta.loadSystemPromptAppend?.()).not.toContain("ALPHA_MANIFEST_PROMPT")
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

  // M3 fix round 1 (gh-1106 slice 3): `legacyGlobalPluginAgentContributions`
  // used to key off `opts.agents === undefined`. With BORING_AGENT_FLEET=1
  // and no explicit `opts.agents`, the RESOLVED fleet has more than the
  // legacy default agent, but the option is still `undefined` — the old
  // condition wrongly kept the legacy "give every agent the global plugin
  // surface" behavior instead of scoping per agent.
  test("BORING_AGENT_FLEET=1 with no explicit opts.agents scopes plugin contributions per Agent, not the legacy global fleet", async () => {
    const workspaceRoot = await makeTempDir("boring-agent-fleet-flag-")
    const fleetRoot = await makeTempDir("boring-agent-fleet-flag-repo-")
    await mkdir(join(fleetRoot, ".agents", "personas", "one"), { recursive: true })
    await mkdir(join(fleetRoot, ".agents", "factory"), { recursive: true })
    await writeFile(
      join(fleetRoot, ".agents", "personas", "one", "package.json"),
      JSON.stringify({
        name: "@fixture/one",
        version: "1.0.0",
        private: true,
        boring: {
          agent: {
            definitionId: "fixture-one",
            version: "1.0.0",
            label: "Fixture One",
            description: "M3 regression fixture persona.",
            instructionsRef: "instructions.md",
          },
        },
      }),
      "utf8",
    )
    await writeFile(join(fleetRoot, ".agents", "personas", "one", "instructions.md"), "You are One.\n", "utf8")
    await writeFile(
      join(fleetRoot, ".agents", "factory", "fleet.yaml"),
      "seats:\n  - seat: one\n    agentTypeId: fixture-one\n    skills: []\n",
      "utf8",
    )

    const globalTool = {
      name: "global_tool",
      description: "app-global plugin tool",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [] } },
    }
    const previousFlag = process.env.BORING_AGENT_FLEET
    process.env.BORING_AGENT_FLEET = "1"
    let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined
    try {
      app = await createWorkspaceAgentServer({
        workspaceRoot,
        fleetRepositoryRoot: fleetRoot,
        logger: false,
        provisionWorkspace: false,
        externalPlugins: false,
        piResourceAuthorizedRoots: ["/plugins"],
        plugins: [{
          id: "global-plugin",
          contentDigest: "global-plugin-content-v1",
          agentTools: [globalTool],
          systemPrompt: "GLOBAL_PLUGIN_PROMPT",
        }],
        fleetCompiler: { async compile({ agents }) { return agents } },
      })

      const [routeOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls.at(-1) as unknown as [{
        authorizedScope: object
      }]
      const [hostOptions, createHostCall] = [
        agentServerMock.createAgentHost.mock.calls.at(-1)![0] as {
          agents: readonly { agentTypeId: string }[]
          resolveDirectRuntimeScopeForTest(input: { agentTypeId: string; scope: object }): Promise<{
            extraTools?: Array<{ name: string }>
            systemPromptAppend?: string
          }>
        },
        agentServerMock.createAgentHost.mock.calls.at(-1)![0] as { agents: readonly { agentTypeId: string }[] },
      ]
      // Sanity: the flag actually composed a multi-agent fleet (default +
      // the fixture seat), so `opts.agents` really was left undefined while
      // the resolved fleet was not the single-legacy-agent shape.
      expect(createHostCall.agents.map((agent) => agent.agentTypeId).sort()).toEqual(["default", "fixture-one"])

      const scope = routeOptions.authorizedScope
      // The literal `{ agentTypeId: 'default', legacyDefault: true }` fleet
      // member is a deliberate catch-all and keeps every discovered plugin's
      // resources by design (same as the "normalizes..." test's `legacy`
      // case above) — that part is unaffected by this fix.
      //
      // The actual M3 bug: a resolved fleet seat that is NOT that literal
      // legacyDefault entry (here, the fixture's own composed seat) must be
      // scoped to only its own explicitly-bound plugins — it has none bound,
      // so it must not inherit the unbound global plugin's tools/prompt via
      // the base Pi options, which `legacyGlobalPluginAgentContributions`
      // used to wrongly apply server-wide whenever `opts.agents` was
      // undefined, flag or no flag.
      const seatScope = await hostOptions.resolveDirectRuntimeScopeForTest({ agentTypeId: "fixture-one", scope })
      expect(seatScope.extraTools?.map((tool) => tool.name) ?? []).not.toContain("global_tool")
      expect(seatScope.systemPromptAppend ?? "").not.toContain("GLOBAL_PLUGIN_PROMPT")
    } finally {
      if (previousFlag === undefined) delete process.env.BORING_AGENT_FLEET
      else process.env.BORING_AGENT_FLEET = previousFlag
      if (app) await app.close()
    }
  })

  test("BORING_AGENT_FLEET boot excludes both valid and preflight-invalid packages that claim one definitionId", async () => {
    const workspaceRoot = await makeTempDir("boring-agent-fleet-conflict-")
    const fleetRoot = await makeTempDir("boring-agent-fleet-conflict-repo-")
    const personasRoot = join(fleetRoot, ".agents", "personas")
    await mkdir(join(personasRoot, "valid"), { recursive: true })
    await mkdir(join(personasRoot, "invalid"), { recursive: true })
    await mkdir(join(fleetRoot, ".agents", "factory"), { recursive: true })
    const packageJson = (name: string) => JSON.stringify({
      name,
      version: "1.0.0",
      boring: {
        agent: {
          definitionId: "fixture-conflict",
          version: "1.0.0",
          instructionsRef: "instructions.md",
        },
      },
      pi: { skills: [] },
    })
    await writeFile(join(personasRoot, "valid", "package.json"), packageJson("@fixture/valid"), "utf8")
    await writeFile(join(personasRoot, "valid", "instructions.md"), "Valid claimant.\n", "utf8")
    await writeFile(join(personasRoot, "invalid", "package.json"), packageJson("@fixture/invalid"), "utf8")
    await writeFile(
      join(fleetRoot, ".agents", "factory", "fleet.yaml"),
      "seats:\n  - seat: conflict\n    agentTypeId: fixture-conflict\n    skills: []\n",
      "utf8",
    )

    const previousFlag = process.env.BORING_AGENT_FLEET
    process.env.BORING_AGENT_FLEET = "1"
    let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined
    try {
      app = await createWorkspaceAgentServer({
        workspaceRoot,
        fleetRepositoryRoot: fleetRoot,
        logger: false,
        provisionWorkspace: false,
        externalPlugins: false,
        fleetCompiler: { async compile({ agents }) { return agents } },
      })
      const hostOptions = agentServerMock.createAgentHost.mock.calls.at(-1)![0] as {
        agents: readonly { agentTypeId: string }[]
      }
      expect(hostOptions.agents.map((agent) => agent.agentTypeId)).toEqual(["default"])
    } finally {
      if (previousFlag === undefined) delete process.env.BORING_AGENT_FLEET
      else process.env.BORING_AGENT_FLEET = previousFlag
      if (app) await app.close()
    }
  })

  test("BORING_AGENT_FLEET off: workspace host seam stays on the legacy single default agent and never probes the fleet root", async () => {
    const workspaceRoot = await makeTempDir("boring-agent-fleet-off-")
    const previousFlag = process.env.BORING_AGENT_FLEET
    delete process.env.BORING_AGENT_FLEET
    let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined
    try {
      // A fleetRepositoryRoot that does not exist: with the flag off the seam
      // must not evaluate it (no eager fleet discovery / cwd fallback) — boot
      // still yields the single legacy default agent (gh-1107 slice 1 fix
      // round: flag-off purity extended to the workspace host seam).
      app = await createWorkspaceAgentServer({
        workspaceRoot,
        fleetRepositoryRoot: "/does/not/exist/flag-off",
        logger: false,
        provisionWorkspace: false,
        externalPlugins: false,
      })
      const hostOptions = agentServerMock.createAgentHost.mock.calls.at(-1)![0] as {
        agents: readonly { agentTypeId: string; legacyDefault?: boolean }[]
      }
      expect(hostOptions.agents.map((agent) => agent.agentTypeId)).toEqual(["default"])
      expect(hostOptions.agents[0]?.legacyDefault).toBe(true)
    } finally {
      if (previousFlag === undefined) delete process.env.BORING_AGENT_FLEET
      else process.env.BORING_AGENT_FLEET = previousFlag
      if (app) await app.close()
    }
  })

  test.each([
    {
      name: "unknown plugin ID",
      plugins: [],
      binding: { name: "missing-plugin" },
      code: "AGENT_FLEET_PLUGIN_UNKNOWN",
      details: { pluginId: "missing-plugin" },
    },
    {
      name: "unknown config binding",
      plugins: [{
        id: "configured-plugin",
        contentDigest: "configured-plugin-v1",
        agentConfigContract: { keys: ["allowed"] },
      }],
      binding: { name: "configured-plugin", config: { unknown: true } },
      code: "AGENT_FLEET_CONFIG_BINDING_UNKNOWN",
      details: { pluginId: "configured-plugin", configKey: "unknown" },
    },
  ])("rejects $name during fleet compilation before creating an app Host", async ({ plugins, binding, code, details }) => {
    const createRuntime = vi.fn(async () => {
      throw new Error("runtime provisioning must not start")
    })
    const result = createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-agent-fleet-rejection-"),
      logger: false,
      runtimeModeAdapter: {
        id: "direct",
        workspaceFsCapability: "strong",
        create: createRuntime,
      } as RuntimeModeAdapter,
      externalPlugins: false,
      plugins,
      agents: [{
        agentTypeId: "configured",
        definition: { label: "Configured", instructions: "Be useful." },
        plugins: [binding],
      }],
      defaultAgentTypeId: "configured",
    })

    await expect(result).rejects.toMatchObject({
      code,
      details: { agentTypeId: "configured", ...details },
    })
    expect(createRuntime).not.toHaveBeenCalled()
    expect(agentServerMock.provisionWorkspaceRuntime).not.toHaveBeenCalled()
    expect(agentServerMock.captureResolvedRuntimeScope).not.toHaveBeenCalled()
  })

  test("defers provisioning to the Host Environment generation", async () => {
    const disposeRuntime = vi.fn(async () => {})
    const createRuntime = vi.fn(async () => ({
      provisioningAdapter: {},
      disposeRuntime,
    }))
    agentServerMock.provisionWorkspaceRuntime.mockRejectedValueOnce(new Error("initial provisioning failed"))

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("boring-agent-provisioning-failure-"),
      logger: false,
      runtimeModeAdapter: {
        id: "direct",
        workspaceFsCapability: "strong",
        create: createRuntime,
      } as unknown as RuntimeModeAdapter,
      externalPlugins: false,
    })

    expect(agentServerMock.createAgentHost).toHaveBeenCalledOnce()
    expect(createRuntime).not.toHaveBeenCalled()
    expect(agentServerMock.provisionWorkspaceRuntime).not.toHaveBeenCalled()
    const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
      scopeVerifier: { verify(scope: object): Promise<object> }
      resolveAuthorizedEnvironmentScope(input: object): Promise<{ provisionRuntime?: (input: object) => Promise<unknown> }>
    }]
    const scope = await agentServerMock.directProjections.at(-1)!.authorizeAgentRequest({
      id: "provisioning-failure", url: "/api/v1/files", headers: {}, query: {},
    })
    const claim = await hostOptions.scopeVerifier.verify(scope)
    const environment = await hostOptions.resolveAuthorizedEnvironmentScope({
      authorizedScope: scope,
      verifiedClaim: claim,
      intent: { kind: "http-route", requestId: "provisioning-failure" },
    })
    await expect(environment.provisionRuntime?.({
      runtimeBundle: { provisioningAdapter: {}, workspace: {}, sandbox: {} },
      signal: new AbortController().signal,
    })).rejects.toThrow("initial provisioning failed")
    expect(agentServerMock.provisionWorkspaceRuntime).toHaveBeenCalledOnce()
    expect(disposeRuntime).not.toHaveBeenCalled()
    await app.close()
  })

  test("runtime contribution identity is stable and covers compiler policy plus selected contribution contracts", async () => {
    const workspaceRoot = await makeTempDir("boring-agent-runtime-identity-")
    async function resolveIdentity(input: {
      policyRevision: string
      prompt: string
      toolDescription: string
      piPackage?: string
      artifactDigest?: string
      includePolicyDigest?: boolean
    }): Promise<string> {
      const app = await createWorkspaceAgentServer({
        workspaceRoot,
        logger: false,
        provisionWorkspace: false,
        externalPlugins: false,
        piResourceAuthorizedRoots: ["/plugins"],
        plugins: [{
          id: "identity-plugin",
          agentConfigContract: { keys: ["mode"] },
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
        const [routeOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls.at(-1) as unknown as [{
          authorizedScope: object
          pi?: object
          extraTools?: unknown[]
          systemPromptAppend?: string
        }]
        const [hostOptions] = agentServerMock.createAgentHost.mock.calls.at(-1) as unknown as [{
          resolveDirectRuntimeScopeForTest(input: { agentTypeId: string; scope: object }): Promise<{ identity: string }>
        }]
        const scope = routeOptions.authorizedScope
        return (await hostOptions.resolveDirectRuntimeScopeForTest({ agentTypeId: "identity-agent", scope })).identity
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
    await expect(resolveIdentity({ ...fixed, includePolicyDigest: false })).rejects.toMatchObject({
      code: "BORING_AGENT_RUNTIME_IDENTITY_INCOMPLETE",
    })

    expect(stableOne).toBe(stableTwo)
    expect(policyChanged).not.toBe(stableOne)
    expect(promptChanged).not.toBe(stableOne)
    expect(toolChanged).not.toBe(stableOne)
    expect(piChanged).not.toBe(stableOne)
    expect(artifactBytesChanged).not.toBe(stableOne)
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

    agentServerMock.captureResolvedRuntimeScope.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
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

      const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls.at(-1) as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[]; extensionPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
          loadSystemPromptAppend?: () => Promise<string | undefined>
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "agent", "skills"))
      expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(join(pluginRoot, "agent", "index.ts"))
      expect(await agentOptions.loadSystemPromptAppend?.()).toContain("GLOBAL_PLUGIN_PROMPT")
    } finally {
      await app.close()
    }
  })

  test("boringPluginFrontTargetResolver customizes plugin list payloads without changing discovery", async () => {
    const workspaceRoot = await makeTempDir("boring-front-target-resolver-workspace-")
    await writeHotPlugin(workspaceRoot, "index.ts")

    agentServerMock.captureResolvedRuntimeScope.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
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

    // Simulate /reload firing through the direct Host-owned reload candidate.
    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]
    await expect(agentOptions.applyReload?.()).resolves.toBeUndefined()

    // The exposed rebuild closure is diagnostic-only; a successful
    // re-resolve reports no diagnostics but does not return/install a graph.
    const rebuilt = await (app as unknown as { __boringRebuildPlugins: () => Promise<{ ok: boolean; diagnostics: unknown[] }> }).__boringRebuildPlugins()
    expect(rebuilt).toEqual({ ok: true, diagnostics: [] })
  })

  test("checks plugin reload availability before reload preparation", async () => {
    const getAgentReloadBlock = vi.fn()
    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-lifecycle-order-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ id: "lifecycle", getAgentReloadBlock }],
      beforeReload: async () => { throw new Error("preparation failed") },
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]
    await expect(agentOptions.applyReload?.()).rejects.toThrow("preparation failed")
    expect(getAgentReloadBlock).toHaveBeenCalledOnce()
  })

  test("blocks Agent replacement with a structured plugin reload reason", async () => {
    const getAgentReloadBlock = vi.fn(() => ({ code: "work_active", message: "Stop active work first." }))
    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-reload-block-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ id: "active-work", getAgentReloadBlock }],
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]
    await expect(agentOptions.applyReload?.()).rejects.toMatchObject({
      code: "AGENT_COMMAND_INVALID_STATE",
      message: "Stop active work first.",
      details: { blockerCode: "work_active", pluginId: "active-work" },
    })
    expect(getAgentReloadBlock).toHaveBeenCalledOnce()
  })

  test("rechecks reload blockers after asynchronous preparation", async () => {
    const getAgentReloadBlock = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ code: "work_started", message: "Work started during preparation." })
    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-reload-race-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ id: "racing-work", getAgentReloadBlock }],
    })

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]
    await expect(agentOptions.applyReload?.()).rejects.toMatchObject({
      code: "AGENT_COMMAND_INVALID_STATE",
      details: { blockerCode: "work_started", pluginId: "racing-work" },
    })
    expect(getAgentReloadBlock).toHaveBeenCalledTimes(2)
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<{ restartWarnings?: unknown[]; diagnostics?: unknown[] } | undefined> },
    ]
    const result = await agentOptions.applyReload?.()
    expect(result?.restartWarnings).toEqual([
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

    const [agentOptions] = agentServerMock.captureResolvedRuntimeScope.mock.calls[0] as unknown as [
      { applyReload?: () => Promise<void> },
    ]
    // Per-plugin rebuild failures must NOT abort the reload — diagnostics
    // surface via SSE error events + .error files, not by aborting beforeReload.
    await expect(agentOptions.applyReload?.()).resolves.not.toThrow()
  })

  test("composes a direct package resource into one atomic host snapshot without provisioning copies", async () => {
    const workspaceRoot = await makeTempDir("workspace-package-resource-")
    const packageRoot = await makeTempDir("direct-package-resource-")
    await mkdir(join(packageRoot, "skills", "authoring"), { recursive: true })
    await writeFile(join(packageRoot, "skills", "authoring", "SKILL.md"), [
      "---",
      "name: direct-authoring",
      "description: Direct package skill.",
      "---",
      "# Direct",
    ].join("\n"))
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "@example/direct-resource",
      pi: {
        skills: ["skills/authoring"],
        systemPrompt: "Use the direct-authoring skill when editing dashboards.",
      },
    }))

    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      defaults: [],
      plugins: [{
        id: "direct-resource-plugin",
        contentDigest: "direct-resource-plugin-v1",
        packageResources: [{
          packageName: "@example/direct-resource",
          packageRoot,
        }],
        systemPrompt: "Validate the direct dashboard output.",
      }],
    })

    try {
      const [runtime] = agentServerMock.captureResolvedRuntimeScope.mock.calls.at(-1) as unknown as [{
        getFilesystemBindings?(ctx: { scope: { workspaceScopeId: string; authSubjectId: string }; requestId: string }): Promise<Array<{ filesystem: string }> | undefined>
        getSkillResourceSnapshot?(ctx: { scope: { workspaceScopeId: string; authSubjectId: string }; requestId: string }): Promise<{
          generation: string
          managedSkills: Array<{ name: string; resource: { filesystem: string; path: string } }>
        } | undefined>
        pi?: {
          getHotReloadableResources?(): { additionalSkillPaths: string[] }
        }
        systemPromptAppend?: string
        loadSystemPromptAppend?(): string | undefined | Promise<string | undefined>
      }]
      const ctx = { scope: { workspaceScopeId: "default", authSubjectId: "local" }, requestId: "direct-resource-test" }
      const snapshot = await runtime.getSkillResourceSnapshot?.(ctx)
      expect(snapshot?.managedSkills).toContainEqual(expect.objectContaining({
        name: "direct-authoring",
        resource: {
          filesystem: "agent_resources",
          path: "packages/@example/direct-resource/skills/authoring/SKILL.md",
        },
      }))
      expect(JSON.stringify(snapshot)).not.toContain(packageRoot)
      expect(snapshot?.managedSkills.filter((skill) => skill.resource.path.startsWith("shared/pi-agent/"))).toEqual([])
      expect((await runtime.getFilesystemBindings?.(ctx))?.map((binding) => binding.filesystem)).toEqual(["agent_resources"])
      expect(runtime.pi?.getHotReloadableResources?.().additionalSkillPaths)
        .toContain(join(packageRoot, "skills", "authoring"))
      const prompt = [runtime.systemPromptAppend, await runtime.loadSystemPromptAppend?.()]
        .filter(Boolean)
        .join("\n\n")
      expect(prompt.match(/Use the direct-authoring skill/g)).toHaveLength(1)
      expect(prompt.match(/Validate the direct dashboard output\./g)).toHaveLength(1)
      await expect(readFile(join(workspaceRoot, ".boring-agent", "skills", "direct-authoring", "SKILL.md"), "utf8"))
        .rejects.toBeDefined()
    } finally {
      await app.close()
    }
  })

  test("a package-resource-only prebuilt plugin is not misclassified as contribution:none (identity fence)", async () => {
    const workspaceRoot = await makeTempDir("workspace-package-resource-identity-")
    const packageRoot = await makeTempDir("identity-package-resource-")
    await mkdir(join(packageRoot, "skills", "authoring"), { recursive: true })
    await writeFile(join(packageRoot, "skills", "authoring", "SKILL.md"), [
      "---",
      "name: identity-authoring",
      "description: Identity-fence package skill.",
      "---",
      "# Identity",
    ].join("\n"))
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "@example/identity-resource",
    }))

    // Only packageResources is set — no systemPrompt/agentTools/piPackages/
    // extensionPaths/skills/provisioning and no contentDigest. Before the
    // fix, pluginHasAgentRuntimeContribution ignored packageResources and
    // this plugin was classified as contribution:none, so it silently
    // skipped the "prebuilt plugin contributes Agent/runtime bindings
    // without contentDigest" identity fence instead of throwing.
    await expect(createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      defaults: [],
      plugins: [{
        id: "package-resource-only-plugin",
        packageResources: [{
          packageName: "@example/identity-resource",
          packageRoot,
        }],
      }],
    })).rejects.toThrow(AgentRuntimeIdentityError)
  })
})
