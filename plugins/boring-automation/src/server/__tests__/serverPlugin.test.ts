import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { bootstrapServer } from "@hachej/boring-workspace/server"
import { BORING_AUTOMATION_ERROR_CODES, BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
import { BORING_AUTOMATION_TOOL_NAME } from "../automationTool"
import defaultBoringAutomationServerPlugin, { createBoringAutomationServerPlugin } from "../index"

describe("boring automation server plugin", () => {
  it("wires default-export ctx.workspaceRoot into file-backed routes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-plugin-"))
    const plugin = defaultBoringAutomationServerPlugin({}, { workspaceRoot })
    expect(plugin.id).toBe(BORING_AUTOMATION_PLUGIN_ID)

    const app = Fastify()
    await app.register(plugin.routes!)
    const res = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, automations: [] })

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("contributes the tool through trusted boot-time server composition", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-tool-"))
    const plugin = createBoringAutomationServerPlugin({ workspaceRoot })
    const collection = bootstrapServer({ plugins: [plugin] })

    expect(plugin.agentTools?.map((tool) => tool.name)).toEqual([BORING_AUTOMATION_TOOL_NAME])
    expect(collection.agentTools).toEqual(plugin.agentTools)

    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("boot-time gate disables only the tool while routes remain available", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "boring-automation-disabled-tool-"))
    const plugin = createBoringAutomationServerPlugin({ workspaceRoot, agentToolEnabled: false })
    expect(plugin.agentTools).toEqual([])

    const app = Fastify()
    await app.register(plugin.routes!)
    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, automations: [] })

    await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it("hosted tool fails closed before the unbound fallback store can be queried", async () => {
    const sql = vi.fn(async () => [])
    const plugin = defaultBoringAutomationServerPlugin({}, {
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

  it("starts hosted due evaluation internally when Fastify becomes ready", async () => {
    const runDue = vi.fn(async () => ({ now: "2026-07-23T09:00:00.000Z", outcomes: [] }))
    const plugin = createBoringAutomationServerPlugin({
      store: {} as never,
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
      store: {} as never,
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

  it("exposes a shutdown participant that stops and drains the hosted scheduler", async () => {
    let resolveRun!: (value: { now: string; outcomes: [] }) => void
    const activeRun = new Promise<{ now: string; outcomes: [] }>((resolve) => { resolveRun = resolve })
    const plugin = createBoringAutomationServerPlugin({
      store: {} as never,
      hostedDueRunService: { runDue: async () => await activeRun },
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    await app.ready()

    plugin.shutdown?.begin()
    let drained = false
    const draining = plugin.shutdown?.drain().then(() => { drained = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(drained).toBe(false)

    resolveRun({ now: "2026-07-23T09:00:00.000Z", outcomes: [] })
    await draining
    expect(drained).toBe(true)
    await app.close()
  })

  it("allows hosted composition to opt out when an external scheduler owns wake-ups", async () => {
    const runDue = vi.fn(async () => ({ now: "2026-07-23T09:00:00.000Z", outcomes: [] }))
    const plugin = createBoringAutomationServerPlugin({
      store: {} as never,
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
    const plugin = defaultBoringAutomationServerPlugin({}, {
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
    expect(() => createBoringAutomationServerPlugin()).toThrow(/requires workspaceRoot/)
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
      store: {} as never,
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
