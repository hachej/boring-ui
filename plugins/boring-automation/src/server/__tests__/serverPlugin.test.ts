import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { bootstrapServer } from "@hachej/boring-workspace/server"
import { BORING_AUTOMATION_ERROR_CODES, BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { BORING_AUTOMATION_TOOL_NAME } from "../automationTool"
import defaultBoringAutomationServerPlugin, { createAutomationSessionController, createBoringAutomationServerPlugin } from "../index"

function seedReadyStore() {
  return {
    readSeedManifest: async () => null,
    ensureSeededAutomation: async () => null,
    findExistingSeedKeys: async () => [],
    removeSeededAutomationIfIdle: async () => true,
  } as never
}

describe("boring automation server plugin", () => {
  it("wires default-export ctx.workspaceRoot into file-backed routes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-plugin-"))
    const plugin = defaultBoringAutomationServerPlugin(undefined, { workspaceRoot, agentTypeId: "selected-agent" })
    expect(plugin.id).toBe(BORING_AUTOMATION_PLUGIN_ID)

    const app = Fastify()
    await app.register(plugin.routes!)
    const res = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, automations: [] })

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("seeds checked-in standing records during workspace boot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-seeded-plugin-"))
    const promptRoot = join(workspaceRoot, ".agents", "automation")
    await mkdir(promptRoot, { recursive: true })
    await writeFile(join(promptRoot, "manifest.json"), JSON.stringify({ automations: [
      { key: "orchestrator-tick", title: "orchestrator-tick", enabled: true, cron: "*/10 * * * *", timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-orchestrator", promptRef: ".agents/automation/orchestrator-tick.md" },
      ...[1, 2, 3].map((slot) => ({ key: `worker-slot-${slot}`, title: `worker-slot-${slot}`, enabled: true, cron: null, timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker", promptRef: ".agents/automation/worker-slot.md" })),
      { key: "triage", title: "triage", enabled: true, cron: null, timezone: "UTC", model: "openai-codex:gpt-5.6-sol", agentTypeId: "boring-worker", promptRef: ".agents/automation/triage-slot.md" },
    ] }), "utf8")
    await Promise.all([
      writeFile(join(promptRoot, "orchestrator-tick.md"), "orchestrator prompt", "utf8"),
      writeFile(join(promptRoot, "worker-slot.md"), "worker prompt", "utf8"),
      writeFile(join(promptRoot, "triage-slot.md"), "triage prompt", "utf8"),
    ])

    const app = Fastify()
    await app.register(defaultBoringAutomationServerPlugin(undefined, { workspaceRoot, agentTypeId: "selected-agent" }).routes!)
    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })

    expect(response.statusCode).toBe(200)
    expect(response.json().automations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "orchestrator-tick", cron: "*/10 * * * *" }),
      expect.objectContaining({ id: "worker-slot-1", cron: null }),
      expect.objectContaining({ id: "worker-slot-2", cron: null }),
      expect.objectContaining({ id: "worker-slot-3", cron: null }),
      expect.objectContaining({ id: "triage", cron: null }),
    ]))
    expect(response.json().automations).toHaveLength(5)

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("seeds exactly the host-injected generic records during workspace boot", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-injected-seed-plugin-"))
    const promptRoot = join(workspaceRoot, ".agents", "automation")
    await mkdir(promptRoot, { recursive: true })
    await writeFile(join(promptRoot, "triage-slot.md"), "triage prompt", "utf8")

    const app = Fastify()
    await app.register(createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      workspaceRoot,
      additionalSeeds: [{
        key: "triage",
        title: "triage",
        enabled: true,
        cron: null,
        timezone: "UTC",
        model: "openai-codex:gpt-5.6-sol",
        agentTypeId: "boring-worker",
        promptRef: ".agents/automation/triage-slot.md",
      }],
    }).routes!)
    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })

    expect(response.statusCode).toBe(200)
    expect(response.json().automations).toEqual([
      expect.objectContaining({ id: "triage", agentTypeId: "boring-worker", cron: null }),
    ])

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("contributes the tool through trusted boot-time server composition", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-tool-"))
    const plugin = createBoringAutomationServerPlugin({ agentTypeId: "selected-agent", workspaceRoot })
    const collection = bootstrapServer({ plugins: [plugin] })

    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual([BORING_AUTOMATION_TOOL_NAME])
    expect(collection.agentTools).toEqual(plugin.agentTools)

    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("boot-time gate disables only the tool while routes remain available", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-disabled-tool-"))
    const plugin = createBoringAutomationServerPlugin({ agentTypeId: "selected-agent", workspaceRoot, agentToolEnabled: false })
    expect(plugin.agentTools).toEqual([])

    const app = Fastify()
    await app.register(plugin.routes!)
    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, automations: [] })

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("binds hosted routes to the actor workspace before selecting prompt metadata", async () => {
    const sql = vi.fn(async () => [])
    const workspace = {
      root: "/workspace",
      runtimeContext: {},
      async readFile() { throw Object.assign(new Error("missing"), { code: "ENOENT" }) },
    } as never
    const runWithWorkspaceAgent = vi.fn(async (_input, run) => run({
      workspace,
      signal: new AbortController().signal,
      async dispatch() { throw new Error("unexpected dispatch") },
      async interrupt() { return { accepted: true, cursor: 0 } },
      async stop() { return { accepted: true, cursor: 0, stopped: true, clearedQueue: [] } },
    }))
    const plugin = defaultBoringAutomationServerPlugin({ agentTypeId: "selected-agent" }, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: sql as never,
        workspaceAgentDispatcherResolver: { resolve: vi.fn(), runWithWorkspaceAgent } as never,
        actorResolver: vi.fn(() => ({ workspaceId: "workspace-1", userId: "user-1" })),
        actorVerifier: vi.fn(() => true),
      },
    })
    const app = Fastify()
    await app.register(plugin.routes!)

    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, automations: [] })
    expect(runWithWorkspaceAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypeId: "selected-agent",
        context: { workspaceId: "workspace-1", userId: "user-1" },
        request: expect.any(Object),
        requestId: expect.any(String),
      }),
      expect.any(Function),
    )
    expect(sql).toHaveBeenCalled()
    await app.close()
  })

  it("hosted tool fails closed before the unbound fallback store can be queried", async () => {
    const sql = vi.fn(async () => [])
    const plugin = defaultBoringAutomationServerPlugin({ agentTypeId: "selected-agent" }, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: sql as never,
        workspaceAgentDispatcherResolver: { resolve: vi.fn() } as never,
        actorResolver: vi.fn(),
        actorVerifier: vi.fn(() => true),
      },
    })
    const tool = plugin.agentTools?.[0]
    expect(tool?.name).toBe(BORING_AUTOMATION_TOOL_NAME)

    const result = await tool!.execute(
      { operation: "list" },
      { abortSignal: new AbortController().signal, toolCallId: "call-1", workspaceId: "workspace-1" } as never,
    )

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE })
    expect(sql).not.toHaveBeenCalled()
  })

  it("fails with a typed automation error when the dispatcher resolver skips its binding callback", async () => {
    const controller = createAutomationSessionController({
      runWithWorkspaceAgent: vi.fn(async () => undefined),
    } as never, { workspaceId: "workspace-1", userId: "user-1" })

    await expect(controller.list("boring-worker")).rejects.toMatchObject({
      code: BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE,
    })
  })

  it("accepts a binding callback whose session operation returns void", async () => {
    const sendIfIdle = vi.fn(async () => undefined)
    const controller = createAutomationSessionController({
      runWithWorkspaceAgent: vi.fn(async (_input, run) => await run({ sendIfIdle } as never)),
    } as never, { workspaceId: "workspace-1", userId: "user-1" })

    await expect(controller.nudge("boring-worker", "session-1", "Continue", "request-1")).resolves.toBeUndefined()
    expect(sendIfIdle).toHaveBeenCalledWith("session-1", "Continue", "request-1")
  })

  it("paginates the complete Agent session inventory", async () => {
    const listSessions = vi.fn(async (_limit: number, cursor?: string) => cursor
      ? { sessions: [{ ref: { agentTypeId: "boring-worker", sessionId: "session-2" } }], nextCursor: undefined }
      : { sessions: [{ ref: { agentTypeId: "boring-worker", sessionId: "session-1" } }], nextCursor: "next" })
    const controller = createAutomationSessionController({
      runWithWorkspaceAgent: vi.fn(async (_input, run) => await run({ listSessions } as never)),
    } as never, { workspaceId: "workspace-1", userId: "user-1" })

    await expect(controller.list("boring-worker")).resolves.toEqual([
      expect.objectContaining({ ref: { agentTypeId: "boring-worker", sessionId: "session-1" } }),
      expect.objectContaining({ ref: { agentTypeId: "boring-worker", sessionId: "session-2" } }),
    ])
    expect(listSessions).toHaveBeenNthCalledWith(1, 100, undefined)
    expect(listSessions).toHaveBeenNthCalledWith(2, 100, "next")
  })

  it("starts hosted due evaluation internally when Fastify becomes ready", async () => {
    const runDue = vi.fn(async () => ({ now: "2026-07-23T09:00:00.000Z", outcomes: [] }))
    const plugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      hostedDueRunService: { runDue },
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    await app.ready()

    expect(runDue).toHaveBeenCalledOnce()
    expect(runDue).toHaveBeenCalledWith()
    await app.close()
  })

  it("shares one due evaluation between the internal tick and hosted endpoint", async () => {
    let resolveRun!: (value: { now: string; outcomes: [] }) => void
    const activeRun = new Promise<{ now: string; outcomes: [] }>((resolve) => { resolveRun = resolve })
    const runDue = vi.fn(async () => await activeRun)
    const plugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      hostedDueRunService: { runDue },
      hostedTriggerToken: "trigger-secret",
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    await app.ready()

    const endpointResponse = app.inject({
      method: "POST",
      url: `${BORING_AUTOMATION_ROUTE_PREFIX}/due/hosted`,
      headers: { authorization: "Bearer trigger-secret" },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(runDue).toHaveBeenCalledOnce()
    expect(runDue).toHaveBeenCalledWith()

    resolveRun({ now: "2026-07-23T09:00:00.000Z", outcomes: [] })
    expect((await endpointResponse).statusCode).toBe(200)
    await app.close()
  })

  it("stops timer admission without delaying close for an active durable run", async () => {
    let resolveRun!: (value: { now: string; outcomes: [] }) => void
    const activeRun = new Promise<{ now: string; outcomes: [] }>((resolve) => { resolveRun = resolve })
    const plugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      hostedDueRunService: { runDue: async () => await activeRun },
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    await app.ready()
    await new Promise<void>((resolve) => setImmediate(resolve))

    await expect(app.close()).resolves.toBeUndefined()
    resolveRun({ now: "2026-07-23T09:00:00.000Z", outcomes: [] })
    await new Promise<void>((resolve) => setImmediate(resolve))
  })

  it("leaves a caller-owned event bus open and closes a plugin-owned bus", async () => {
    const callerClose = vi.fn(async () => {})
    const callerPlugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      eventBus: { publish: vi.fn(), subscribe: vi.fn(), close: callerClose } as never,
    })
    const callerApp = Fastify()
    await callerApp.register(callerPlugin.routes!)
    await callerApp.close()
    expect(callerClose).not.toHaveBeenCalled()

    const pluginClose = vi.fn(async () => {})
    const ownedPlugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      eventBus: { publish: vi.fn(), subscribe: vi.fn(), close: pluginClose } as never,
      eventBusOwner: "plugin",
    })
    const ownedApp = Fastify()
    await ownedApp.register(ownedPlugin.routes!)
    await ownedApp.close()
    expect(pluginClose).toHaveBeenCalledOnce()
  })

  it("allows hosted composition to opt out when an external scheduler owns wake-ups", async () => {
    const runDue = vi.fn(async () => ({ now: "2026-07-23T09:00:00.000Z", outcomes: [] }))
    const plugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      hostedDueRunService: { runDue },
      hostedSchedulerEnabled: false,
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    await app.ready()

    expect(runDue).not.toHaveBeenCalled()
    await app.close()
  })

  it("honors the hosted scheduler environment opt-out in default composition", async () => {
    vi.stubEnv("BORING_AUTOMATION_INTERNAL_SCHEDULER", "false")
    const sql = vi.fn(async () => [])
    const plugin = defaultBoringAutomationServerPlugin({ agentTypeId: "selected-agent" }, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: sql as never,
        workspaceAgentDispatcherResolver: { resolve: vi.fn() } as never,
        actorResolver: vi.fn(),
        actorVerifier: vi.fn(() => true),
      },
    })
    const app = Fastify()
    try {
      await app.register(plugin.routes!)
      await app.ready()
      expect(sql).not.toHaveBeenCalled()
    } finally {
      await app.close()
      vi.unstubAllEnvs()
    }
  })

  it("requires workspaceRoot when no store is provided", () => {
    expect(() => createBoringAutomationServerPlugin({ agentTypeId: "selected-agent" })).toThrow(/requires workspaceRoot/)
  })

  it("fails scoped actor resolution before selecting an automation store", async () => {
    const actorResolver = vi.fn(() => {
      throw Object.assign(new Error("AGENT_HOST_SCOPE_VIOLATION"), {
        status: 421,
        code: "AGENT_HOST_SCOPE_VIOLATION",
      })
    })
    const storeForRequest = vi.fn()
    const plugin = createBoringAutomationServerPlugin({
      agentTypeId: "selected-agent",
      store: seedReadyStore(),
      actorResolver,
      storeForRequest,
    })
    const app = Fastify()
    app.setErrorHandler((error, _request, reply) => {
      const status = (error as { status?: number }).status ?? 500
      return reply.code(status).send({ code: (error as { code?: string }).code })
    })
    await app.register(plugin.routes!)

    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(response.statusCode).toBe(421)
    expect(response.json()).toEqual({ code: "AGENT_HOST_SCOPE_VIOLATION" })
    expect(actorResolver).toHaveBeenCalledOnce()
    expect(storeForRequest).not.toHaveBeenCalled()
    await app.close()
  })
})
