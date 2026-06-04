import Fastify from "fastify"
import { access, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "vitest"
import { runPluginSelfTest } from "../server/testPlugin"

const apps: Array<{ close: () => Promise<unknown> }> = []
const tempDirs: string[] = []

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
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

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

  test("saves status artifact on failure when browser capture fails", async () => {
    const url = await startApp((app) => {
      app.post("/api/v1/agent/reload", async () => ({ ok: true }))
      app.get("/api/v1/ui/panels/status", async () => ({ ok: true, connected: true, state: "error", status: {
        pluginId: "demo",
        panelId: "demo.panel",
        panelInstanceId: "self-test:demo:demo.panel",
        state: "error",
        error: { code: "PLUGIN_PANEL_RENDER_ERROR", message: "boom" },
        reportedAt: new Date().toISOString(),
      } }))
    })

    const artifactsDir = await tempDir("boring-plugin-artifacts-")
    const result = await runPluginSelfTest({ pluginId: "demo", url, timeoutMs: 100, artifactsDir })
    expect(result.ok).toBe(false)
    expect(result.artifacts?.attempted).toBe(true)
    expect(result.artifacts?.files?.statusJson).toBeTruthy()
    await expect(access(result.artifacts!.files!.statusJson!)).resolves.toBeUndefined()
  })
})
