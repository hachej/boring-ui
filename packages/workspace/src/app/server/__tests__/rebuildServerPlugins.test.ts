import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { rebuildServerPlugins } from "../rebuildServerPlugins"
import { ServerPluginLifecycleBus } from "../serverPluginLifecycle"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("Phase 4 — rebuildServerPlugins", () => {
  test("re-resolves dir entries and emits lifecycle events in Pi order", async () => {
    const dir = await makeTempDir("phase4-dir-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'rebuilt', systemPrompt: 'REBUILT_PROMPT' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p" }), "utf8")

    const bus = new ServerPluginLifecycleBus()
    const events: string[] = []
    bus.on("plugin_shutdown", (e) => { events.push(`down:${e.pluginId}:${e.reason}`) })
    bus.on("plugin_start", (e) => { events.push(`up:${e.pluginId}:${e.reason}`) })

    const result = await rebuildServerPlugins({
      entries: [{ dir, hotReload: true }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
      bus,
      currentPluginIds: ["rebuilt"],
    })

    expect(result.ok).toBe(true)
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].id).toBe("rebuilt")
    expect(result.diagnostics).toEqual([])
    expect(events).toEqual([
      "down:rebuilt:reload",   // Pi parity: shutdown all currently-loaded BEFORE re-resolve
      "up:rebuilt:reload",     // Pi parity: start each freshly-resolved plugin
    ])
  })

  test("failed dir entry surfaces a diagnostic and other entries keep going", async () => {
    const goodDir = await makeTempDir("phase4-good-")
    await mkdir(join(goodDir, "src", "server"), { recursive: true })
    await writeFile(
      join(goodDir, "src", "server", "index.ts"),
      "export default { id: 'good', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(goodDir, "package.json"), JSON.stringify({ name: "p" }), "utf8")

    const result = await rebuildServerPlugins({
      entries: [
        { dir: "/nonexistent", hotReload: true },
        { dir: goodDir, hotReload: true },
      ],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.ok).toBe(false)
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0].id).toBe("good")
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].source).toBe("directory")
    expect(result.diagnostics[0].path).toBe("/nonexistent")
  })

  test("pre-built objects and factory functions pass through unchanged", async () => {
    const factory = vi.fn(() => ({ id: "fact", systemPrompt: "F" }))
    const result = await rebuildServerPlugins({
      entries: [
        { id: "obj", systemPrompt: "O" },
        factory,
      ],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
    })

    expect(result.plugins.map((p) => p.id)).toEqual(["obj", "fact"])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  test("skips lifecycle emit when no handlers — Pi parity (hasHandlers gate)", async () => {
    const bus = new ServerPluginLifecycleBus()
    const emitSpy = vi.spyOn(bus, "emit")
    const result = await rebuildServerPlugins({
      entries: [{ id: "obj", systemPrompt: "" }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
      bus,
      currentPluginIds: ["obj"],
    })

    expect(result.ok).toBe(true)
    expect(emitSpy).not.toHaveBeenCalled()
  })

  test("consecutive rebuilds: shutdown fires for the LIVE set, not the boot set", async () => {
    // Caller-side simulation of how createWorkspaceAgentServer's
    // __boringRebuildPlugins closure tracks `liveLoadedIds` across calls.
    const bus = new ServerPluginLifecycleBus()
    const log: string[] = []
    bus.on("plugin_shutdown", (e) => { log.push(`down:${e.pluginId}`) })
    bus.on("plugin_start", (e) => { log.push(`up:${e.pluginId}:${e.reason}`) })

    let liveLoadedIds: string[] = ["v1"]

    // First rebuild: replace v1 with v2
    let result = await rebuildServerPlugins({
      entries: [{ id: "v2", systemPrompt: "B" }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
      bus,
      currentPluginIds: liveLoadedIds,
    })
    liveLoadedIds = result.plugins.map((p) => p.id)
    expect(liveLoadedIds).toEqual(["v2"])

    // Second rebuild: replace v2 with v3. shutdown MUST fire for v2,
    // not v1 (the boot id) — that was xAI Phase 4 review's stale-snapshot bug.
    result = await rebuildServerPlugins({
      entries: [{ id: "v3", systemPrompt: "C" }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} as never },
      bus,
      currentPluginIds: liveLoadedIds,
    })
    expect(log).toEqual([
      "down:v1", "up:v2:reload",
      "down:v2", "up:v3:reload",  // <-- v2 (live), not v1 (boot)
    ])
  })
})
