import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { Stat, Workspace } from "@hachej/boring-agent/shared"
import { createTLStore } from "tldraw"
import { createCanvasTool, createTldrawAgentServerPlugin, nativeShapeSummary, validateActions } from "./index"

function blankNative(): string {
  const snapshot = createTLStore().getStoreSnapshot()
  return JSON.stringify({ tldrawFileFormatVersion: 1, schema: snapshot.schema, records: [] })
}

function workspaceFixture(initial = blankNative()) {
  let content = initial
  let current: Stat = { kind: "file", size: initial.length, mtimeMs: 1 }
  const workspace: Workspace = {
    root: "/workspace",
    runtimeContext: { runtimeCwd: "/workspace" },
    readFile: vi.fn(async () => content),
    writeFile: vi.fn(async (_path, data) => { content = data }),
    readFileWithStat: vi.fn(async () => ({ content, stat: current })),
    replaceFileIfUnchanged: vi.fn(async (_path, data, expected) => {
      if (expected.size !== current.size || expected.mtimeMs !== current.mtimeMs) throw Object.assign(new Error("conflict"), { statusCode: 409 })
      content = data
      current = { kind: "file", size: data.length, mtimeMs: current.mtimeMs + 1 }
      return current
    }),
    createBinaryFile: vi.fn(async (_path, data) => { content = new TextDecoder().decode(data); current = { kind: "file", size: data.length, mtimeMs: current.mtimeMs + 1 } }),
    unlink: vi.fn(async () => {}), readdir: vi.fn(async () => []), stat: vi.fn(async () => current),
    mkdir: vi.fn(async () => {}), rename: vi.fn(async () => {}),
  }
  return { workspace, get content() { return content }, get stat() { return current } }
}

async function routeApp(workspace: Workspace) {
  const app = Fastify()
  const plugin = createTldrawAgentServerPlugin({ workspace }) as unknown as {
    routes: Parameters<typeof app.register>[0]
    agentTools: ReturnType<typeof createCanvasTool>[]
  }
  await app.register(plugin.routes)
  await app.ready()
  return { app, tool: plugin.agentTools[0]! }
}

