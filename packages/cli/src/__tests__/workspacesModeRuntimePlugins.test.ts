import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createWorkspacesModeApp } from "../server/cli.js"
import { createLocalWorkspaceRegistry, type LocalWorkspace } from "../server/localWorkspaces.js"

const tempDirs: string[] = []
const originalHome = process.env.HOME

interface SseMessage {
  event: string
  data: Record<string, unknown>
}

class SseReader {
  private readonly decoder = new TextDecoder()
  private buffer = ""
  private readonly queue: SseMessage[] = []

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly controller: AbortController,
  ) {}

  async nextEvent(predicate: (message: SseMessage) => boolean, maxReads = 20): Promise<SseMessage> {
    for (let i = 0; i < maxReads; i += 1) {
      const queued = this.takeMatching(predicate)
      if (queued) return queued

      const { done, value } = await this.reader.read()
      if (done) break
      this.buffer += this.decoder.decode(value, { stream: true })
      this.drainBuffer()
      const parsed = this.takeMatching(predicate)
      if (parsed) return parsed
    }
    throw new Error(`matching SSE event not found. buffer=${this.buffer}`)
  }

  private drainBuffer(): void {
    const chunks = this.buffer.split("\n\n")
    this.buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      const message = parseSseChunk(chunk)
      if (message) this.queue.push(message)
    }
  }

  private takeMatching(predicate: (message: SseMessage) => boolean): SseMessage | null {
    const index = this.queue.findIndex(predicate)
    if (index < 0) return null
    return this.queue.splice(index, 1)[0] ?? null
  }

  async waitForClose(timeoutMs = 2_000): Promise<void> {
    await Promise.race([
      (async () => {
        while (true) {
          const { done } = await this.reader.read()
          if (done) return
        }
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SSE stream did not close in time")), timeoutMs)),
    ])
  }

  async close(): Promise<void> {
    this.controller.abort()
    try { await this.reader.cancel() } catch {}
  }
}

function parseSseChunk(chunk: string): SseMessage | null {
  const trimmed = chunk.trim()
  if (!trimmed || trimmed.startsWith(":")) return null
  const event = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim()
  const dataLine = chunk.match(/^data:\s*(.+)$/m)?.[1]
  if (!event || !dataLine) return null
  return { event, data: JSON.parse(dataLine) as Record<string, unknown> }
}

async function openSse(url: string): Promise<SseReader> {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  if (!response.body) throw new Error("missing SSE response body")
  return new SseReader(response.body.getReader(), controller)
}

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writePlugin(root: string, name: string): Promise<void> {
  await mkdir(join(root, "front"), { recursive: true })
  await writeFile(join(root, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf8")
  await writeFile(join(root, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    boring: { front: "front/index.tsx", label: name },
  }), "utf8")
}

async function setupRegistry(workspacePaths: string[], registryPath: string): Promise<LocalWorkspace[]> {
  const registry = createLocalWorkspaceRegistry(registryPath)
  const workspaces: LocalWorkspace[] = []
  for (const workspacePath of workspacePaths) {
    workspaces.push(await registry.add(workspacePath))
  }
  return workspaces
}

describe("workspaces mode runtime plugin wiring", () => {
  test("first SSE connect replays the active workspace scope without a prior GET", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-registry-"), "workspaces.yaml")
    const workspaceA = await makeTempDir("boring-cli-workspace-a-")
    const workspaceB = await makeTempDir("boring-cli-workspace-b-")
    process.env.HOME = homeRoot

    await writePlugin(join(homeRoot, ".pi", "agent", "extensions", "global-plugin"), "global-plugin")
    await writePlugin(join(workspaceA, ".pi", "extensions", "local-a"), "local-a")
    await writePlugin(join(workspaceB, ".pi", "extensions", "local-b"), "local-b")
    const [registeredA, registeredB] = await setupRegistry([workspaceA, workspaceB], registryPath)

    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(registeredA.id)}`)

    try {
      const first = await sse.nextEvent((event) => event.event === "boring.plugin.load")
      const second = await sse.nextEvent((event) => event.event === "boring.plugin.load" && event.data.id !== first.data.id)
      const replayComplete = await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")

      expect([first.data.id, second.data.id].sort()).toEqual(["global-plugin", "local-a"])
      expect(first.data.workspaceId).toBe(registeredA.id)
      expect(second.data.workspaceId).toBe(registeredA.id)
      expect(first.data.replay).toBe(true)
      expect(second.data.replay).toBe(true)
      expect(first.data.frontTarget).toBeTruthy()
      expect(second.data.frontTarget).toBeTruthy()
      expect(first.data.frontUrl).toBeUndefined()
      expect(second.data.frontUrl).toBeUndefined()
      expect(replayComplete.data).toMatchObject({ workspaceId: registeredA.id, replay: true })

      const listA = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${registeredA.id}` })
      const pluginsA = listA.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>
      expect(pluginsA.map((plugin) => plugin.id).sort()).toEqual(["global-plugin", "local-a"])
      for (const plugin of pluginsA) {
        expect(plugin.frontTarget?.entryUrl).toBeTruthy()
        const runtime = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
        expect(runtime.statusCode).toBe(200)
      }

      const listB = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${registeredB.id}` })
      expect((listB.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["global-plugin", "local-b"])
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)

  test("ordinary GET does not become a hidden refresh path and zero-plugin workspaces still complete replay", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-empty-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-empty-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-empty-")
    process.env.HOME = homeRoot

    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const replayComplete = await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")
      expect(replayComplete.data).toMatchObject({ workspaceId: workspace.id, replay: true })

      const before = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect(before.json()).toEqual([])

      await writePlugin(join(workspaceRoot, ".pi", "extensions", "later-plugin"), "later-plugin")

      const stillBeforeReload = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect(stillBeforeReload.json()).toEqual([])

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)
      expect(reload.json()).toMatchObject({ ok: true, sessionId: expect.any(String), reloaded: expect.any(Boolean) })

      const afterReload = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((afterReload.json() as Array<{ id: string }>).map((plugin) => plugin.id)).toEqual(["later-plugin"])
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)

  test("workspace eviction closes active SSE streams and disposes runtime targets", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-evict-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-evict-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-evict-")
    process.env.HOME = homeRoot

    await writePlugin(join(workspaceRoot, ".pi", "extensions", "evict-plugin"), "evict-plugin")
    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const [plugin] = list.json() as Array<{ frontTarget?: { entryUrl?: string } }>
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()

      const remove = await app.inject({ method: "DELETE", url: `/api/v1/local-workspaces/${workspace.id}` })
      expect(remove.json()).toMatchObject({ ok: true })
      await sse.waitForClose()

      const runtime = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
      expect(runtime.statusCode).toBe(404)
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)

  test("reload drops stale runtime targets when a plugin loses boring.front but stays loaded", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-front-removed-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-front-removed-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-front-removed-")
    process.env.HOME = homeRoot

    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "front-removed-plugin")
    await writePlugin(pluginRoot, "front-removed-plugin")
    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const [plugin] = list.json() as Array<{ frontTarget?: { entryUrl?: string } }>
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()
      await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")

      await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
        name: "front-removed-plugin",
        version: "1.0.1",
        boring: { label: "front-removed-plugin" },
      }), "utf8")

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)

      const loadWithoutFront = await sse.nextEvent((event) => event.event === "boring.plugin.load" && event.data.id === "front-removed-plugin" && !("frontTarget" in event.data))
      expect(loadWithoutFront.data).toMatchObject({ id: "front-removed-plugin", workspaceId: workspace.id, replay: false })
      const runtimeAfterFrontRemoved = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
      expect(runtimeAfterFrontRemoved.statusCode).toBe(404)
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)

  test("reload cleans stale runtime targets even without an active SSE subscriber", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-no-sse-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-no-sse-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-no-sse-")
    process.env.HOME = homeRoot

    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "no-sse-plugin")
    await writePlugin(pluginRoot, "no-sse-plugin")
    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const [plugin] = list.json() as Array<{ frontTarget?: { entryUrl?: string } }>
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()

      await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
        name: "no-sse-plugin",
        version: "1.0.1",
        boring: { label: "no-sse-plugin" },
      }), "utf8")

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)

      const runtimeAfterReload = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
      expect(runtimeAfterReload.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 20_000)

  test("reload emits live load and unload events after replay for the active workspace", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-live-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-live-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-live-")
    process.env.HOME = homeRoot

    await writePlugin(join(workspaceRoot, ".pi", "extensions", "live-plugin"), "live-plugin")
    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const [plugin] = list.json() as Array<{ frontTarget?: { entryUrl?: string } }>
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()
      await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")

      const pluginRoot = join(workspaceRoot, ".pi", "extensions", "live-plugin")
      await rename(pluginRoot, join(workspaceRoot, ".pi", "hidden-live-plugin"))

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)
      expect(reload.json()).toMatchObject({ ok: true, sessionId: expect.any(String), reloaded: expect.any(Boolean) })

      const unload = await sse.nextEvent((event) => event.event === "boring.plugin.unload")
      expect(unload.data).toMatchObject({ id: "live-plugin", workspaceId: workspace.id, replay: false })
      const runtimeAfterUnload = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
      expect(runtimeAfterUnload.statusCode).toBe(404)
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)
})
