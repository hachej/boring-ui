import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
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
})
