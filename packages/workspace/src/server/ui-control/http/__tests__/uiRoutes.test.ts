import Fastify from "fastify"
import { describe, expect, test, vi } from "vitest"
import { uiRoutes } from "../uiRoutes"
import { createInMemoryBridge } from "../../../bridge/createInMemoryBridge"
import { createPaneRenderStatusStore } from "../../panelStatus/paneRenderStatusStore"
import type { WorkspaceBridge } from "../../../../shared/ui-bridge"

describe("uiRoutes", () => {
  test("getBridge scopes UI state by request", async () => {
    const app = Fastify({ logger: false })
    const bridges = new Map<string, WorkspaceBridge>()
    const getBridge = (workspaceId: string): WorkspaceBridge => {
      let bridge = bridges.get(workspaceId)
      if (!bridge) {
        bridge = createInMemoryBridge()
        bridges.set(workspaceId, bridge)
      }
      return bridge
    }

    await app.register(uiRoutes, {
      getBridge: (request) => {
        const query = request.query as Record<string, string | undefined>
        return getBridge(query.workspaceId ?? "default")
      },
    })
    await app.ready()

    const putA = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state?workspaceId=a",
      payload: { state: { activeFile: "a.ts" }, causedBy: "user" },
    })
    expect(putA.statusCode).toBe(204)

    const putB = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state?workspaceId=b",
      payload: { state: { activeFile: "b.ts" }, causedBy: "user" },
    })
    expect(putB.statusCode).toBe(204)

    const stateA = await app.inject({
      method: "GET",
      url: "/api/v1/ui/state?workspaceId=a",
    })
    const stateB = await app.inject({
      method: "GET",
      url: "/api/v1/ui/state?workspaceId=b",
    })

    expect(stateA.json()).toEqual({ activeFile: "a.ts" })
    expect(stateB.json()).toEqual({ activeFile: "b.ts" })

    await app.close()
  })

  test("panel status route reports browser liveness and latest pane state", async () => {
    const app = Fastify({ logger: false })
    const bridge = createInMemoryBridge()
    await app.register(uiRoutes, { bridge })
    await app.ready()

    const disconnected = await app.inject({
      method: "GET",
      url: "/api/v1/ui/panels/status?panelInstanceId=self-test:demo:demo.panel&pluginId=demo&panelId=demo.panel",
    })
    expect(disconnected.json()).toMatchObject({ state: "no-browser-connected", connected: false })

    await app.inject({ method: "GET", url: "/api/v1/ui/state" })
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/ui/panels/status?panelInstanceId=self-test:demo:demo.panel&pluginId=demo&panelId=demo.panel",
    })
    expect(missing.json()).toMatchObject({ state: "missing", connected: true })

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/panels/status",
      payload: {
        pluginId: "demo",
        panelId: "demo.panel",
        panelInstanceId: "self-test:demo:demo.panel",
        state: "ready",
        revision: 3,
      },
    })
    expect(put.statusCode).toBe(200)
    const malformedWorkspace = await app.inject({ method: "PUT", url: "/api/v1/ui/panels/status", payload: { pluginId: "demo", panelId: "demo.panel", panelInstanceId: "bad", state: "ready", workspaceId: 42 } })
    expect(malformedWorkspace.statusCode).toBe(400)

    const ready = await app.inject({
      method: "GET",
      url: "/api/v1/ui/panels/status?panelInstanceId=self-test:demo:demo.panel&pluginId=demo&panelId=demo.panel",
    })
    expect(ready.json()).toMatchObject({
      state: "ready",
      connected: true,
      status: { pluginId: "demo", panelId: "demo.panel", revision: 3 },
    })

    await app.close()
  })

  test("panel status presents its body workspace before recording scoped status", async () => {
    const app = Fastify({ logger: false })
    app.addHook("onRequest", async (request) => { ;(request as typeof request & { requestScope?: unknown }).requestScope = { workspaceId: "workspace-1" } })
    const paneStatusStore = createPaneRenderStatusStore()
    const getWorkspaceId = vi.fn(async (_request, presentedWorkspaceId?: unknown) => {
      if (presentedWorkspaceId !== undefined && presentedWorkspaceId !== "workspace-1") {
        throw Object.assign(new Error("AGENT_HOST_SCOPE_VIOLATION"), { statusCode: 421, code: "AGENT_HOST_SCOPE_VIOLATION" })
      }
      return "workspace-1"
    })
    app.setErrorHandler((error, _request, reply) => {
      const scopedError = error as unknown as { statusCode?: number; code?: string }
      return reply.code(scopedError.statusCode ?? 500).send({ code: scopedError.code })
    })
    await app.register(uiRoutes, { bridge: createInMemoryBridge(), getWorkspaceId, paneStatusStore })

    const payload = { workspaceId: "workspace-2", pluginId: "demo", panelId: "demo.panel", panelInstanceId: "panel-1", state: "ready" }
    for (const workspaceId of ["workspace-2", "../workspace-1", 42, null, []]) {
      const rejected = await app.inject({ method: "PUT", url: "/api/v1/ui/panels/status", payload: { ...payload, workspaceId } })
      expect(rejected.statusCode).toBe(421)
      expect(rejected.json()).toEqual({ code: "AGENT_HOST_SCOPE_VIOLATION" })
    }
    expect(paneStatusStore.get({ workspaceId: "workspace-1", pluginId: "demo", panelId: "demo.panel", panelInstanceId: "panel-1" })).toBeUndefined()
    expect(paneStatusStore.get({ workspaceId: "workspace-2", pluginId: "demo", panelId: "demo.panel", panelInstanceId: "panel-1" })).toBeUndefined()

    const matching = await app.inject({ method: "PUT", url: "/api/v1/ui/panels/status", payload: { ...payload, workspaceId: "workspace-1" } })
    expect(matching.statusCode).toBe(200)
    expect(matching.json().status).toMatchObject({ workspaceId: "workspace-1", state: "ready" })
    expect(getWorkspaceId).toHaveBeenCalledWith(expect.anything(), "workspace-2")
    expect(getWorkspaceId).toHaveBeenCalledWith(expect.anything(), "workspace-1")
    await app.close()
  })

  test("posting UI commands does not count as browser liveness", async () => {
    const app = Fastify({ logger: false })
    const bridge = createInMemoryBridge()
    await app.register(uiRoutes, { bridge })
    await app.ready()

    const post = await app.inject({
      method: "POST",
      url: "/api/v1/ui/commands",
      payload: { kind: "openPanel", params: { id: "p", component: "demo.panel" } },
    })
    expect(post.statusCode).toBe(200)

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/ui/panels/status?panelInstanceId=self-test:demo:demo.panel&pluginId=demo&panelId=demo.panel",
    })
    expect(status.json()).toMatchObject({ state: "no-browser-connected", connected: false })
    await app.close()
  })

  test("PUT /ui/state merges with server-published slots", async () => {
    const app = Fastify({ logger: false })
    const bridge = createInMemoryBridge()
    await bridge.setState({ "questions.pending": { question: { questionId: "q1" } }, staleBrowserKey: true })
    await app.register(uiRoutes, { bridge, preserveStateKeys: ["questions.pending"] })
    await app.ready()

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ui/state",
      payload: { state: { activeFile: "a.ts" }, causedBy: "user" },
    })
    expect(put.statusCode).toBe(204)
    await expect(bridge.getState()).resolves.toMatchObject({
      "questions.pending": { question: { questionId: "q1" } },
      activeFile: "a.ts",
    })
    expect((await bridge.getState())?.staleBrowserKey).toBeUndefined()
    await app.close()
  })
})
