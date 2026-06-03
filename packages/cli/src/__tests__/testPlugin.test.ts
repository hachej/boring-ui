import Fastify from "fastify"
import { afterEach, describe, expect, test } from "vitest"
import { runPluginSelfTest } from "../server/testPlugin"

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
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.get("/api/v1/ui/panels/status", async () => ({ ok: true, connected: false, state: "no-browser-connected" }))
    })

    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 100 })
    expect(result.ok).toBe(false)
    expect(result.pane.state).toBe("no-browser-connected")
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
