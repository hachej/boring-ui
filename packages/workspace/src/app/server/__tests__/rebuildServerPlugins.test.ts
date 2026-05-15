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
      entries: [{ spec: { dir }, hotReload: true }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} },
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
        { spec: { dir: "/nonexistent" }, hotReload: true },
        { spec: { dir: goodDir }, hotReload: true },
      ],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} },
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
      ctx: { workspaceRoot: "/tmp/host", bridge: {} },
    })

    expect(result.plugins.map((p) => p.id)).toEqual(["obj", "fact"])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  test("skips lifecycle emit when no handlers — Pi parity (hasHandlers gate)", async () => {
    const bus = new ServerPluginLifecycleBus()
    const emitSpy = vi.spyOn(bus, "emit")
    const result = await rebuildServerPlugins({
      entries: [{ id: "obj", systemPrompt: "" }],
      ctx: { workspaceRoot: "/tmp/host", bridge: {} },
      bus,
      currentPluginIds: ["obj"],
    })

    expect(result.ok).toBe(true)
    expect(emitSpy).not.toHaveBeenCalled()
  })
})
