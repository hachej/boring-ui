import Fastify from "fastify"
import { afterEach, describe, expect, test } from "vitest"
import { formatSelfTestResult, runPluginSelfTest } from "../server/testPlugin"

const apps: Array<{ close: () => Promise<unknown> }> = []

async function startApp(setup: (app: ReturnType<typeof Fastify>) => void | Promise<void>) {
  const app = Fastify({ logger: false })
  await setup(app)
  await app.listen({ port: 0, host: "127.0.0.1" })
  apps.push(app)
  const address = app.server.address()
  if (!address || typeof address === "string") throw new Error("missing test address")
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

describe("runPluginSelfTest", () => {
  test("returns no-browser-connected when the UI has not connected", async () => {
    let openPanelCalls = 0
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.post("/api/v1/ui/commands", async () => {
        openPanelCalls += 1
        return { seq: openPanelCalls, status: "ok" }
      })
      app.get("/api/v1/ui/panels/status", async () => ({ ok: true, connected: false, state: "no-browser-connected" }))
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 1600 })
    expect(openPanelCalls).toBeGreaterThan(0)
    expect(result.ok).toBe(false)
    expect(result.pane.state).toBe("no-browser-connected")
  })

  test("opens the self-test panel before concluding no browser is connected", async () => {
    let openPanelCalls = 0
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.post("/api/v1/ui/commands", async () => {
        openPanelCalls += 1
        return { seq: openPanelCalls, status: "ok" }
      })
      app.get("/api/v1/ui/panels/status", async () => openPanelCalls === 0
        ? { ok: true, connected: false, state: "no-browser-connected" }
        : {
            ok: true,
            connected: true,
            state: "ready",
            status: {
              pluginId: "demo",
              panelId: "demo.panel",
              panelInstanceId: "self-test:demo:demo.panel",
              state: "ready",
              reportedAt: new Date().toISOString(),
            },
          })
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 1000 })
    expect(openPanelCalls).toBeGreaterThan(0)
    expect(result.ok).toBe(true)
    expect(result.pane).toMatchObject({ state: "ready", found: true })
  })

  test("ignores stale pane status from a previous self-test", async () => {
    let opened = false
    const staleReportedAt = new Date(Date.now() - 60_000).toISOString()
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.post("/api/v1/ui/commands", async () => {
        opened = true
        return { seq: 1, status: "ok" }
      })
      app.get("/api/v1/ui/panels/status", async () => opened
        ? {
            ok: true,
            connected: true,
            state: "ready",
            status: {
              pluginId: "demo",
              panelId: "demo.panel",
              panelInstanceId: "self-test:demo:demo.panel",
              state: "ready",
              reportedAt: new Date().toISOString(),
            },
          }
        : {
            ok: true,
            connected: true,
            state: "ready",
            status: {
              pluginId: "demo",
              panelId: "demo.panel",
              panelInstanceId: "self-test:demo:demo.panel",
              state: "ready",
              reportedAt: staleReportedAt,
            },
          })
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 1000 })
    expect(opened).toBe(true)
    expect(result.ok).toBe(true)
  })

  test("fails with the captured front import error reported by the browser", async () => {
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true, diagnostics: [] }))
      // Server scan is green, but the browser reported the front module failed
      // to evaluate — the self-test must surface it and fail.
      app.get("/api/v1/runtime-plugin-diagnostics", async () => ({
        workspaceId: "ws",
        plugins: [
          {
            id: "demo",
            serverLoadedRevision: 3,
            frontError: { pluginId: "demo", revision: 3, message: "exports is not defined", reportedAt: Date.now() },
          },
        ],
      }))
      app.post("/api/v1/ui/commands", async () => ({ seq: 1, status: "ok" }))
      // Pane never mounts (the front import failed), so it stays missing.
      app.get("/api/v1/ui/panels/status", async () => ({ ok: true, connected: true, state: "missing" }))
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 800 })
    expect(result.ok).toBe(false)
    expect(result.revision).toBe(3)
    expect(result.reloadErrors).toContainEqual(
      expect.objectContaining({ code: "PLUGIN_FRONT_ERROR", message: "exports is not defined" }),
    )
    const formatted = formatSelfTestResult(result)
    expect(formatted).toContain("FAIL demo")
    expect(formatted).toContain("PLUGIN_FRONT_ERROR: exports is not defined")
  })

  test("opens the panel and returns ready status", async () => {
    let opened = false
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.post("/api/v1/ui/commands", async () => {
        opened = true
        return { seq: 1, status: "ok" }
      })
      app.get("/api/v1/ui/panels/status", async () => opened
        ? {
            ok: true,
            connected: true,
            state: "ready",
            status: {
              pluginId: "demo",
              panelId: "demo.panel",
              panelInstanceId: "self-test:demo:demo.panel",
              state: "ready",
              revision: 2,
              reportedAt: new Date().toISOString(),
            },
          }
        : { ok: true, connected: true, state: "missing" })
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 1000 })
    expect(result.ok).toBe(true)
    expect(result.revision).toBe(2)
    expect(result.pane).toMatchObject({ state: "ready", found: true })
  })
})
