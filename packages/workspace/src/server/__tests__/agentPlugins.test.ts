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

async function readSseReplayPayloads(url: string): Promise<Array<Record<string, unknown>>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_000)
  const response = await fetch(url, { signal: controller.signal })
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toContain("text/event-stream")
  expect(response.body).toBeTruthy()

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let raw = ""
  try {
    while (!raw.includes("boring.plugin.replay-complete")) {
      const chunk = await reader.read()
      if (chunk.done) break
      raw += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    clearTimeout(timeout)
    controller.abort()
    await reader.cancel().catch(() => {})
  }
  expect(raw).toContain("boring.plugin.replay-complete")

  return raw
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>)
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
  await writeFile(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "boring-plugin-test" })\n', "utf8")
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

  test("readBoringPlugins filters Pi-only packages out of Boring plugin results", async () => {
    const root = await tmp("boring-plugin-pi-only-")
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "pi-only-plugin",
      pi: { systemPrompt: "Pi only" },
    }), "utf8")

    const scan = scanBoringPlugins([root])
    expect(scan.plugins).toEqual([expect.objectContaining({ id: "pi-only-plugin", hasBoring: false })])
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("scan and load preserve explicit source metadata without leaking it to list payloads", async () => {
    const root = await tmp("boring-plugin-source-metadata-")
    await writePlugin(root)

    const source = { rootDir: root, kind: "external" as const, workspaceId: "ws-1" }
    const scan = scanBoringPlugins([source])
    expect(scan.plugins[0].source).toEqual(source)

    const manager = new BoringPluginAssetManager({ pluginDirs: [source], errorRoot: join(root, ".errors") })
    const load = await manager.load()

    expect(manager.inspectLoaded()[0]).toMatchObject({
      id: "boring-plugin-test",
      rootDir: root,
      source,
    })
    expect(manager.list()[0]).not.toHaveProperty("rootDir")
    expect(manager.list()[0]).not.toHaveProperty("source")
    expect(load.events[0]).not.toHaveProperty("rootDir")
    expect(load.events[0]).not.toHaveProperty("source")
  })

  test("public list and SSE replay payloads do not expose source metadata", async () => {
    const root = await tmp("boring-plugin-public-metadata-")
    await writePlugin(root)

    const source = { rootDir: root, kind: "external" as const, workspaceId: "ws-1" }
    const manager = new BoringPluginAssetManager({ pluginDirs: [source], errorRoot: join(root, ".errors") })
    await manager.load()

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      const publicEntry = list.json()[0]
      expect(publicEntry).toMatchObject({ id: "boring-plugin-test", revision: 1 })
      expect(publicEntry).not.toHaveProperty("rootDir")
      expect(publicEntry).not.toHaveProperty("source")
      expect(JSON.stringify(publicEntry)).not.toContain('"rootDir"')
      expect(JSON.stringify(publicEntry)).not.toContain('"source"')

      const address = await app.listen({ host: "127.0.0.1", port: 0 })
      const replayPayloads = await readSseReplayPayloads(`${address}/api/v1/agent-plugins/events`)
      const replayedLoad = replayPayloads.find((payload) => payload.type === "boring.plugin.load")
      expect(replayedLoad).toMatchObject({ id: "boring-plugin-test", replay: true })
      expect(replayedLoad).not.toHaveProperty("rootDir")
      expect(replayedLoad).not.toHaveProperty("source")
      expect(JSON.stringify(replayedLoad)).not.toContain('"rootDir"')
      expect(JSON.stringify(replayedLoad)).not.toContain('"source"')
    } finally {
      await app.close()
    }
  })

  test("manager emits module-url front targets when no frontTargetResolver is supplied", async () => {
    const root = await tmp("boring-plugin-front-fallback-")
    await writePlugin(root)

    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })
    const result = await manager.load()
    const loadEvent = result.events.find((event) => event.type === "boring.plugin.load")

    const expectedTarget = {
      kind: "module-url",
      entryUrl: expect.stringContaining("/@fs/"),
      revision: 1,
    }
    expect(result.loaded).toEqual([
      expect.objectContaining({
        id: "boring-plugin-test",
        revision: 1,
        frontTarget: expectedTarget,
      }),
    ])
    expect(result.loaded[0]).not.toHaveProperty("frontUrl")
    expect(loadEvent).toEqual(expect.objectContaining({
      type: "boring.plugin.load",
      id: "boring-plugin-test",
      revision: 1,
      frontTarget: expectedTarget,
    }))
    expect(loadEvent).not.toHaveProperty("frontUrl")
  })

  test("manager emits revision-addressed native frontTarget payloads when a resolver is supplied", async () => {
    const root = await tmp("boring-plugin-front-target-")
    await writePlugin(root)

    const manager = new BoringPluginAssetManager({
      pluginDirs: [{ rootDir: root, kind: "external" as const }],
      errorRoot: join(root, ".errors"),
      frontTargetResolver(plugin, { revision, frontEntrySubpath }) {
        return {
          kind: "native",
          entryUrl: `/api/v1/agent-plugins/runtime/${plugin.id}/${revision}/${frontEntrySubpath}`,
          revision,
          trust: "local-trusted-native",
        }
      },
    })

    const first = await manager.load()
    const firstLoadEvent = first.events.find((event) => event.type === "boring.plugin.load")
    expect(first.loaded[0]).toMatchObject({
      id: "boring-plugin-test",
      revision: 1,
      frontTarget: {
        kind: "native",
        entryUrl: "/api/v1/agent-plugins/runtime/boring-plugin-test/1/front/index.tsx",
        revision: 1,
        trust: "local-trusted-native",
      },
    })
    expect(firstLoadEvent).toMatchObject({
      type: "boring.plugin.load",
      id: "boring-plugin-test",
      revision: 1,
      frontTarget: {
        kind: "native",
        entryUrl: "/api/v1/agent-plugins/runtime/boring-plugin-test/1/front/index.tsx",
        revision: 1,
        trust: "local-trusted-native",
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "boring-plugin-test", label: "Runtime target v2" })\n', "utf8")
    const second = await manager.load()
    expect(second.loaded[0]).toMatchObject({
      revision: 2,
      frontTarget: {
        kind: "native",
        entryUrl: "/api/v1/agent-plugins/runtime/boring-plugin-test/2/front/index.tsx",
        revision: 2,
        trust: "local-trusted-native",
      },
    })

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.json()[0]).toMatchObject({
        id: "boring-plugin-test",
        revision: 2,
        frontTarget: {
          kind: "native",
          entryUrl: "/api/v1/agent-plugins/runtime/boring-plugin-test/2/front/index.tsx",
          revision: 2,
          trust: "local-trusted-native",
        },
      })
    } finally {
      await app.close()
    }
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

  test("fails preflight when a declared pi.skills path does not exist", async () => {
    const root = await tmp("boring-plugin-missing-skill-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.pi.skills = ["skills/missing"]
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")

    const result = preflightBoringPlugins([root])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("skills/missing"),
    })
    expect(readBoringPlugins([root])).toEqual([])
  })

  test("uses boring.id as explicit plugin id when provided", async () => {
    const root = await tmp("boring-plugin-explicit-id-")
    await writePlugin(root)
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.id = "test-plugin"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")
    await writeFile(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "test-plugin" })\n', "utf8")

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

  test("reports registered source dirs that do not exist", async () => {
    const root = await tmp("boring-plugin-registered-missing-")
    const gone = join(root, "deleted-plugin")

    // Speculative scan roots stay silent when absent…
    expect(preflightBoringPlugins([{ rootDir: gone, kind: "external" }])).toEqual({ ok: true, errors: [] })
    // …registered ones surface a preflight error.
    const result = preflightBoringPlugins([{ rootDir: gone, kind: "external", registered: true }])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginDir: gone,
      code: "MISSING_PLUGIN_DIR",
    })
  })

  test("reports registered source dirs without package.json even with non-package children", async () => {
    const root = await tmp("boring-plugin-registered-stripped-")
    await mkdir(join(root, "dist"), { recursive: true })

    const result = preflightBoringPlugins([{ rootDir: root, kind: "external", registered: true }])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginDir: root,
      code: "MISSING_PACKAGE_JSON",
    })
  })

  test("reports registered source dirs whose package.json has no plugin metadata", async () => {
    const root = await tmp("boring-plugin-registered-no-metadata-")
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "not-a-plugin", version: "1.0.0" }), "utf8")

    // Non-registered package dirs without metadata are skipped silently…
    expect(preflightBoringPlugins([{ rootDir: root, kind: "external" }])).toEqual({ ok: true, errors: [] })
    // …registered ones surface a preflight error.
    const result = preflightBoringPlugins([{ rootDir: root, kind: "external", registered: true }])
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      pluginDir: root,
      code: "INVALID_PLUGIN_METADATA",
      message: expect.stringContaining("no \"boring\" or \"pi\" plugin metadata"),
    })
  })

  test("registered source dirs with valid plugins still load normally", async () => {
    const root = await tmp("boring-plugin-registered-valid-")
    await writePlugin(root)

    const result = scanBoringPlugins([{ rootDir: root, kind: "external", registered: true }])
    expect(result.preflight).toEqual({ ok: true, errors: [] })
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].id).toBe("boring-plugin-test")
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

  test("native front target uses manifest front path for symlinked plugin roots", async () => {
    const realRoot = await tmp("boring-plugin-real-root-")
    const linkRoot = await tmp("boring-plugin-link-parent-")
    const linkedPlugin = join(linkRoot, "linked-plugin")
    await writePlugin(realRoot)
    await symlink(realRoot, linkedPlugin)

    const manager = new BoringPluginAssetManager({
      pluginDirs: [{ rootDir: linkedPlugin, kind: "external" as const }],
      errorRoot: join(linkRoot, ".errors"),
      frontTargetResolver(plugin, { revision, frontEntrySubpath }) {
        return {
          kind: "native",
          trust: "local-trusted-native",
          revision,
          entryUrl: `/runtime/${plugin.id}/${revision}/${frontEntrySubpath}`,
        }
      },
    })

    const result = await manager.load()
    expect(result.errors).toEqual([])
    expect(result.loaded[0]).toMatchObject({
      frontTarget: { entryUrl: "/runtime/boring-plugin-test/1/front/index.tsx" },
    })
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

    // requiresRestart only applies to internal plugins — external server
    // files are hot-reloaded by the runtime backend and never warn.
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "internal" as const }], errorRoot: join(root, ".errors") })

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
    await writeFile(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "boring-plugin-test", label: "New pane" })\n', "utf8")
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

  test("external runtime server file changes do not require restart", async () => {
    const root = await tmp("boring-plugin-runtime-no-restart-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({
      pluginDirs: [{ rootDir: root, kind: "external" }],
      errorRoot: join(root, ".errors"),
    })

    await manager.load()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(root, "server", "index.js"), "export default function(api) { api.get('/changed', async () => ({ ok: true })) }\n", "utf8")
    const serverChanged = await manager.load()
    const loadEvent = serverChanged.events.find((event) => event.type === "boring.plugin.load")
    expect(loadEvent?.type).toBe("boring.plugin.load")
    if (loadEvent?.type === "boring.plugin.load") {
      expect(loadEvent.requiresRestart).toBeUndefined()
    }
  })

  test("reloads when front/shared dependencies change, not only the front entrypoint", async () => {
    const root = await tmp("boring-plugin-front-dep-")
    await writePlugin(root)
    await mkdir(join(root, "front", "nested"), { recursive: true })
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    pkg.boring.front = "front/nested/index.tsx"
    await writeFile(join(root, "package.json"), JSON.stringify(pkg), "utf8")
    await writeFile(join(root, "front", "nested", "index.tsx"), "import '../panel'\nexport default definePlugin({ id: 'boring-plugin-test' })\n", "utf8")
    await mkdir(join(root, "shared"), { recursive: true })
    await writeFile(join(root, "front", "panel.tsx"), "export const label = 'one'\n", "utf8")
    await writeFile(join(root, "shared", "constants.ts"), "export const label = 'one'\n", "utf8")
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })

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
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })
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

  test("loaded Pi snapshot keeps healthy plugins when another plugin fails", async () => {
    const validRoot = await tmp("boring-plugin-pi-snapshot-valid-")
    const invalidRoot = await tmp("boring-plugin-pi-snapshot-invalid-")
    await writePlugin(validRoot)
    await mkdir(join(validRoot, "skills", "deck-authoring"), { recursive: true })
    await writeFile(join(validRoot, "skills", "deck-authoring", "SKILL.md"), "# Deck authoring\n", "utf8")
    const validPkg = JSON.parse(await readFile(join(validRoot, "package.json"), "utf8"))
    validPkg.pi.skills = ["skills/deck-authoring"]
    await writeFile(join(validRoot, "package.json"), JSON.stringify(validPkg), "utf8")
    await mkdir(invalidRoot, { recursive: true })
    await writeFile(join(invalidRoot, "package.json"), JSON.stringify({
      name: "broken-plugin",
      version: "1.0.0",
      boring: { front: "front/missing.tsx" },
      pi: { systemPrompt: "Broken plugin context" },
    }), "utf8")

    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: validRoot, kind: "external" as const }, { rootDir: invalidRoot, kind: "external" as const }], errorRoot: join(validRoot, ".errors") })
    const scan = await manager.load()
    expect(scan.errors).toEqual([expect.objectContaining({ id: "broken-plugin" })])

    const snapshot = manager.inspectLoadedPiSnapshot()
    expect(snapshot.systemPromptAppend).toContain("Test plugin context")
    expect(snapshot.systemPromptAppend).not.toContain("Broken plugin context")
    expect(snapshot.additionalSkillPaths).toContain(join(validRoot, "skills"))
    expect(snapshot.additionalSkillPaths).not.toContain(join(validRoot, "skills", "deck-authoring"))
  })

  test("aggregatePluginPrompts returns undefined when no plugin contributes a prompt", async () => {
    const root = await tmp("boring-plugin-agent-context-empty-")
    await mkdir(join(root, "front"), { recursive: true })
    await writeFile(join(root, "front", "index.tsx"), 'export default definePlugin({ id: "no-prompt-plugin" })\n', "utf8")
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "no-prompt-plugin",
      version: "1.0.0",
      boring: { front: "./front/index.tsx" },
    }), "utf8")
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })
    await manager.load()
    expect(aggregatePluginPrompts(manager)).toBeUndefined()
  })

  test("internal plugins load server-side but never reach the SSE channel", async () => {
    // Internal plugins are app code: their front is statically bundled by the
    // host, so the SSE hot-reload channel (subscribe + listExternal replay)
    // must never carry them. The events array stays complete for /reload
    // diagnostics, and list()/getErrors keep full visibility.
    const internalRoot = await tmp("boring-plugin-internal-")
    const externalRoot = await tmp("boring-plugin-external-")
    await writePlugin(internalRoot)
    await writePlugin(externalRoot)
    const externalPkg = JSON.parse(await readFile(join(externalRoot, "package.json"), "utf8"))
    externalPkg.name = "boring-plugin-external"
    await writeFile(join(externalRoot, "package.json"), JSON.stringify(externalPkg), "utf8")
    await writeFile(join(externalRoot, "front", "index.tsx"), 'export default definePlugin({ id: "boring-plugin-external" })\n', "utf8")

    const manager = new BoringPluginAssetManager({
      pluginDirs: [
        { rootDir: internalRoot, kind: "internal" as const },
        { rootDir: externalRoot, kind: "external" as const },
      ],
      errorRoot: join(internalRoot, ".errors"),
    })
    const emitted: string[] = []
    manager.subscribe((event) => emitted.push(event.id))

    const result = await manager.load()
    // Both load server-side; the events array records both.
    expect(result.loaded.map((p) => p.id).sort()).toEqual(["boring-plugin-external", "boring-plugin-test"])
    expect(result.events.map((e) => e.id).sort()).toEqual(["boring-plugin-external", "boring-plugin-test"])
    // Only the external plugin reaches subscribers and the SSE replay list.
    expect(emitted).toEqual(["boring-plugin-external"])
    expect(manager.listExternal().map((p) => p.id)).toEqual(["boring-plugin-external"])
    expect(manager.list().map((p) => p.id).sort()).toEqual(["boring-plugin-external", "boring-plugin-test"])
  })

  test("scans plugins, emits load events, and serves canonical /api/v1/agent-plugins", async () => {
    // Per PLUGIN_SYSTEM.md Gotcha #4: asset manager is scan + hash + emit only.
    // Server module instantiation lives in pluginEntryResolver, not here.
    const root = await tmp("boring-plugin-manager-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })
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
      const reload = await manager.load()
      expect(reload.loaded[0].revision).toBe(2)
    } finally {
      await app.close()
    }
  })

  test("queues one successor load when reload is requested during an inflight load", async () => {
    const root = await tmp("boring-plugin-queued-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })

    // Two concurrent loads: the second queues behind the first.
    const first = manager.load()
    await writePlugin(root, "export default { id: 'boring-plugin-test', systemPrompt: 'V2' }\n")
    const second = manager.load()
    const result = await second
    await first

    // Single-flight coalescing: revision reflects the latest content.
    expect(result.loaded[0].revision).toBeGreaterThanOrEqual(2)
  })

  test("POST /api/boring.reload is not registered", async () => {
    const root = await tmp("boring-plugin-obsolete-reload-")
    await writePlugin(root)
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot: join(root, ".errors") })

    const app = Fastify({ logger: false })
    await app.register(boringPluginRoutes, { manager })
    try {
      const reload = await app.inject({ method: "POST", url: "/api/boring.reload" })
      expect(reload.statusCode).toBe(404)
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
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot })
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
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot })
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
    await writeFile(join(valid, "front", "index.tsx"), 'export default definePlugin({ id: "valid-plugin" })\n', "utf8")
    const invalidPkg = JSON.parse(await readFile(join(invalid, "package.json"), "utf8"))
    invalidPkg.name = "invalid-plugin"
    invalidPkg.boring.front = "front/missing.tsx"
    await writeFile(join(invalid, "package.json"), JSON.stringify(invalidPkg), "utf8")

    const scan = scanBoringPlugins([valid, invalid])
    expect(scan.preflight.ok).toBe(false)
    expect(scan.plugins.map((plugin) => plugin.id)).toEqual(["valid-plugin"])

    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: valid, kind: "external" as const }, { rootDir: invalid, kind: "external" as const }], errorRoot: join(valid, ".errors") })
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
    const manager = new BoringPluginAssetManager({ pluginDirs: [{ rootDir: root, kind: "external" as const }], errorRoot })

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
