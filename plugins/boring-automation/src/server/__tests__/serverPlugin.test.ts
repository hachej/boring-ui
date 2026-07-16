import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_PLUGIN_ID, BORING_AUTOMATION_ROUTE_PREFIX } from "../../shared"
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
