import Fastify from "fastify"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { BoringPluginAssetManager } from "../agentPlugins/manager"
import { boringPluginRoutes } from "../agentPlugins/routes"
import { preflightBoringPlugins, readBoringPlugins } from "../agentPlugins/scan"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writePlugin(root: string, body?: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await mkdir(join(root, "server"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "boring-plugin-test",
    version: "1.0.0",
    boring: {
      front: "./front/index.tsx",
      label: "Test",
      panels: [{ id: "test-panel", title: "Test Panel" }],
      systemPrompt: "Test plugin context",
    },
  }), "utf8")
  await writeFile(join(root, "front", "index.tsx"), "export default () => {}\n", "utf8")
  await writeFile(join(root, "server", "index.js"), body ?? `
export default function(api) {
  api.get('/ping', async () => ({ ok: true }))
}
`, "utf8")
}

describe("boring agent plugin assets", () => {
  test("scans package manifests with boring fields", async () => {
    const root = await tmp("boring-plugin-scan-")
    await writePlugin(root)

    expect(preflightBoringPlugins([root]).ok).toBe(true)
    const plugins = readBoringPlugins([root])
    expect(plugins).toHaveLength(1)
    expect(plugins[0].id).toBe("boring-plugin-test")
    expect(plugins[0].frontUrl).toContain("/@fs/")
    expect(plugins[0].serverPath).toBe(join(root, "server", "index.js"))
  })

  test("loads server routes, emits load events, and dispatches hot routes", async () => {
    const root = await tmp("boring-plugin-manager-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })
    const events: string[] = []
    manager.subscribe((event) => events.push(event.type))

    const result = await manager.load()
    expect(result.loaded[0].revision).toBe(1)
    expect(events).toEqual(["boring.plugin.load"])
    const unchanged = await manager.load()
    expect(unchanged.events).toEqual([])
    expect(manager.list()[0].revision).toBe(1)

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const list = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(list.json()[0].id).toBe("boring-plugin-test")

      const ping = await app.inject({ method: "GET", url: "/api/boring-plugins/boring-plugin-test/ping" })
      expect(ping.json()).toEqual({ ok: true })

      await writePlugin(root, `
export default function(api) {
  api.get('/ping', async () => ({ ok: 'updated' }))
}
`)
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(200)
      expect(reload.json().plugins[0].revision).toBe(2)
      const ping2 = await app.inject({ method: "GET", url: "/api/boring-plugins/boring-plugin-test/ping" })
      expect(ping2.json()).toEqual({ ok: "updated" })
    } finally {
      await app.close()
    }
  })

  test("queues one successor load when reload is requested during an inflight load", async () => {
    const root = await tmp("boring-plugin-queued-")
    await writePlugin(root, `
await new Promise((resolve) => setTimeout(resolve, 25))
export default function(api) {
  api.get('/ping', async () => ({ ok: 'slow' }))
}
`)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })

    const first = manager.load()
    await writePlugin(root, `
export default function(api) {
  api.get('/ping', async () => ({ ok: 'queued' }))
}
`)
    const second = manager.load()
    const result = await second
    await first

    expect(result.loaded[0].revision).toBe(2)
    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const ping = await app.inject({ method: "GET", url: "/api/boring-plugins/boring-plugin-test/ping" })
      expect(ping.json()).toEqual({ ok: "queued" })
    } finally {
      await app.close()
    }
  })

  test("reports full reload errors and keeps previous server handlers live", async () => {
    const root = await tmp("boring-plugin-error-rollback-")
    await writePlugin(root, `
export default function(api) {
  api.get('/ping', async () => ({ ok: 'stable' }))
}
`)
    const errorRoot = join(root, ".pi", "extensions")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot })
    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })

    try {
      const first = await manager.load()
      expect(first.errors).toEqual([])
      const ping = await app.inject({ method: "GET", url: "/api/boring-plugins/boring-plugin-test/ping" })
      expect(ping.json()).toEqual({ ok: "stable" })

      await writePlugin(root, "export const nope = true\n")
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(422)
      expect(reload.json().errors[0].id).toBe("boring-plugin-test")
      expect(reload.json().errors[0].message).toContain("default-export")
      await expect(readFile(join(errorRoot, "boring-plugin-test", ".error"), "utf8")).resolves.toContain("default-export")

      const stillStable = await app.inject({ method: "GET", url: "/api/boring-plugins/boring-plugin-test/ping" })
      expect(stillStable.json()).toEqual({ ok: "stable" })
    } finally {
      await app.close()
    }
  })
})
