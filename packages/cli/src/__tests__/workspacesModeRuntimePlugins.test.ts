import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { ToolExecContext } from "@hachej/boring-agent/shared"
import { createBoringAutomationTool, FileAutomationStore, resolveAutomationOperationsForActor } from "@hachej/boring-automation/server"
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

function toolContext(workspaceId: string): ToolExecContext {
  return { abortSignal: new AbortController().signal, toolCallId: `call-${workspaceId}`, workspaceId, userId: "ignored-by-local-mode" }
}

function toolDetails(result: { details?: unknown; content: Array<{ type: string; text?: string }> }) {
  expect(result.content).toHaveLength(1)
  expect(result.content[0]?.type).toBe("text")
  expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(result.details)
  return result.details as Record<string, any>
}

describe("workspaces mode runtime plugin wiring", () => {
  test("automation tool operations execute against only the active workspace store", async () => {
    const workspaceA = await makeTempDir("boring-cli-tool-workspace-a-")
    const workspaceB = await makeTempDir("boring-cli-tool-workspace-b-")
    const stores = new Map([
      ["workspace-a", new FileAutomationStore(join(workspaceA, ".pi", "automation"))],
      ["workspace-b", new FileAutomationStore(join(workspaceB, ".pi", "automation"))],
    ])
    const run = {
      id: "run-a", automationId: "pending", sessionId: "session-a", status: "succeeded" as const,
      trigger: "manual" as const, scheduledFor: null, startedAt: "2026-07-19T00:00:00.000Z",
      completedAt: "2026-07-19T00:00:01.000Z", durationMs: 1_000, inputTokens: 2,
      outputTokens: 3, totalTokens: 5, promptSnapshot: "must not leak", modelSnapshot: "must:not-leak",
      error: null, createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:00:01.000Z",
    }
    const executorRun = vi.fn(async ({ automationId, actor }: { automationId: string; actor?: { workspaceId: string; userId: string } }) => ({
      ...run, automationId,
      sessionId: `${actor?.workspaceId}:${actor?.userId}`,
    }))
    const tool = createBoringAutomationTool({
      resolveOperationsForActor: async (actorContext) => resolveAutomationOperationsForActor({
        mode: "local",
        resolveStore: (actor) => {
          const store = stores.get(actor.workspaceId)
          if (!store) throw new Error("unknown test workspace")
          return store
        },
        resolveExecutor: async () => ({ run: executorRun as any }),
        localUserId: "local",
      }, actorContext),
    })

    const createdResult = await tool.execute({
      operation: "create", title: "Workspace A daily", cron: "0 9 * * *", timezone: "UTC",
      model: "openai:gpt-5", thinkingLevel: "high", prompt: "Summarize A",
    }, toolContext("workspace-a"))
    const created = toolDetails(createdResult).automation
    expect(createdResult.isError).toBe(false)

    expect(toolDetails(await tool.execute({ operation: "list" }, toolContext("workspace-a"))).automations).toHaveLength(1)
    expect(toolDetails(await tool.execute({ operation: "list" }, toolContext("workspace-b"))).automations).toEqual([])
    expect(toolDetails(await tool.execute({ operation: "get", automationId: created.id }, toolContext("workspace-a"))).prompt.text).toBe("Summarize A")
    expect(toolDetails(await tool.execute({ operation: "get", automationId: created.id }, toolContext("workspace-b")))).toMatchObject({ ok: false })

    await tool.execute({ operation: "update", automationId: created.id, title: "Updated A", prompt: "Updated prompt" }, toolContext("workspace-a"))
    expect(toolDetails(await tool.execute({ operation: "pause", automationId: created.id }, toolContext("workspace-a"))).automation.enabled).toBe(false)
    expect(toolDetails(await tool.execute({ operation: "resume", automationId: created.id }, toolContext("workspace-a"))).automation.enabled).toBe(true)

    const runResult = toolDetails(await tool.execute({ operation: "run", automationId: created.id }, toolContext("workspace-a")))
    expect(runResult.run).toMatchObject({ status: "succeeded", sessionId: "workspace-a:local" })
    expect(runResult.run).not.toHaveProperty("promptSnapshot")
    expect(runResult.run).not.toHaveProperty("modelSnapshot")
    expect(executorRun).toHaveBeenCalledWith({ automationId: created.id, actor: { workspaceId: "workspace-a", userId: "local" } })

    expect(toolDetails(await tool.execute({ operation: "list_runs", automationId: created.id }, toolContext("workspace-a"))).runs).toEqual([])
    expect(toolDetails(await tool.execute({ operation: "delete", automationId: created.id }, toolContext("workspace-a"))).deleted).toMatchObject({ automationId: created.id, title: "Updated A" })
    expect(toolDetails(await tool.execute({ operation: "list" }, toolContext("workspace-a"))).automations).toEqual([])
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(join(workspaceA, ".pi", "automation", "prompts", `${created.id}.md`), "utf8")))
      .resolves.toBe("Updated prompt")
  })

  test("registers trusted workspace-scoped task session link routes", async () => {
    const homeRoot = await makeTempDir("boring-cli-task-session-home-")
    const registryPath = join(await makeTempDir("boring-cli-task-session-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-task-session-workspace-")
    process.env.HOME = homeRoot
    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/boring-tasks/sessions/list",
        headers: { "x-boring-workspace-id": workspace.id },
        payload: { adapterId: "github:workspace", taskId: "776" },
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toEqual({ ok: true, links: [] })

      const catalog = await app.inject({
        method: "GET",
        url: "/api/v1/agent/catalog",
        headers: { "x-boring-workspace-id": workspace.id },
      })
      expect(catalog.statusCode, catalog.body).toBe(200)
      expect((catalog.json() as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("manage_tasks")
    } finally {
      await app.close()
    }
  }, 10000)

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

    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(registeredA.id)}`)

    try {
      // The CLI bundles @hachej/boring-ask-user as an internal default plugin
      // package. Internal plugins are statically bundled into the app front and
      // never appear on the SSE channel — only the external test fixtures do.
      const expectedTestPluginIds = ["global-plugin", "local-a"]
      const collectMessages = async (expectedCount: number): Promise<SseMessage[]> => {
        const collected: SseMessage[] = []
        for (let i = 0; i < 60; i += 1) {
          const event = await sse.nextEvent((msg) => msg.event === "boring.plugin.load" || msg.event === "boring.plugin.replay-complete")
          collected.push(event)
          if (collected.length >= expectedCount) break
        }
        return collected
      }
      const events = await collectMessages(3)
      const loaded = events
        .filter((event) => event.event === "boring.plugin.load")
        .map((event) => ({ id: String(event.data.id), data: event.data }))
      const replayComplete = events.find((event) => event.event === "boring.plugin.replay-complete")
      expect(loaded.map((event) => event.id).sort()).toEqual(expectedTestPluginIds)
      for (const event of loaded) {
        expect(event.data.workspaceId).toBe(registeredA.id)
        expect(event.data.replay).toBe(true)
        expect({ id: event.id, hasFrontTarget: Boolean(event.data.frontTarget) }).toEqual({
          id: event.id,
          hasFrontTarget: true,
        })
        expect(event.data.frontUrl).toBeUndefined()
      }
      // Internal plugins (ask-user) are excluded from the SSE channel.
      expect(loaded.find((event) => event.id === "ask-user")).toBeUndefined()
      expect(replayComplete).toBeDefined()

      const meta = await app.inject({ method: "GET", url: "/api/v1/workspace/meta" })
      expect(meta.json()).toMatchObject({
        workspacesMode: true,
        runtimePluginFrontLoadingEnabled: true,
        runtimePluginDiagnosticsEnabled: true,
      })

      const diagnostics = await app.inject({ method: "GET", url: `/api/v1/runtime-plugin-diagnostics?workspaceId=${registeredA.id}` })
      expect(diagnostics.statusCode).toBe(200)
      expect(diagnostics.json()).toMatchObject({
        workspaceId: registeredA.id,
        plugins: expect.arrayContaining([
          expect.objectContaining({
            id: "global-plugin",
            rootDir: join(homeRoot, ".pi", "agent", "extensions", "global-plugin"),
            frontPath: join(homeRoot, ".pi", "agent", "extensions", "global-plugin", "front", "index.tsx"),
            serverLoadedRevision: 1,
            host: expect.objectContaining({
              pluginId: "global-plugin",
              workspaceId: registeredA.id,
              revision: 1,
            }),
          }),
        ]),
      })

      const listA = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${registeredA.id}` })
      const pluginsA = listA.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>
      expect(pluginsA.map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "global-plugin", "local-a", "tasks"])
      for (const plugin of pluginsA) {
        expect(plugin.frontTarget?.entryUrl).toBeTruthy()
        const runtime = await app.inject({ method: "GET", url: plugin.frontTarget!.entryUrl! })
        expect(runtime.statusCode).toBe(200)
      }

      const listB = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${registeredB.id}` })
      expect((listB.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "global-plugin", "local-b", "tasks"])

      const catalogA = await app.inject({
        method: "GET",
        url: "/api/v1/agent/catalog",
        headers: { "x-boring-workspace-id": registeredA.id },
      })
      expect(catalogA.statusCode).toBe(200)
      expect((catalogA.json() as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("boring_automation")

      const catalogB = await app.inject({
        method: "GET",
        url: "/api/v1/agent/catalog",
        headers: { "x-boring-workspace-id": registeredB.id },
      })
      expect(catalogB.statusCode).toBe(200)
      expect((catalogB.json() as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("boring_automation")

      const automationA = await app.inject({
        method: "POST",
        url: "/api/v1/boring-automation/automations",
        headers: { "x-boring-workspace-id": registeredA.id },
        payload: { title: "Workspace A", cron: "0 0 1 1 *", timezone: "UTC", model: "openai:gpt-5" },
      })
      expect(automationA.statusCode).toBe(201)
      const automationB = await app.inject({
        method: "GET",
        url: "/api/v1/boring-automation/automations",
        headers: { "x-boring-workspace-id": registeredB.id },
      })
      expect(automationB.json()).toMatchObject({ ok: true, automations: [] })
    } finally {
      await sse.close()
      await app.close()
    }
  }, 60_000)

  test("workspaces mode exposes default plugin workspace bridge handlers", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-bridge-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-bridge-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-bridge-")
    process.env.HOME = homeRoot

    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      const headers = {
        "content-type": "application/json",
        "x-boring-workspace-id": workspace.id,
        "x-boring-session-id": "s1",
      }
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/workspace-bridge/call",
        headers,
        payload: { op: "ask-user.v1.pending", input: { sessionId: "s1" } },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        op: "ask-user.v1.pending",
        output: { pending: null },
      })

      const pendingState = {
        hint: { questionId: "q1", sessionId: "s1", status: "ready" },
        hintsBySession: { s1: { questionId: "q1", sessionId: "s1", status: "ready" } },
      }
      const stateHeaders = { "x-boring-workspace-id": workspace.id }
      const publishPending = await app.inject({
        method: "PUT",
        url: "/api/v1/ui/state",
        headers: stateHeaders,
        payload: { state: { "questions.pending": pendingState } },
      })
      expect(publishPending.statusCode).toBe(204)
      const browserSnapshot = await app.inject({
        method: "PUT",
        url: "/api/v1/ui/state",
        headers: stateHeaders,
        payload: { state: { drawerOpen: true } },
      })
      expect(browserSnapshot.statusCode).toBe(204)
      const state = await app.inject({ method: "GET", url: "/api/v1/ui/state", headers: stateHeaders })
      expect(state.json()).toMatchObject({ drawerOpen: true, "questions.pending": pendingState })

      const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog", headers })
      expect((catalog.json() as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain("ask_user")
    } finally {
      await app.close()
    }
  }, 20_000)

  test("external plugin server routes dispatch through the gateway and hot-reload via /reload", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-routes-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-routes-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-routes-")
    process.env.HOME = homeRoot

    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "routes-plugin")
    const writeServerModule = async (payload: string) => {
      await mkdir(join(pluginRoot, "server"), { recursive: true })
      await writeFile(join(pluginRoot, "server", "index.js"), [
        "export default {",
        "  routes(router) {",
        `    router.get("/items", () => ({ payload: ${JSON.stringify(payload)} }))`,
        "  },",
        "}",
        "",
      ].join("\n"), "utf8")
    }
    await writeServerModule("v1")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "routes-plugin",
      version: "1.0.0",
      boring: { label: "Routes Plugin", server: "./server/index.js" },
    }), "utf8")

    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      const headers = { "x-boring-workspace-id": workspace.id }
      const first = await app.inject({ method: "GET", url: "/api/v1/plugins/routes-plugin/items", headers })
      expect(first.statusCode).toBe(200)
      expect(first.json()).toEqual({ payload: "v1" })

      // Edit the server module, /reload, and the route serves the new code.
      await writeServerModule("v2")
      const reload = await app.inject({ method: "POST", url: "/api/v1/agent/reload", headers })
      expect(reload.statusCode).toBe(200)
      const second = await app.inject({ method: "GET", url: "/api/v1/plugins/routes-plugin/items", headers })
      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual({ payload: "v2" })

      // Missing workspace header → stable 404, not a crash.
      const noWorkspace = await app.inject({ method: "GET", url: "/api/v1/plugins/routes-plugin/items" })
      expect(noWorkspace.statusCode).toBe(404)
      // Unknown plugin in a valid workspace → registry's own 404.
      const unknownPlugin = await app.inject({ method: "GET", url: "/api/v1/plugins/nope/items", headers })
      expect(unknownPlugin.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 60_000)

  test("front import errors are workspace-scoped and surface in runtime-plugin-diagnostics", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-fronterr-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-fronterr-registry-"), "workspaces.yaml")
    const workspaceA = await makeTempDir("boring-cli-ws-fronterr-a-")
    const workspaceB = await makeTempDir("boring-cli-ws-fronterr-b-")
    process.env.HOME = homeRoot

    await writePlugin(join(workspaceA, ".pi", "extensions", "broken-front"), "broken-front")
    const [registeredA, registeredB] = await setupRegistry([workspaceA, workspaceB], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      const headersA = { "x-boring-workspace-id": registeredA.id }
      const headersB = { "x-boring-workspace-id": registeredB.id }

      const report = await app.inject({
        method: "POST",
        url: "/api/v1/agent-plugins/broken-front/front-error",
        headers: headersA,
        payload: { revision: 4, message: "recharts proxy is not browser-evaluable" },
      })
      expect(report.statusCode).toBe(204)

      const diagA = await app.inject({ method: "GET", url: "/api/v1/runtime-plugin-diagnostics", headers: headersA })
      expect(diagA.json()).toMatchObject({
        workspaceId: registeredA.id,
        plugins: expect.arrayContaining([
          expect.objectContaining({
            id: "broken-front",
            frontError: expect.objectContaining({ revision: 4, message: "recharts proxy is not browser-evaluable" }),
          }),
        ]),
      })

      // The report is scoped to workspace A — workspace B never sees it.
      const diagB = await app.inject({ method: "GET", url: "/api/v1/runtime-plugin-diagnostics", headers: headersB })
      const bHasFrontError = (diagB.json() as { plugins: Array<{ frontError?: unknown }> }).plugins.some((plugin) => plugin.frontError)
      expect(bHasFrontError).toBe(false)
    } finally {
      await app.close()
    }
  }, 60_000)

  test("ordinary GET does not become a hidden refresh path and zero-plugin workspaces still complete replay", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-empty-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-empty-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-empty-")
    process.env.HOME = homeRoot

    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const replayComplete = await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")
      expect(replayComplete.data).toMatchObject({ workspaceId: workspace.id, replay: true })

      // CLI default plugin packages are present even for zero-external-plugin
      // workspaces. The fixture only writes `later-plugin` mid-test, so the
      // pre-reload list should contain exactly the bundled defaults.
      const before = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((before.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "tasks"])

      await writePlugin(join(workspaceRoot, ".pi", "extensions", "later-plugin"), "later-plugin")

      const stillBeforeReload = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((stillBeforeReload.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "tasks"])

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)
      expect(reload.json()).toMatchObject({ ok: true, sessionId: expect.any(String), reloaded: expect.any(Boolean) })

      const afterReload = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((afterReload.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "later-plugin", "tasks"])
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)

  test("package sources added to .pi/settings.json after boot are picked up by /reload", async () => {
    const homeRoot = await makeTempDir("boring-cli-workspaces-pkgsrc-home-")
    const registryPath = join(await makeTempDir("boring-cli-workspaces-pkgsrc-registry-"), "workspaces.yaml")
    const workspaceRoot = await makeTempDir("boring-cli-workspace-pkgsrc-")
    process.env.HOME = homeRoot

    const [workspace] = await setupRegistry([workspaceRoot], registryPath)
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      // Boot the workspace runtime with only the CLI default plugins.
      const before = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((before.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "tasks"])

      // Simulate `boring-ui-plugin install ../some-plugin`: a package source
      // dir outside .pi/extensions, registered in .pi/settings.json packages.
      const pluginDir = join(workspaceRoot, "vendor", "settings-plugin")
      await writePlugin(pluginDir, "settings-plugin")
      await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
      await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
        packages: ["../vendor/settings-plugin"],
      }), "utf8")

      const reload = await app.inject({
        method: "POST",
        url: "/api/v1/agent/reload?workspaceId=" + encodeURIComponent(workspace.id),
        payload: {},
      })
      expect(reload.statusCode).toBe(200)

      const afterReload = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      expect((afterReload.json() as Array<{ id: string }>).map((plugin) => plugin.id).sort()).toEqual(["ask-user", "boring-automation", "diagram", "settings-plugin", "tasks"]) 
    } finally {
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
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      await sse.nextEvent((event) => event.event === "boring.plugin.replay-complete")
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "evict-plugin")
      expect(plugin?.frontTarget?.entryUrl).toBeTruthy()

      const remove = await app.inject({ method: "DELETE", url: `/api/v1/local-workspaces/${workspace.id}` })
      expect(remove.json()).toMatchObject({ ok: true })
      await sse.waitForClose()

      const runtime = await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })
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
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "front-removed-plugin")
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
      const runtimeAfterFrontRemoved = await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })
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
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "no-sse-plugin")
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

      const runtimeAfterReload = await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })
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
    const app = await createWorkspacesModeApp({ mode: "direct", registryPath, provisionWorkspace: false })
    const address = await app.listen({ port: 0, host: "127.0.0.1" })
    const sse = await openSse(`${address}/api/v1/agent-plugins/events?workspaceId=${encodeURIComponent(workspace.id)}`)

    try {
      const list = await app.inject({ method: "GET", url: `/api/v1/agent-plugins?workspaceId=${workspace.id}` })
      const plugin = (list.json() as Array<{ id: string; frontTarget?: { entryUrl?: string } }>).find((item) => item.id === "live-plugin")
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
      const runtimeAfterUnload = await app.inject({ method: "GET", url: plugin!.frontTarget!.entryUrl! })
      expect(runtimeAfterUnload.statusCode).toBe(404)
    } finally {
      await sse.close()
      await app.close()
    }
  }, 20_000)
})
