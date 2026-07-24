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

  it("binds hosted routes to the actor workspace before selecting prompt metadata", async () => {
    const sql = vi.fn(async () => [])
    const workspace = { root: "/workspace", runtimeContext: {} } as never
    const resolveWithWorkspace = vi.fn(async () => ({ workspace, dispatcher: {} }))
    const plugin = defaultBoringAutomationServerPlugin({}, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: sql as never,
        workspaceAgentDispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never,
        actorResolver: vi.fn(() => ({ workspaceId: "workspace-1", userId: "user-1" })),
        actorVerifier: vi.fn(() => true),
      },
    })
    const app = Fastify()
    await app.register(plugin.routes!)

    const response = await app.inject({ method: "GET", url: `${BORING_AUTOMATION_ROUTE_PREFIX}/automations` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, automations: [] })
    expect(resolveWithWorkspace).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", userId: "user-1" },
      { request: expect.any(Object) },
    )
    expect(sql).toHaveBeenCalled()
    await app.close()
  })

  it("defers hosted prompt migration until onReady and blocks readiness on failure", async () => {
    const row = {
      id: "automation-1",
      workspace_id: "workspace-1",
      owner_user_id: "user-1",
      prompt: "legacy prompt",
    }
    const sql = vi.fn(async () => [row])
    const files = new Map<string, string>()
    let compositionReady = false
    const resolveWithWorkspace = vi.fn(async () => {
      expect(compositionReady).toBe(true)
      return {
        dispatcher: {},
        workspace: {
          root: "/workspace",
          runtimeContext: {},
          async mkdir() {},
          async readFile(path: string) {
            if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" })
            return files.get(path)!
          },
          async writeFile(path: string, content: string) { files.set(path, content) },
        },
      }
    })
    const plugin = defaultBoringAutomationServerPlugin({}, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: sql as never,
        workspaceAgentDispatcherResolver: { resolve: vi.fn(), resolveWithWorkspace } as never,
        actorResolver: vi.fn(),
        actorVerifier: vi.fn(() => true),
      },
    })
    const app = Fastify()
    await app.register(plugin.routes!)
    expect(resolveWithWorkspace).not.toHaveBeenCalled()

    compositionReady = true
    await app.ready()

    expect(resolveWithWorkspace).toHaveBeenCalledOnce()
    expect(files.get(".agents/automation/automation-1.md")).toBe("legacy prompt")
    await app.close()

    const failingPlugin = defaultBoringAutomationServerPlugin({}, {
      workspaceRoot: "/hosted/workspace",
      trusted: {
        sql: (vi.fn(async () => [row])) as never,
        workspaceAgentDispatcherResolver: {
          resolve: vi.fn(),
          resolveWithWorkspace: vi.fn(async () => { throw new Error("migration failed") }),
        } as never,
        actorResolver: vi.fn(),
        actorVerifier: vi.fn(() => true),
      },
    })
    const failingApp = Fastify()
    await failingApp.register(failingPlugin.routes!)
    await expect(failingApp.ready()).rejects.toThrow("migration failed")
    await failingApp.close()
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
