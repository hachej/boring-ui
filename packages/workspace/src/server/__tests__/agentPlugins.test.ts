import Fastify from "fastify"
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { BoringPluginAssetManager } from "../agentPlugins/manager"
import { aggregatePluginPrompts } from "../agentPlugins/aggregatePluginPrompts"
import { boringPluginRoutes } from "../agentPlugins/routes"
import { preflightBoringPlugins, readBoringPlugins, scanBoringPlugins } from "../agentPlugins/scan"

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
      server: "./server/index.js",
    },
    pi: {
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

  test("scans package manifests with pi fields for agent contributions", async () => {
    const root = await tmp("boring-plugin-pi-scan-")
    await writePlugin(root)
    await mkdir(join(root, "agent", "skills"), { recursive: true })
    await writeFile(join(root, "agent", "index.ts"), "export default function() {}\n", "utf8")
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.pi.extensions = ["agent/index.ts"]
    pkg.pi.skills = ["agent/skills"]
    pkg.pi.packages = [{ source: "file:.", extensions: ["agent/index.ts"] }]
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    expect(preflightBoringPlugins([root]).ok).toBe(true)
    const [plugin] = readBoringPlugins([root])
    expect(plugin.extensionPaths).toEqual([join(root, "agent", "index.ts")])
    expect(plugin.skillPaths).toEqual([join(root, "agent", "skills")])
    expect(plugin.pi?.packages).toEqual([{ source: "file:.", extensions: ["agent/index.ts"] }])
    expect(plugin.pi?.systemPrompt).toBe("Test plugin context")
  })

  test("uses boring.id as explicit plugin id when provided", async () => {
    const root = await tmp("boring-plugin-explicit-id-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.id = "test-plugin"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(true)
    expect(readBoringPlugins([root])[0]?.id).toBe("test-plugin")
  })

  test("rejects invalid effective ids derived from package name", async () => {
    const root = await tmp("boring-plugin-invalid-derived-id-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.name = "bad plugin name"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("effective plugin id"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("reports explicitly supplied plugin dirs without package.json", async () => {
    const root = await tmp("boring-plugin-missing-package-")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginDir: root,
      code: "MISSING_PACKAGE_JSON",
    })
  })

  test("rejects duplicate effective plugin ids", async () => {
    const a = await tmp("boring-plugin-duplicate-a-")
    const b = await tmp("boring-plugin-duplicate-b-")
    await writePlugin(a)
    await writePlugin(b)

    const result = preflightBoringPlugins([a, b])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pluginDir: b,
        pluginId: "boring-plugin-test",
        code: "INVALID_PLUGIN_METADATA",
        message: expect.stringContaining("duplicate plugin id"),
      }),
    ]))
    expect(readBoringPlugins([a, b])).toEqual([])
  })

  test("allows empty collection directories without package.json", async () => {
    const root = await tmp("boring-plugin-empty-collection-")
    const collection = join(root, "extensions")
    await mkdir(collection, { recursive: true })

    expect(preflightBoringPlugins([collection])).toEqual({ ok: true, errors: [] })
    expect(readBoringPlugins([collection])).toEqual([])
  })

  test("rejects explicit server entries that resolve outside the plugin root", async () => {
    const root = await tmp("boring-plugin-explicit-server-symlink-escape-")
    const outside = await tmp("boring-plugin-outside-server-target-")
    await writePlugin(root)
    await writeFile(join(outside, "server.js"), "export default function() {}\n", "utf8")
    await rm(join(root, "server", "index.js"), { force: true })
    await symlink(join(outside, "server.js"), join(root, "server", "index.js"))
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.server = "server/index.js"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginId: "boring-plugin-test",
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("boring.server: resolved path escapes plugin root"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("rejects missing explicit boring.front files", async () => {
    const root = await tmp("boring-plugin-missing-front-")
    await writePlugin(root)
    await rm(join(root, "front", "index.tsx"), { force: true })

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginId: "boring-plugin-test",
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("boring.front: declared path does not exist"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("rejects existing package paths that resolve outside the plugin root", async () => {
    const root = await tmp("boring-plugin-symlink-escape-")
    const outside = await tmp("boring-plugin-outside-target-")
    await writePlugin(root)
    await writeFile(join(outside, "escape.tsx"), "export default function() {}\n", "utf8")
    await symlink(join(outside, "escape.tsx"), join(root, "front", "escape.tsx"))
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.front = "front/escape.tsx"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginId: "boring-plugin-test",
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("boring.front: resolved path escapes plugin root"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("rejects missing package paths under symlinked ancestors", async () => {
    const root = await tmp("boring-plugin-symlink-ancestor-")
    const outside = await tmp("boring-plugin-outside-ancestor-")
    await writePlugin(root)
    await rm(join(root, "front"), { recursive: true, force: true })
    await symlink(outside, join(root, "front"))
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.front = "front/missing.tsx"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginId: "boring-plugin-test",
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("boring.front: resolved path escapes plugin root"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("allows manifest server opt-out while still loading front assets", async () => {
    const root = await tmp("boring-plugin-server-optout-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.server = false
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    expect(preflightBoringPlugins([root]).ok).toBe(true)
    const [plugin] = readBoringPlugins([root])
    expect(plugin.frontUrl).toContain("/@fs/")
    expect(plugin.serverPath).toBeUndefined()
  })

  test("reload event sets requiresRestart when the server file changes between revisions", async () => {
    const root = await tmp("boring-plugin-restart-")
    // writePlugin already writes server/index.js + manifest pointing at
    // it — perfect for this test.
    await writePlugin(root)

    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })

    // First load: no `previous`, so requiresRestart is omitted (the
    // initial boot wired everything correctly).
    const initial = await manager.load()
    const initialLoad = initial.events.find((event) => event.type === "boring.plugin.load")
    expect(initialLoad?.type).toBe("boring.plugin.load")
    if (initialLoad?.type === "boring.plugin.load") {
      expect(initialLoad.requiresRestart).toBeUndefined()
    }

    // Touch ONLY the front file → no requiresRestart on subsequent load.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(root, "front", "index.tsx"), "export default function NewPane() { return null }\n", "utf8")
    const frontOnly = await manager.load()
    const frontEvent = frontOnly.events.find((event) => event.type === "boring.plugin.load")
    expect(frontEvent?.type).toBe("boring.plugin.load")
    if (frontEvent?.type === "boring.plugin.load") {
      expect(frontEvent.requiresRestart).toBeUndefined()
    }

    // Touch the SERVER file → requiresRestart MUST be set; routes and
    // agentTools were wired at boot and the running server still has
    // the prior file's exports.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(root, "server", "index.js"), "export default function(api) { api.get('/changed', async () => ({ ok: true })) }\n", "utf8")
    const serverChanged = await manager.load()
    const restartEvent = serverChanged.events.find((event) => event.type === "boring.plugin.load")
    expect(restartEvent?.type).toBe("boring.plugin.load")
    if (restartEvent?.type === "boring.plugin.load") {
      expect(restartEvent.requiresRestart).toEqual(["routes", "agentTools"])
    }
  })

  test("reloads when front/shared dependencies change, not only the front entrypoint", async () => {
    const root = await tmp("boring-plugin-front-dep-")
    await writePlugin(root)
    await mkdir(join(root, "shared"), { recursive: true })
    await writeFile(join(root, "front", "panel.tsx"), "export const label = 'one'\n", "utf8")
    await writeFile(join(root, "shared", "constants.ts"), "export const label = 'one'\n", "utf8")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })

    await manager.load()
    expect(manager.list()[0].revision).toBe(1)
    expect((await manager.load()).events).toEqual([])

    await writeFile(join(root, "front", "panel.tsx"), "export const label = 'two'\n", "utf8")
    const frontChanged = await manager.load()
    expect(frontChanged.events.map((event) => event.type)).toEqual(["boring.plugin.load"])
    expect(manager.list()[0].revision).toBe(2)

    await writeFile(join(root, "shared", "constants.ts"), "export const label = 'three'\n", "utf8")
    const sharedChanged = await manager.load()
    expect(sharedChanged.events.map((event) => event.type)).toEqual(["boring.plugin.load"])
    expect(manager.list()[0].revision).toBe(3)
  })

  test("aggregatePluginPrompts reflects current package pi.systemPrompt across reloads", async () => {
    const root = await tmp("boring-plugin-agent-context-reload-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })
    await manager.load()

    expect(aggregatePluginPrompts(manager)).toContain("Test plugin context")

    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.pi.systemPrompt = "Updated plugin context"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")
    await manager.load()

    const updated = aggregatePluginPrompts(manager)
    expect(updated).toContain("Updated plugin context")
    expect(updated).not.toContain("Test plugin context")
  })

  test("aggregatePluginPrompts returns undefined when no plugin contributes a prompt", async () => {
    const root = await tmp("boring-plugin-agent-context-empty-")
    await mkdir(join(root, "front"), { recursive: true })
    await writeFile(join(root, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "no-prompt-plugin",
      version: "1.0.0",
      boring: { front: "./front/index.tsx" },
    }), "utf8")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })
    await manager.load()
    expect(aggregatePluginPrompts(manager)).toBeUndefined()
  })

  test("scans plugins, emits load events, and serves canonical /api/v1/agent-plugins", async () => {
    // Per PLUGIN_SYSTEM.md Gotcha #4: asset manager is scan + hash + emit only.
    // Server module instantiation lives in pluginEntryResolver, not here.
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
      const versionedList = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(versionedList.json()[0].id).toBe("boring-plugin-test")
      const unversionedList = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(unversionedList.statusCode).toBe(404)

      // Edit a tracked file → signature bumps → next load emits a fresh event.
      await writePlugin(root, "export default { id: 'boring-plugin-test', systemPrompt: 'V2' }\n")
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(200)
      expect(reload.json().plugins[0].revision).toBe(2)
    } finally {
      await app.close()
    }
  })

  test("queues one successor load when reload is requested during an inflight load", async () => {
    const root = await tmp("boring-plugin-queued-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })

    // Two concurrent loads: the second queues behind the first.
    const first = manager.load()
    await writePlugin(root, "export default { id: 'boring-plugin-test', systemPrompt: 'V2' }\n")
    const second = manager.load()
    const result = await second
    await first

    // Single-flight coalescing: revision reflects the latest content.
    expect(result.loaded[0].revision).toBeGreaterThanOrEqual(2)
  })

  test("POST /api/boring.reload carries rebuildPlugins diagnostics in the 422 body (PLUGIN_SYSTEM.md §5)", async () => {
    const root = await tmp("boring-plugin-reload-diagnostics-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })
    const rebuildPlugins = async () => ({
      ok: false,
      diagnostics: [
        { source: "directory (/some/dir)", message: "syntax error: unexpected `{{`", pluginId: "broken" },
      ],
    })

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager, rebuildPlugins })
    try {
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(422)
      const body = reload.json()
      expect(body.ok).toBe(false)
      expect(body.diagnostics).toEqual([
        expect.objectContaining({ pluginId: "broken", message: expect.stringContaining("syntax error") }),
      ])
      // Healthy plugins (asset manager scan succeeded) still listed.
      expect(body.plugins[0].id).toBe("boring-plugin-test")
    } finally {
      await app.close()
    }
  })

  test("POST /api/boring.reload returns 200 when both scan and rebuild are clean", async () => {
    const root = await tmp("boring-plugin-reload-ok-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })
    const rebuildPlugins = async () => ({ ok: true, diagnostics: [] })

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager, rebuildPlugins })
    try {
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(200)
      expect(reload.json().ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test("POST /api/boring.reload surfaces restart_warnings when a plugin's server file changed mid-session", async () => {
    const root = await tmp("boring-plugin-reload-warn-")
    await writePlugin(root) // includes server/index.js + boring.server set
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot: join(root, ".errors") })

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })

    try {
      // First reload: no prior record, so no requiresRestart, so no warning.
      const initial = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(initial.statusCode).toBe(200)
      const initialBody = initial.json() as { restart_warnings?: unknown }
      expect(initialBody.restart_warnings).toBeUndefined()

      // Touch the server file → next reload event carries requiresRestart →
      // route surfaces a restart_warnings entry.
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(join(root, "server", "index.js"), "export default function(api) { api.get('/v2', async () => ({ ok: true })) }\n", "utf8")

      const restart = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(restart.statusCode).toBe(200)
      const body = restart.json() as {
        ok: boolean
        restart_warnings?: Array<{ id: string; surfaces: string[]; message: string }>
      }
      expect(body.ok).toBe(true)
      expect(body.restart_warnings).toBeDefined()
      expect(body.restart_warnings).toHaveLength(1)
      expect(body.restart_warnings![0].id).toBe("boring-plugin-test")
      expect(body.restart_warnings![0].surfaces).toEqual(["routes", "agentTools"])
      expect(body.restart_warnings![0].message).toContain("restart the workspace process")
      expect(body.restart_warnings![0].message).toContain("Ctrl-C")
    } finally {
      await app.close()
    }
  })

  test("writes preflight errors under a stable fallback id when plugin id cannot be derived", async () => {
    const root = await tmp("boring-plugin-preflight-fallback-id-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.name = "bad plugin name"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")
    const errorRoot = join(root, ".errors")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot })
    const events: string[] = []
    manager.subscribe((event) => events.push(`${event.type}:${event.id}`))

    const result = await manager.load()

    expect(result.loaded).toEqual([])
    expect(result.errors[0].id).toMatch(/^preflight-[a-f0-9]{12}$/)
    expect(result.errors[0].message).toContain("effective plugin id")
    expect(events).toEqual([`boring.plugin.error:${result.errors[0].id}`])
    await expect(readFile(join(errorRoot, result.errors[0].id, ".error"), "utf8")).resolves.toContain("effective plugin id")
  })

  test("rejects escaped plugin ids when reading error files", async () => {
    const root = await tmp("boring-plugin-error-id-containment-")
    const errorRoot = join(root, "errors")
    await mkdir(join(root, "outside"), { recursive: true })
    await writeFile(join(root, "outside", ".error"), "secret", "utf8")
    const manager = new BoringPluginAssetManager({ pluginDirs: [], errorRoot })
    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/agent-plugins/..%2Foutside/error" })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain("secret")
    } finally {
      await app.close()
    }
  })

  test("emits and writes manifest preflight errors during load", async () => {
    const root = await tmp("boring-plugin-preflight-error-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.front = "../escape.tsx"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")
    const errorRoot = join(root, ".errors")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot })
    const events: string[] = []
    manager.subscribe((event) => events.push(`${event.type}:${event.id}`))

    const result = await manager.load()

    expect(result.loaded).toEqual([])
    expect(result.errors[0]).toMatchObject({
      id: "boring-plugin-test",
      message: expect.stringContaining("INVALID_PLUGIN_METADATA"),
    })
    expect(events).toEqual(["boring.plugin.error:boring-plugin-test"])
    await expect(readFile(join(errorRoot, "boring-plugin-test", ".error"), "utf8")).resolves.toContain("boring.front")
  })

  test("preflight errors do not block valid plugin load events", async () => {
    const valid = await tmp("boring-plugin-partial-valid-")
    const invalid = await tmp("boring-plugin-partial-invalid-")
    await writePlugin(valid)
    await writePlugin(invalid)
    const validPkg = JSON.parse(await readFile(join(valid, "package.json"), "utf8"))
    validPkg.name = "valid-plugin"
    await writeFile(join(valid, "package.json"), JSON.stringify(validPkg), "utf8")
    const invalidPkg = JSON.parse(await readFile(join(invalid, "package.json"), "utf8"))
    invalidPkg.name = "invalid-plugin"
    invalidPkg.boring.front = "front/missing.tsx"
    await writeFile(join(invalid, "package.json"), JSON.stringify(invalidPkg), "utf8")

    const scan = scanBoringPlugins([valid, invalid])
    expect(scan.preflight.ok).toBe(false)
    expect(scan.plugins.map((plugin) => plugin.id)).toEqual(["valid-plugin"])

    const manager = new BoringPluginAssetManager({ pluginDirs: [valid, invalid], errorRoot: join(valid, ".errors") })
    const events: string[] = []
    manager.subscribe((event) => events.push(`${event.type}:${event.id}`))
    const result = await manager.load()

    expect(result.loaded.map((plugin) => plugin.id)).toEqual(["valid-plugin"])
    expect(result.errors.map((error) => error.id)).toEqual(["invalid-plugin"])
    expect(events).toEqual([
      "boring.plugin.error:invalid-plugin",
      "boring.plugin.load:valid-plugin",
    ])
  })

  test("manifest preflight errors persist between reloads until the manifest is fixed", async () => {
    // Per PLUGIN_SYSTEM.md §4.5: preflight failures don't break previously loaded
    // plugins; the asset manager keeps emitting error events until the
    // manifest is fixed.
    const root = await tmp("boring-plugin-error-persist-")
    await writePlugin(root)
    const errorRoot = join(root, ".pi", "extensions")
    const manager = new BoringPluginAssetManager({ pluginDirs: [root], errorRoot })

    const first = await manager.load()
    expect(first.errors).toEqual([])
    expect(first.loaded[0].id).toBe("boring-plugin-test")

    // Plant a manifest with an unsafe path → preflight catches it.
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.front = "../escape.tsx"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const second = await manager.load()
    expect(second.errors[0]?.id).toBe("boring-plugin-test")
    expect(second.errors[0]?.message).toContain("INVALID_PLUGIN_METADATA")
  })
})