describe("edit_tldraw_canvas", () => {
  it("exposes a truthful discriminated action schema", () => {
    const tool = createCanvasTool(workspaceFixture().workspace)
    expect(tool.parameters).toMatchObject({ required: ["operation", "path"], additionalProperties: false })
    expect((tool.parameters as { properties: { actions: { items: { oneOf: unknown[] } } } }).properties.actions.items.oneOf).toHaveLength(6)
  })

  it("returns bounded migrated-store metadata for model-visible reads", () => {
    expect(JSON.parse(nativeShapeSummary(blankNative()))).toEqual({ total: 0, returned: 0, truncated: false, shapes: [] })
  })

  it("rejects malformed and silent-no-op action variants", () => {
    expect(() => validateActions([{ type: "update", shape: {} }])).toThrow("requires id")
    expect(() => validateActions([{ type: "distribute", ids: ["a", "b"], axis: "x" }])).toThrow("at least 3")
    expect(() => validateActions([{ type: "create", shape: { id: "a", type: "bogus", x: 1, y: 2 } }])).toThrow("valid type")
    expect(() => validateActions([{ type: "clear", extra: true }])).toThrow("additional")
  })

  it("creates nested files through the adapter without overwriting", async () => {
    const fixture = workspaceFixture()
    const tool = createCanvasTool(fixture.workspace)
    const output = await tool.execute({ operation: "create", path: "diagrams/flow.tldraw" }, { toolCallId: "1" } as never)
    expect(output.isError).not.toBe(true)
    expect(fixture.workspace.mkdir).toHaveBeenCalledWith("diagrams", { recursive: true })
    expect(fixture.workspace.createBinaryFile).toHaveBeenCalledOnce()
  })

  it("rejects malformed native files before exposing them", async () => {
    const fixture = workspaceFixture("not-json")
    const { app } = await routeApp(fixture.workspace)
    const response = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/file?path=flow.tldraw&filesystem=user" })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain("invalid native tldraw file")
    await app.close()
  })

  it("binds filesystem, owner, batch, and revision on commit", async () => {
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    const file = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/file?path=flow.tldraw&filesystem=user" })
    expect(file.statusCode).toBe(200)
    const revision = file.json().revision
    expect((await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "company", clientId: "c" } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c" } })).statusCode).toBe(200)
    const rejected = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { path: "flow.tldraw", filesystem: "user", clientId: "other", json: blankNative(), expectedRevision: revision } })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json().written).toBe(false)
    expect(fixture.workspace.replaceFileIfUnchanged).not.toHaveBeenCalled()
    await app.close()
  })

  it("uses provider CAS and returns an idempotent conflict shape", async () => {
    const fixture = workspaceFixture()
    const { app } = await routeApp(fixture.workspace)
    await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c" } })
    const response = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c", json: blankNative(), expectedRevision: { size: 999, mtimeMs: 1 } } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ written: false, error: { message: "conflict" } })
    expect(fixture.workspace.replaceFileIfUnchanged).toHaveBeenCalledOnce()
    await app.close()
  })

  it("cancels an uncommitted batch and never exposes it afterward", async () => {
    const fixture = workspaceFixture()
    const { app, tool } = await routeApp(fixture.workspace)
    const abort = new AbortController()
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: abort.signal } as never)
    abort.abort()
    await expect(toolPromise).resolves.toMatchObject({ isError: true })
    await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c" } })
    const actions = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/actions?path=flow.tldraw&filesystem=user&clientId=c" })
    expect(actions.json().batches).toEqual([])
    await app.close()
  })

  it("does not cancel a batch after its provider commit has started", async () => {
    const fixture = workspaceFixture()
    let releaseWrite!: () => void
    vi.mocked(fixture.workspace.replaceFileIfUnchanged!).mockImplementation(async (_path, data) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve })
      return { kind: "file", size: data.length, mtimeMs: 2 }
    })
    const { app, tool } = await routeApp(fixture.workspace)
    await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c" } })
    const abort = new AbortController()
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: abort.signal } as never)
    const actions = await app.inject({ method: "GET", url: "/api/v1/plugins/tldraw-agent/actions?path=flow.tldraw&filesystem=user&clientId=c" })
    const commitPromise = app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload: { id: actions.json().batches[0].id, path: "flow.tldraw", filesystem: "user", clientId: "c", json: blankNative(), expectedRevision: { size: fixture.stat.size, mtimeMs: fixture.stat.mtimeMs } } })
    await vi.waitFor(() => expect(fixture.workspace.replaceFileIfUnchanged).toHaveBeenCalledOnce())
    abort.abort()
    releaseWrite()
    expect((await commitPromise).statusCode).toBe(200)
    await expect(toolPromise).resolves.toMatchObject({ content: [{ text: expect.stringContaining("Applied one action batch") }] })
    await app.close()
  })

  it("claims and commits a batch exactly once with an idempotent replay", async () => {
    const fixture = workspaceFixture()
    const { app, tool } = await routeApp(fixture.workspace)
    await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/connect", payload: { path: "flow.tldraw", filesystem: "user", clientId: "c" } })
    const toolPromise = tool.execute({ operation: "edit", path: "flow.tldraw", actions: [{ type: "clear" }] }, { toolCallId: "call", abortSignal: new AbortController().signal } as never)
    const actionsUrl = "/api/v1/plugins/tldraw-agent/actions?path=flow.tldraw&filesystem=user&clientId=c"
    const actionResponse = await app.inject({ method: "GET", url: actionsUrl })
    const batchId = actionResponse.json().batches[0].id as string
    const replayedClaim = await app.inject({ method: "GET", url: actionsUrl })
    expect(replayedClaim.json().batches[0].id).toBe(batchId)
    const payload = { id: batchId, path: "flow.tldraw", filesystem: "user", clientId: "c", json: blankNative(), expectedRevision: { size: fixture.stat.size, mtimeMs: fixture.stat.mtimeMs } }
    const first = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    const replay = await app.inject({ method: "POST", url: "/api/v1/plugins/tldraw-agent/commit", payload })
    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toEqual(first.json())
    expect(fixture.workspace.replaceFileIfUnchanged).toHaveBeenCalledOnce()
    await expect(toolPromise).resolves.toMatchObject({ content: [{ text: expect.stringContaining("Applied one action batch") }] })
    await app.close()
  })
})
